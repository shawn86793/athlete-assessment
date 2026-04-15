const { getStore } = require("@netlify/blobs");

const store = getStore("seasons");

exports.handler = async (event) => {
  const parts = String(event.path || "").split("/");
  const icsIndex = parts.indexOf("calendar.ics");
  const seasonId = icsIndex > 0 ? parts[icsIndex - 1] : null;

  if (!seasonId) {
    return {
      statusCode: 400,
      body: "Missing season ID"
    };
  }

  let season;
  try {
    season = await store.get(seasonId, { type: "json" });
    if (!season || typeof season !== "object" || Array.isArray(season)) {
      return { statusCode: 404, body: "Season not found" };
    }
  } catch {
    return { statusCode: 500, body: "Could not load season data" };
  }

  const token = String(event.queryStringParameters?.token || "").trim();
  const personalContext = resolvePlayerContext(season, seasonId, token);
  const baseUrl = getBaseUrl(event);

  const ics = buildICS(season, {
    player: personalContext.player,
    guardianToken: personalContext.valid ? token : "",
    baseUrl,
  });

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slugify(season.teamName || season.name)}.ics"`,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*"
    },
    body: ics
  };
};

function resolvePlayerContext(season, seasonId, token) {
  if (!token) return { valid: false, player: null };
  const decoded = decodeGuardianToken(token);
  if (!decoded) return { valid: false, player: null };
  if (decoded.seasonId !== String(seasonId || "").trim()) return { valid: false, player: null };

  const roster = Array.isArray(season?.roster) ? season.roster : [];
  const player = roster.find((entry) => String(entry?.id || "").trim() === decoded.playerId) || null;
  if (!player) return { valid: false, player: null };

  const storedSecret = String(player.guardianToken || "").trim();
  if (!storedSecret || storedSecret !== decoded.secret) {
    return { valid: false, player: null };
  }

  return { valid: true, player };
}

function decodeGuardianToken(token) {
  try {
    const normalized = String(token).replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = Buffer.from(padded, "base64").toString("utf-8");
    const payload = JSON.parse(decoded);
    if (!payload || typeof payload !== "object") return null;

    const playerId = String(payload.p || payload.playerId || "").trim();
    const seasonId = String(payload.s || payload.seasonId || "").trim();
    const secret = String(payload.k || payload.secret || "").trim();
    if (!playerId || !seasonId || !secret) return null;

    return { playerId, seasonId, secret };
  } catch {
    return null;
  }
}

function getBaseUrl(event) {
  const host = String(event.headers?.["x-forwarded-host"] || event.headers?.host || "").trim();
  if (!host) return "https://tryout-aas.netlify.app";
  const protoHeader = String(event.headers?.["x-forwarded-proto"] || "https").trim();
  const proto = protoHeader.split(",")[0].trim() || "https";
  return `${proto}://${host}`;
}

function buildICS(season, options = {}) {
  const events = (season.events || []).filter((entry) => entry && entry.date);
  const stamp = formatICSDate(new Date());
  const playerId = String(options.player?.id || "").trim();

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tryout AAS//Season Builder//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(season.teamName || season.name || "Schedule")}`,
    `X-WR-CALDESC:${icsText(season.sport || "")} Season Schedule`,
    "X-WR-TIMEZONE:America/Toronto"
  ];

  for (const ev of events) {
    const dtStart = formatICSDateTime(ev.date, ev.startTime || "08:00");
    const dtEnd = formatICSDateTime(ev.date, ev.endTime || addOneHour(ev.startTime || "08:00"));
    const description = buildDescription(ev, {
      playerId,
      guardianToken: options.guardianToken,
      baseUrl: options.baseUrl,
    });

    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.id || generateUID()}@tryout-aas.netlify.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${icsText(ev.title || ev.type || "Event")}`,
      `LOCATION:${icsText(ev.location || "")}`,
      `DESCRIPTION:${icsText(description)}`,
      `CATEGORIES:${icsText(ev.type || "Event")}`,
      "STATUS:CONFIRMED",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function buildDescription(ev, options = {}) {
  const lines = [];
  if (ev.type) lines.push(String(ev.type));
  if (ev.location) lines.push("Location: " + String(ev.location));
  if (ev.notes) lines.push(String(ev.notes));
  lines.push(...directionLines(ev.location));

  const playerId = String(options.playerId || "").trim();
  if (!playerId) {
    return lines.join("\n");
  }

  const status = availabilityStatusLabel(getAvailabilityValue(ev, playerId));
  lines.push(`Your availability: ${status}`);

  const token = String(options.guardianToken || "").trim();
  const eventId = String(ev.id || "").trim();
  const baseUrl = String(options.baseUrl || "").trim();
  if (token && eventId && baseUrl) {
    const link = `${baseUrl}/?availability=${encodeURIComponent(token)}&event=${encodeURIComponent(eventId)}`;
    lines.push(`Update availability: ${link}`);
  }

  return lines.join("\n");
}

function directionLinks(location) {
  const raw = String(location || "").trim();
  if (!raw) return null;
  const encoded = encodeURIComponent(raw);
  return {
    waze: `https://waze.com/ul?q=${encoded}&navigate=yes`,
    google: `https://maps.google.com/?q=${encoded}`,
    apple: `https://maps.apple.com/?q=${encoded}`,
  };
}

function directionLines(location) {
  const links = directionLinks(location);
  if (!links) return [];
  return [
    `Waze: ${links.waze}`,
    `Google Maps: ${links.google}`,
    `Apple Maps: ${links.apple}`,
  ];
}

function getAvailabilityValue(ev, playerId) {
  const meta = ev?.availabilityMeta && typeof ev.availabilityMeta === "object" ? ev.availabilityMeta[playerId] : null;
  const fromMeta = meta && typeof meta === "object" ? String(meta.value || "").toLowerCase() : "";
  if (fromMeta === "yes" || fromMeta === "maybe" || fromMeta === "no") return fromMeta;

  const map = ev?.availability && typeof ev.availability === "object" ? ev.availability : {};
  const fromLegacy = String(map[playerId] || "").toLowerCase();
  if (fromLegacy === "yes" || fromLegacy === "maybe" || fromLegacy === "no") return fromLegacy;
  return "";
}

function availabilityStatusLabel(value) {
  if (value === "yes") return "Yes";
  if (value === "maybe") return "?";
  if (value === "no") return "No";
  return "Not set";
}

function formatICSDate(date) {
  const d = new Date(date);
  return [
    d.getUTCFullYear(),
    pad(d.getUTCMonth() + 1),
    pad(d.getUTCDate()),
    "T",
    pad(d.getUTCHours()),
    pad(d.getUTCMinutes()),
    "00Z"
  ].join("");
}

function formatICSDateTime(dateStr, timeStr) {
  const d = new Date(dateStr + "T" + timeStr + ":00");
  if (isNaN(d.getTime())) return "";
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    "T",
    pad(d.getHours()),
    pad(d.getMinutes()),
    "00"
  ].join("");
}

function addOneHour(timeStr) {
  const [h, m] = (timeStr || "08:00").split(":").map(Number);
  return pad((h + 1) % 24) + ":" + pad(m || 0);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function icsText(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function slugify(s) {
  return String(s || "Schedule").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function generateUID() {
  return Date.now() + "-" + Math.random().toString(36).slice(2);
}
