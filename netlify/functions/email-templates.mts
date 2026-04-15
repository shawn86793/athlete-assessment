const escapeHTML = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const baseTemplate = (content: string, orgName = 'Tryout') => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
          <tr>
            <td style="background:#E85D26;padding:20px 32px;">
              <span style="color:#ffffff;font-size:24px;font-weight:900;letter-spacing:2px;">TRYOUT</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #eeeeee;">
              <p style="margin:0;font-size:12px;color:#999999;">This email was sent by ${escapeHTML(orgName)} via Tryout.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

const button = (text: string, url: string) => `
  <a href="${escapeHTML(url)}" style="display:inline-block;background:#E85D26;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:6px;font-weight:700;font-size:16px;margin:16px 0;">
    ${escapeHTML(text)}
  </a>`

type TemplateResult = {
  subject: string
  html: string
  text: string
}

const gamesText = (games: Array<Record<string, unknown>>) =>
  games
    .slice(0, 5)
    .map((game) => {
      const date = String(game.date || '').trim()
      const opponentOrType = String(game.opponent || game.type || '').trim()
      const location = String(game.location || '').trim()
      return `- ${date} | ${opponentOrType} | ${location}`
    })
    .join('\n')

const gamesRows = (games: Array<Record<string, unknown>>) =>
  games
    .slice(0, 5)
    .map((game) => {
      const date = escapeHTML(String(game.date || '').trim())
      const opponentOrType = escapeHTML(String(game.opponent || game.type || '').trim())
      const location = escapeHTML(String(game.location || '').trim())
      return `<tr>
  <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;color:#555555;font-size:14px;">${date}</td>
  <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;color:#555555;font-size:14px;">${opponentOrType}</td>
  <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;color:#555555;font-size:14px;">${location}</td>
</tr>`
    })
    .join('')

const qrConfirmation = (payload: Record<string, unknown>): TemplateResult => {
  const playerName = String(payload.playerName || 'Player').trim()
  const tryoutName = String(payload.tryoutName || 'Tryout').trim()
  const date = String(payload.date || '').trim()
  const time = String(payload.time || '').trim()
  const location = String(payload.location || '').trim()
  const orgName = String(payload.orgName || 'Tryout').trim()

  return {
    subject: `Registration Confirmed - ${tryoutName}`,
    html: baseTemplate(
      `
      <h2 style="margin:0 0 8px;color:#111111;">Registration Confirmed</h2>
      <p style="color:#555555;margin:0 0 24px;">Hi ${escapeHTML(playerName)}, you are all set for:</p>
      <table style="width:100%;border:1px solid #eeeeee;border-radius:6px;padding:20px;margin-bottom:24px;" cellpadding="0" cellspacing="0">
        <tr><td style="padding:6px 0;color:#111111;"><strong>${escapeHTML(tryoutName)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#555555;">Date: ${escapeHTML(date)}${time ? ` @ ${escapeHTML(time)}` : ''}</td></tr>
        <tr><td style="padding:6px 0;color:#555555;">Location: ${escapeHTML(location)}</td></tr>
      </table>
      <p style="color:#555555;font-size:14px;">Bring this confirmation or your QR code to check in at the venue.</p>
    `,
      orgName
    ),
    text: `Registration Confirmed\n\nHi ${playerName}, you are all set for ${tryoutName}.\nDate: ${date}${time ? ` @ ${time}` : ''}\nLocation: ${location}`,
  }
}

