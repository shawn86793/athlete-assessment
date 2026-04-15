/**
 * Integration test: QR Registration → Cloud Storage → Assessment Roster Pipeline
 *
 * This script tests the full end-to-end flow:
 * 1. Create a cloud session (assessment) via POST /api/cloud/session
 * 2. Verify QR code SVG generation via GET /assessment/:code/qr.svg
 * 3. Verify registration form renders via GET /assessment/:code/register
 * 4. Submit a player registration via POST /assessment/:code/register
 * 5. Verify the player appears in the cloud blob via GET /api/cloud/:id
 * 6. Submit a second registration to verify concurrent writes
 * 7. Verify both players exist in the assessment roster
 */

const BASE = process.env.TEST_BASE_URL || 'http://localhost:8888'

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    passed++
    console.log(`  ✓ ${message}`)
  } else {
    failed++
    console.error(`  ✗ FAIL: ${message}`)
  }
}

async function test(name, fn) {
  console.log(`\n▶ ${name}`)
  try {
    await fn()
  } catch (err) {
    failed++
    console.error(`  ✗ ERROR: ${err.message}`)
  }
}

// Helper to create a mock tryout
function mockTryout() {
  const id = Math.random().toString(36).slice(2, 14)
  return {
    id,
    name: 'Test Assessment ' + id.slice(0, 4),
    sport: 'Hockey',
    tryoutDate: '2026-03-15',
    startTime: '10:00',
    rink: 'Test Arena',
    roster: [],
    evals: [],
    assessors: [],
    settings: { categories: [] },
    updatedAt: Date.now(),
    createdAt: Date.now(),
  }
}

// Helper to create registration form data
function registrationFormData(overrides = {}) {
  const data = new URLSearchParams({
    firstName: 'Test',
    lastName: 'Player',
    yearOfBirth: '2015',
    currentTeam: 'Test Hawks',
    currentLevel: 'AA',
    positionTryingOutFor: 'Forward',
    guardianName: 'Jane Parent',
    guardianPhone: '555-123-4567',
    guardianEmail: 'parent@test.example',
    aboutChild: 'Loves hockey and skating',
    waiver: 'yes',
    ...overrides,
  })
  return data.toString()
}

let cloudCode = null

