/**
 * CRM connection dry run: log in, read ONE small report (Territory Visits, one team, one day), log out.
 * No database writes, nothing saved. Writes a short summary to $GITHUB_STEP_SUMMARY.
 */
import { appendFileSync } from 'node:fs'
import { CrmError, createClient, requireEnv } from './client.mjs'

const TEAM = process.env.CRM_TEAM || '1' // 1 = CIRA 1
const MAX_LOOKBACK_DAYS = 4 // a weekend day has no visits: go back until a day has rows

function summary(lines) {
  const text = lines.join('\n') + '\n'
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
}

/** Calendar day `offset` days from today in Cairo time (UTC+2 is close enough to pick "yesterday"). */
const isoDay = (offset) => new Date(Date.now() + 2 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10)

/** Distinct visit / activity ids in the Territory Visits response (rows of every section). */
function countRows(html) {
  const ids = new Set([...html.matchAll(/user\.visit\.php\?action=view&id=(\d+)/g)].map((m) => m[1]))
  const actual = new Set([...html.matchAll(/name='actual_(\d+)'/g)].map((m) => m[1]))
  return { rows: ids.size, clinicRows: actual.size, headerOk: /Visit Root/.test(html) }
}

async function main() {
  requireEnv(['CRM_USER', 'CRM_PASS', 'CRM_BASE_URL'])
  const crm = createClient({ baseUrl: process.env.CRM_BASE_URL, user: process.env.CRM_USER, pass: process.env.CRM_PASS })
  const t0 = Date.now()
  let loggedIn = false
  let loggedOut = false
  try {
    await crm.login()
    loggedIn = true
    const loginSeconds = (Date.now() - t0) / 1000
    let result = null
    for (let back = 1; back <= MAX_LOOKBACK_DAYS; back++) {
      const day = isoDay(-back)
      const params = { team: TEAM, emp: 0, wteam: '', dfrom: day, dto: day, vtype: 1, vmembers: '', spoint: '', specialty: '', shift: '', clarification: '' }
      for (const k of [1, 2, 3, 4, 5, 6, -1, -2, -3]) params[`acctype_${k}`] = k
      const r = await crm.get('report_ter_visits.php', params)
      result = { day, ...r, ...countRows(r.text) }
      if (result.rows > 0) break
    }
    loggedOut = await crm.logout()
    const ok = result.status === 200 && result.rows > 0 && result.headerOk
    summary([
      `## CRM dry run: ${ok ? 'OK' : 'FAILED'}`,
      '',
      '| Item | Value |',
      '|---|---|',
      `| Login | OK (${loginSeconds.toFixed(1)} s) |`,
      `| Report | Territory Visits, team ${TEAM}, one day |`,
      `| Day read | ${result.day}${result.day === isoDay(-1) ? ' (yesterday)' : ' (latest day with rows)'} |`,
      `| HTTP status | ${result.status} |`,
      `| Rows (all sections) | ${result.rows} (clinic visits: ${result.clinicRows}) |`,
      `| Size | ${(result.bytes / 1024).toFixed(0)} KB |`,
      `| Request time | ${result.seconds.toFixed(1)} s |`,
      `| Logged out | ${loggedOut ? 'yes (login form shown again)' : 'could not confirm'} |`,
    ])
    if (!ok) process.exitCode = 1
  } finally {
    if (loggedIn && !loggedOut) await crm.logout()
  }
}

main().catch((e) => {
  const kind = e instanceof CrmError ? e.kind : 'error'
  const msg = e instanceof CrmError ? e.message : `Unexpected error: ${e?.name ?? 'error'}`
  summary([`## CRM dry run: FAILED (${kind})`, '', msg])
  process.exitCode = 1
})