const assessorInvite = (payload: Record<string, unknown>): TemplateResult => {
  const assessorName = String(payload.assessorName || 'there').trim()
  const tryoutName = String(payload.tryoutName || 'Tryout').trim()
  const date = String(payload.date || '').trim()
  const time = String(payload.time || '').trim()
  const location = String(payload.location || '').trim()
  const inviteUrl = String(payload.inviteUrl || '').trim()
  const orgName = String(payload.orgName || 'Tryout').trim()

  return {
    subject: `Invitation to Assess - ${tryoutName}`,
    html: baseTemplate(
      `
      <h2 style="margin:0 0 8px;color:#111111;">Assessor Invitation</h2>
      <p style="color:#555555;margin:0 0 24px;">Hi ${escapeHTML(assessorName)}, you have been invited to assess at:</p>
      <table style="width:100%;border:1px solid #eeeeee;border-radius:6px;padding:20px;margin-bottom:8px;" cellpadding="0" cellspacing="0">
        <tr><td style="padding:6px 0;color:#111111;"><strong>${escapeHTML(tryoutName)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#555555;">Date: ${escapeHTML(date)}${time ? ` @ ${escapeHTML(time)}` : ''}</td></tr>
        <tr><td style="padding:6px 0;color:#555555;">Location: ${escapeHTML(location)}</td></tr>
      </table>
      <p style="color:#555555;font-size:14px;">Use the link below to accept and access your assessment tools.</p>
      ${button('Accept And Open Assessment Portal', inviteUrl)}
      <p style="color:#999999;font-size:12px;margin-top:8px;">This link expires in 72 hours.</p>
    `,
      orgName
    ),
    text: `Assessor Invitation\n\nHi ${assessorName},\nYou have been invited to assess ${tryoutName}.\nDate: ${date}${time ? ` @ ${time}` : ''}\nLocation: ${location}\n\nOpen portal: ${inviteUrl}`,
  }
}

const guardianInvite = (payload: Record<string, unknown>): TemplateResult => {
  const guardianName = String(payload.guardianName || 'there').trim()
  const playerName = String(payload.playerName || 'your player').trim()
  const seasonName = String(payload.seasonName || 'Season').trim()
  const inviteUrl = String(payload.inviteUrl || '').trim()
  const orgName = String(payload.orgName || 'Tryout').trim()

  return {
    subject: `View ${playerName} schedule - ${seasonName}`,
    html: baseTemplate(
      `
      <h2 style="margin:0 0 8px;color:#111111;">Parent Portal Invitation</h2>
      <p style="color:#555555;margin:0 0 24px;">Hi ${escapeHTML(guardianName)}, ${escapeHTML(orgName)} invited you to track <strong>${escapeHTML(playerName)}</strong> for <strong>${escapeHTML(seasonName)}</strong>.</p>
      <p style="color:#555555;">Use the portal to view schedule updates, team assignments, and organization messages.</p>
      ${button('Open Parent Portal', inviteUrl)}
      <p style="color:#999999;font-size:12px;margin-top:8px;">This link expires in 7 days.</p>
    `,
      orgName
    ),
    text: `Parent Portal Invitation\n\nHi ${guardianName},\n${orgName} invited you to track ${playerName} for ${seasonName}.\nOpen portal: ${inviteUrl}`,
  }
}

const schedulePublished = (payload: Record<string, unknown>): TemplateResult => {
  const guardianName = String(payload.guardianName || 'there').trim()
  const playerName = String(payload.playerName || 'Player').trim()
  const teamName = String(payload.teamName || 'Team').trim()
  const seasonName = String(payload.seasonName || 'Season').trim()
  const portalUrl = String(payload.portalUrl || '').trim()
  const orgName = String(payload.orgName || 'Tryout').trim()
  const games = Array.isArray(payload.games)
    ? payload.games.filter((game) => Boolean(game) && typeof game === 'object') as Array<Record<string, unknown>>
    : []

  const rows = gamesRows(games)

  return {
    subject: `${teamName} schedule is live - ${seasonName}`,
    html: baseTemplate(
      `
      <h2 style="margin:0 0 8px;color:#111111;">The Schedule Is Live</h2>
      <p style="color:#555555;margin:0 0 24px;">Hi ${escapeHTML(guardianName)}, the ${escapeHTML(seasonName)} schedule for <strong>${escapeHTML(playerName)}</strong> on <strong>${escapeHTML(teamName)}</strong> has been published.</p>
      ${games.length ? `
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr>
          <th style="text-align:left;padding:8px 0;font-size:12px;color:#999999;border-bottom:2px solid #eeeeee;">DATE</th>
          <th style="text-align:left;padding:8px 0;font-size:12px;color:#999999;border-bottom:2px solid #eeeeee;">VS / TYPE</th>
          <th style="text-align:left;padding:8px 0;font-size:12px;color:#999999;border-bottom:2px solid #eeeeee;">LOCATION</th>
        </tr>
        ${rows}
      </table>
      ${games.length > 5 ? `<p style="font-size:13px;color:#999999;">+ ${games.length - 5} more events in the portal</p>` : ''}
      ` : ''}
      ${button('View Full Schedule', portalUrl)}
    `,
      orgName
    ),
    text: `Schedule Published\n\nHi ${guardianName}, the ${seasonName} schedule for ${playerName} on ${teamName} is now live.\n${games.length ? `\n${gamesText(games)}\n` : ''}\nView full schedule: ${portalUrl}`,
  }
}