await test('Step 1: Create a cloud session', async () => {
  const tryout = mockTryout()
  const res = await fetch(`${BASE}/api/cloud/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tryout }),
  })

  assert(res.ok, `POST /api/cloud/session returned status ${res.status} (expected 2xx)`)

  const data = await res.json()
  assert(typeof data.id === 'string' && data.id.length >= 4, `Returned cloud code: "${data.id}"`)

  cloudCode = data.id
  console.log(`  → Cloud session code: ${cloudCode}`)
})

await test('Step 2: Verify QR code SVG generation', async () => {
  if (!cloudCode) return assert(false, 'No cloud code from Step 1')

  const res = await fetch(`${BASE}/assessment/${cloudCode}/qr.svg`)
  assert(res.ok, `GET /assessment/${cloudCode}/qr.svg returned status ${res.status}`)

  const contentType = res.headers.get('content-type') || ''
  assert(contentType.includes('image/svg+xml'), `Content-Type is SVG: "${contentType}"`)

  const svg = await res.text()
  assert(svg.includes('<svg'), 'Response contains <svg> element')
  assert(svg.includes('viewBox'), 'SVG has viewBox attribute')
  assert(svg.length > 200, `SVG has substantial content (${svg.length} chars)`)

  // Verify the QR code is scannable by checking it contains path data
  assert(svg.includes('<path') || svg.includes('<rect'), 'SVG contains QR code drawing elements')
})

await test('Step 3: Verify QR print page generation', async () => {
  if (!cloudCode) return assert(false, 'No cloud code from Step 1')

  const res = await fetch(`${BASE}/assessment/${cloudCode}/qr-print`)
  assert(res.ok, `GET /assessment/${cloudCode}/qr-print returned status ${res.status}`)

  const html = await res.text()
  assert(html.includes('<svg'), 'Print page contains SVG QR code')
  assert(html.includes('window.print()'), 'Print page auto-triggers print dialog')
  assert(html.includes(cloudCode), 'Print page shows assessment code')
})

await test('Step 4: Verify registration form renders', async () => {
  if (!cloudCode) return assert(false, 'No cloud code from Step 1')

  const res = await fetch(`${BASE}/assessment/${cloudCode}/register`)
  assert(res.ok, `GET /assessment/${cloudCode}/register returned status ${res.status}`)

  const html = await res.text()
  assert(html.includes('Assessment Registration'), 'Form page has registration title')
  assert(html.includes('firstName'), 'Form has firstName field')
  assert(html.includes('lastName'), 'Form has lastName field')
  assert(html.includes('yearOfBirth'), 'Form has yearOfBirth field')
  assert(html.includes('positionTryingOutFor'), 'Form has position field')
  assert(html.includes('guardianName'), 'Form has guardianName field')
  assert(html.includes('guardianEmail'), 'Form has guardianEmail field')
  assert(html.includes('guardianPhone'), 'Form has guardianPhone field')
  assert(html.includes('waiver'), 'Form has waiver checkbox')
  assert(html.includes('Submit Registration'), 'Form has submit button')

  // Verify sport-specific options are rendered (Hockey)
  assert(html.includes('Forward'), 'Form has Forward position option')
  assert(html.includes('Defense'), 'Form has Defense position option')
  assert(html.includes('Goalie'), 'Form has Goalie position option')
  assert(html.includes('AAA'), 'Form has AAA level option')
})

await test('Step 5: Submit player registration (Player 1)', async () => {
  if (!cloudCode) return assert(false, 'No cloud code from Step 1')

  const res = await fetch(`${BASE}/assessment/${cloudCode}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: registrationFormData({
      firstName: 'Alice',
      lastName: 'Smith',
      yearOfBirth: '2014',
      currentTeam: 'Maple Leafs Minor',
      currentLevel: 'AA',
      positionTryingOutFor: 'Forward',
      guardianName: 'Bob Smith',
      guardianPhone: '555-111-2222',
      guardianEmail: 'bob.smith@test.example',
      aboutChild: 'Fast skater, loves the game',
    }),
    redirect: 'manual',
  })

  assert(res.status === 200, `POST registration returned status ${res.status} (expected 200)`)

  const html = await res.text()
  assert(html.includes('Registration successful') || html.includes('Thank You'), 'Response indicates success')
  assert(html.includes('Alice Smith'), 'Response includes player name')
})

await test('Step 6: Verify Player 1 appears in cloud roster', async () => {
  if (!cloudCode) return assert(false, 'No cloud code from Step 1')

  const res = await fetch(`${BASE}/api/cloud/${cloudCode}`)
  assert(res.ok, `GET /api/cloud/${cloudCode} returned status ${res.status}`)

  const data = await res.json()
  assert(data.tryout && typeof data.tryout === 'object', 'Response has tryout object')

  const roster = data.tryout.roster
  assert(Array.isArray(roster), 'Tryout has roster array')
  assert(roster.length >= 1, `Roster has ${roster.length} player(s) (expected >= 1)`)

  const alice = roster.find(p => p.first === 'Alice' && p.last === 'Smith')
  assert(!!alice, 'Alice Smith is in the roster')

  if (alice) {
    assert(alice.registrationSource === 'qr', `registrationSource is "qr" (got "${alice.registrationSource}")`)
    assert(alice.pos === 'Forward', `Position is "Forward" (got "${alice.pos}")`)
    assert(alice.yearOfBirth === '2014', `Year of birth is "2014" (got "${alice.yearOfBirth}")`)
    assert(alice.currentLevel === 'AA', `Current level is "AA" (got "${alice.currentLevel}")`)
    assert(alice.guardianName === 'Bob Smith', `Guardian name matches (got "${alice.guardianName}")`)
    assert(alice.guardianEmail === 'bob.smith@test.example', `Guardian email matches`)
    assert(alice.guardianPhone === '555-111-2222', `Guardian phone matches`)
    assert(typeof alice.id === 'string' && alice.id.length === 24, `Player has valid 24-char hex ID: "${alice.id}"`)
    assert(typeof alice.createdAt === 'number' && alice.createdAt > 0, 'Player has createdAt timestamp')
    assert(typeof alice.updatedAt === 'number' && alice.updatedAt > 0, 'Player has updatedAt timestamp')
    assert(typeof alice.waiverAcceptedAt === 'number' && alice.waiverAcceptedAt > 0, 'Player has waiverAcceptedAt timestamp')
  }
})

await test('Step 7: Submit second player registration (Player 2)', async () => {
  if (!cloudCode) return assert(false, 'No cloud code from Step 1')

  const res = await fetch(`${BASE}/assessment/${cloudCode}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: registrationFormData({
      firstName: 'Charlie',
      lastName: 'Brown',
      yearOfBirth: '2013',
      currentTeam: 'Canucks Youth',
      currentLevel: 'AAA',
      positionTryingOutFor: 'Defense',
      guardianName: 'Lucy Brown',
      guardianPhone: '555-333-4444',
      guardianEmail: 'lucy.brown@test.example',
      aboutChild: 'Strong defensive player',
    }),
    redirect: 'manual',
  })

  assert(res.status === 200, `POST registration returned status ${res.status} (expected 200)`)

  const html = await res.text()
  assert(html.includes('Registration successful') || html.includes('Thank You'), 'Response indicates success')
  assert(html.includes('Charlie Brown'), 'Response includes player name')
})

await test('Step 8: Verify both players exist in cloud roster (data migration)', async () => {
  if (!cloudCode) return assert(false, 'No cloud code from Step 1')

  const res = await fetch(`${BASE}/api/cloud/${cloudCode}`)
  assert(res.ok, `GET /api/cloud/${cloudCode} returned status ${res.status}`)

  const data = await res.json()
  const roster = data.tryout?.roster || []

  assert(roster.length >= 2, `Roster has ${roster.length} players (expected >= 2)`)

  const alice = roster.find(p => p.first === 'Alice' && p.last === 'Smith')
  const charlie = roster.find(p => p.first === 'Charlie' && p.last === 'Brown')

  assert(!!alice, 'Alice Smith is in the roster')
  assert(!!charlie, 'Charlie Brown is in the roster')

  if (alice && charlie) {
    assert(alice.id !== charlie.id, 'Players have unique IDs')
    assert(alice.registrationSource === 'qr', 'Alice has qr registration source')
    assert(charlie.registrationSource === 'qr', 'Charlie has qr registration source')
    assert(alice.pos === 'Forward', 'Alice is Forward')
    assert(charlie.pos === 'Defense', 'Charlie is Defense')
  }

  // Verify assessment-level fields
  const tryout = data.tryout
  assert(typeof tryout.updatedAt === 'number', 'Assessment has updatedAt timestamp')
  assert(tryout.name && tryout.name.startsWith('Test Assessment'), `Assessment name preserved: "${tryout.name}"`)
  assert(tryout.sport === 'Hockey', `Sport is Hockey: "${tryout.sport}"`)
})

await test('Step 9: Verify roster data can be read back (simulating cloud pull)', async () => {
  if (!cloudCode) return assert(false, 'No cloud code from Step 1')

  // Simulate what pullCloudTryout does: GET the cloud tryout
  const res = await fetch(`${BASE}/api/cloud/${cloudCode}`)
  assert(res.ok, 'Cloud tryout is readable')

  const data = await res.json()
  const remoteTryout = data.tryout

  // Simulate mergeMissingQrRegistrations
  const localRoster = []
  const remoteRoster = Array.isArray(remoteTryout?.roster) ? remoteTryout.roster : []
  const localIds = new Set()

  const qrAdditions = remoteRoster.filter(player => {
    if (!player || typeof player !== 'object') return false
    const id = String(player.id || '').trim()
    if (!id || localIds.has(id)) return false
    const source = String(player.registrationSource || '').trim().toLowerCase()
    if (source !== 'qr') return false
    localIds.add(id)
    return true
  })

  assert(qrAdditions.length >= 2, `mergeMissingQrRegistrations would add ${qrAdditions.length} players (expected >= 2)`)

  // Verify each player has all required fields for the local roster
  for (const player of qrAdditions) {
    const name = `${player.first} ${player.last}`
    assert(typeof player.id === 'string' && player.id.length > 0, `${name} has valid ID`)
    assert(typeof player.first === 'string' && player.first.length > 0, `${name} has first name`)
    assert(typeof player.last === 'string' && player.last.length > 0, `${name} has last name`)
    assert(player.registrationSource === 'qr', `${name} has qr source`)
    assert(typeof player.pos === 'string', `${name} has position`)
    assert(typeof player.guardianName === 'string', `${name} has guardian name`)
    assert(typeof player.guardianEmail === 'string', `${name} has guardian email`)
    assert(typeof player.guardianPhone === 'string', `${name} has guardian phone`)
    assert(typeof player.createdAt === 'number', `${name} has createdAt`)
    assert(typeof player.updatedAt === 'number', `${name} has updatedAt`)
  }
})

await test('Step 10: Verify cloud tryout can be updated (simulating cloud push)', async () => {
  if (!cloudCode) return assert(false, 'No cloud code from Step 1')

  // Read current state
  const getRes = await fetch(`${BASE}/api/cloud/${cloudCode}`)
  const getData = await getRes.json()
  const tryout = getData.tryout

  // Add a manually-added player (non-QR) to simulate local roster edit
  tryout.roster.push({
    id: 'manual_' + Date.now().toString(36),
    first: 'Manual',
    last: 'Player',
    anonymous: false,
    jersey: '99',
    pos: 'Goalie',
    shoots: 'L',
    assignedAssessor: '',
    registrationSource: 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  tryout.updatedAt = Date.now()

  // Push updated tryout
  const putRes = await fetch(`${BASE}/api/cloud/${cloudCode}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tryout }),
  })

  assert(putRes.ok, `PUT /api/cloud/${cloudCode} returned status ${putRes.status}`)

  const putData = await putRes.json()
  assert(putData.ok === true, 'PUT response confirms success')

  // Verify the roster now has all three players
  const verifyRes = await fetch(`${BASE}/api/cloud/${cloudCode}`)
  const verifyData = await verifyRes.json()
  const roster = verifyData.tryout?.roster || []

  assert(roster.length >= 3, `Roster has ${roster.length} players after push (expected >= 3)`)

  const qrPlayers = roster.filter(p => p.registrationSource === 'qr')
  const manualPlayers = roster.filter(p => p.registrationSource === 'manual')
  assert(qrPlayers.length >= 2, `${qrPlayers.length} QR-registered players preserved`)
  assert(manualPlayers.length >= 1, `${manualPlayers.length} manually-added player(s) preserved`)
})