const teamAssigned = (payload: Record<string, unknown>): TemplateResult => {
  const guardianName = String(payload.guardianName || 'there').trim()
  const playerName = String(payload.playerName || 'Player').trim()
  const teamName = String(payload.teamName || 'Team').trim()
  const seasonName = String(payload.seasonName || 'Season').trim()
  const portalUrl = String(payload.portalUrl || '').trim()
  const orgName = String(payload.orgName || 'Tryout').trim()

  return {
    subject: `${playerName} assigned to ${teamName}`,
    html: baseTemplate(
      `
      <h2 style="margin:0 0 8px;color:#111111;">Team Assignment</h2>
      <p style="color:#555555;margin:0 0 24px;">Hi ${escapeHTML(guardianName)}, <strong>${escapeHTML(playerName)}</strong> has been assigned to <strong>${escapeHTML(teamName)}</strong> for <strong>${escapeHTML(seasonName)}</strong>.</p>
      <p style="color:#555555;">Open the portal to review roster and schedule details.</p>
      ${button('Open Portal', portalUrl)}
    `,
      orgName
    ),
    text: `Team Assignment\n\nHi ${guardianName}, ${playerName} has been assigned to ${teamName} for ${seasonName}.\nOpen portal: ${portalUrl}`,
  }
}

const teamBroadcast = (payload: Record<string, unknown>): TemplateResult => {
  const guardianName = String(payload.guardianName || 'there').trim()
  const playerName = String(payload.playerName || '').trim()
  const teamName = String(payload.teamName || 'Team').trim()
  const subject = String(payload.subject || 'Message from your coach').trim()
  const message = String(payload.message || '').trim()
  const portalUrl = String(payload.portalUrl || '').trim()
  const orgName = String(payload.orgName || 'Tryout').trim()
  const coachName = String(payload.coachName || 'Your Coach').trim()

  const messageHtml = message
    .split('\n')
    .map(line => `<p style="color:#333333;margin:0 0 10px;line-height:1.6;">${escapeHTML(line)}</p>`)
    .join('')

  return {
    subject,
    html: baseTemplate(
      `
      <h2 style="margin:0 0 4px;color:#111111;">${escapeHTML(subject)}</h2>
      <p style="color:#888888;font-size:13px;margin:0 0 20px;">
        From ${escapeHTML(coachName)} · ${escapeHTML(teamName)}
        ${playerName ? ` · For ${escapeHTML(playerName)}` : ''}
      </p>
      <div style="border-left:4px solid #E85D26;padding:12px 16px;margin:0 0 24px;background:#fff8f5;">
        ${messageHtml || '<p style="color:#555555;">No message content.</p>'}
      </div>
      ${portalUrl ? `
        <p style="color:#555555;font-size:14px;">You can also view the team schedule and confirm availability in your family portal.</p>
        ${button('Open Family Portal', portalUrl)}
      ` : ''}
      <p style="color:#999999;font-size:12px;margin-top:16px;">
        You received this message because you are registered as a family contact for ${escapeHTML(playerName || 'a player')} on ${escapeHTML(teamName)}.
      </p>
    `,
      orgName
    ),
    text: `${subject}\n\nFrom ${coachName} · ${teamName}${playerName ? ` · For ${playerName}` : ''}\n\n${message}${portalUrl ? `\n\nFamily portal: ${portalUrl}` : ''}`,
  }
}