await test('Step 11: Verify registration form validation', async () => {
  if (!cloudCode) return assert(false, 'No cloud code from Step 1')

  // Missing required fields
  const res1 = await fetch(`${BASE}/assessment/${cloudCode}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ firstName: 'Incomplete' }).toString(),
    redirect: 'manual',
  })
  assert(res1.status === 400, `Incomplete form returns 400 (got ${res1.status})`)

  // Missing waiver
  const res2 = await fetch(`${BASE}/assessment/${cloudCode}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: registrationFormData({ waiver: '' }),
    redirect: 'manual',
  })
  assert(res2.status === 400, `Missing waiver returns 400 (got ${res2.status})`)

  // Invalid year of birth
  const res3 = await fetch(`${BASE}/assessment/${cloudCode}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: registrationFormData({ yearOfBirth: '1800' }),
    redirect: 'manual',
  })
  assert(res3.status === 400, `Invalid year of birth returns 400 (got ${res3.status})`)
})

await test('Step 12: Verify invalid assessment code returns proper error', async () => {
  const res = await fetch(`${BASE}/assessment/ZZZZZ9/register`)
  assert(res.status === 404, `Non-existent code returns 404 (got ${res.status})`)

  const html = await res.text()
  assert(html.includes('not found') || html.includes('Not Found'), 'Error page indicates assessment not found')
})

// Summary
console.log('\n' + '='.repeat(50))
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`)
console.log('='.repeat(50))

if (failed > 0) {
  process.exit(1)
} else {
  console.log('\n✓ All tests passed! Registration pipeline is working correctly.')
}