const assessmentComplete = (payload: Record<string, unknown>): TemplateResult => {
  const assessorName = String(payload.assessorName || 'there').trim()
  const teamName = String(payload.teamName || 'Team').trim()
  const tryoutName = String(payload.tryoutName || 'Tryout').trim()
  const submittedAt = String(payload.submittedAt || '').trim()
  const orgName = String(payload.orgName || 'Tryout').trim()

  return {
    subject: `Assessment submitted - ${tryoutName}`,
    html: baseTemplate(
      `
      <h2 style="margin:0 0 8px;color:#111111;">Assessment Completed</h2>
      <p style="color:#555555;margin:0 0 24px;">Hi ${escapeHTML(assessorName)}, scores were submitted for <strong>${escapeHTML(tryoutName)}</strong>${teamName ? ` (${escapeHTML(teamName)})` : ''}.</p>
      ${submittedAt ? `<p style="color:#555555;">Submitted at: ${escapeHTML(submittedAt)}</p>` : ''}
    `,
      orgName
    ),
    text: `Assessment Completed\n\nHi ${assessorName}, scores were submitted for ${tryoutName}${teamName ? ` (${teamName})` : ''}.${submittedAt ? `\nSubmitted at: ${submittedAt}` : ''}`,
  }
}

const tryoutReminder = (payload: Record<string, unknown>): TemplateResult => {
  const guardianName = String(payload.guardianName || 'there').trim()
  const playerName = String(payload.playerName || 'Player').trim()
  const tryoutName = String(payload.tryoutName || 'Tryout').trim()
  const date = String(payload.date || '').trim()
  const time = String(payload.time || '').trim()
  const location = String(payload.location || '').trim()
  const portalUrl = String(payload.portalUrl || '').trim()
  const orgName = String(payload.orgName || 'Tryout').trim()

  return {
    subject: `Reminder: ${tryoutName} in 24 hours`,
    html: baseTemplate(
      `
      <h2 style="margin:0 0 8px;color:#111111;">24 Hour Reminder</h2>
      <p style="color:#555555;margin:0 0 24px;">Hi ${escapeHTML(guardianName)}, this is a reminder that <strong>${escapeHTML(playerName)}</strong> is scheduled for <strong>${escapeHTML(tryoutName)}</strong>.</p>
      <table style="width:100%;border:1px solid #eeeeee;border-radius:6px;padding:20px;margin-bottom:24px;" cellpadding="0" cellspacing="0">
        <tr><td style="padding:6px 0;color:#555555;">Date: ${escapeHTML(date)}${time ? ` @ ${escapeHTML(time)}` : ''}</td></tr>
        <tr><td style="padding:6px 0;color:#555555;">Location: ${escapeHTML(location)}</td></tr>
      </table>
      ${portalUrl ? button('Open Portal', portalUrl) : ''}
    `,
      orgName
    ),
    text: `24 Hour Reminder\n\nHi ${guardianName}, this is a reminder for ${playerName}.\nTryout: ${tryoutName}\nDate: ${date}${time ? ` @ ${time}` : ''}\nLocation: ${location}${portalUrl ? `\nPortal: ${portalUrl}` : ''}`,
  }
}

export const templateMap = {
  qr_confirmation: qrConfirmation,
  assessor_invite: assessorInvite,
  guardian_invite: guardianInvite,
  schedule_published: schedulePublished,
  team_assigned: teamAssigned,
  team_broadcast: teamBroadcast,
  assessment_complete: assessmentComplete,
  tryout_reminder: tryoutReminder,
} as const

export type EmailType = keyof typeof templateMap

export const hasTemplateType = (value: string): value is EmailType => value in templateMap
