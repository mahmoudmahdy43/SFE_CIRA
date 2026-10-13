/**
 * CRM connection dry run: log in, read ONE small report (Territory Visits, one team, one day), log out.
 * No database writes, nothing saved. Writes a short summary to $GITHUB_STEP_SUMMARY.
 */
import { appendFileSync } from 'node:fs'
import { CrmError, createClient, requireEnv } from './client.mjs'

const TEAM = process.env.CRM_TEAM || '1' // 1 = CIRA 1
const ATYPE = process.env.CRM_ATYPE || 'user' // login "Type": admin | user | hr
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

/** Visible text (scripts, styles and tags removed) and table count, for diagnosing an empty report. */
function pageDiagnostics(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const clean = (x) => x.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const heading = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(html)
  return { first300: text.slice(0, 300), tables: (html.match(/<table/gi) || []).length, title: title ? clean(title[1]) : '(none)', heading: heading ? clean(heading[1]) : '(none)' }
}

async function main() {
  requireEnv(['CRM_USER', 'CRM_PASS', 'CRM_BASE_URL'])
  const crm = createClient({ baseUrl: process.env.CRM_BASE_URL, user: process.env.CRM_USER, pass: process.env.CRM_PASS, atype: ATYPE })
  const t0 = Date.now()
  let loggedIn = false
  let logoutStatus = 'not sent'
  try {
    await crm.login()
    loggedIn = true
    const loginSeconds = (Date.now() - t0) / 1000
    const attempts = []
    // Open the search form first (what the browser does), then ask for the report with that page as Referer.
    const form = await crm.get('report_ter_visits_search.php', {})
    attempts.push(`${form.path}: HTTP ${form.status}${form.location ? ` -> Location ${form.location}` : ''}`)
    let last = null
    for (let back = 1; back <= MAX_LOOKBACK_DAYS; back++) {
      const day = isoDay(-back)
      const params = { team: TEAM, emp: 0, wteam: '', dfrom: day, dto: day, vtype: 1, vmembers: '', spoint: '', specialty: '', shift: '', clarification: '' }
      for (const k of [1, 2, 3, 4, 5, 6, -1, -2, -3]) params[`acctype_${k}`] = k
      const r = await crm.get('report_ter_visits.php', params, { referer: form.url })
      last = { day, ...r, ...countRows(r.text), ...pageDiagnostics(r.text) }
      attempts.push(`${r.path} (${day}): HTTP ${r.status}${r.location ? ` -> Location ${r.location}` : ''}, ${last.rows} rows, ${(r.bytes / 1024).toFixed(0)} KB`)
      if (last.rows > 0) break
    }
    const status = await crm.logout()
    logoutStatus = status === null ? 'request failed' : `HTTP ${status}`
    const empty = last.rows === 0
    const ok = last.status === 200 && !empty && last.headerOk
    summary([
      `## CRM dry run: ${ok ? 'OK' : 'FAILED'}`,
      '',
      ...(empty ? ['**empty report: check parameters**', ''] : []),
      '| Item | Value |',
      '|---|---|',
      `| Login | OK as type "${ATYPE}" (${loginSeconds.toFixed(1)} s) |`,
      `| Report | Territory Visits, team ${TEAM}, one day |`,
      `| Day read | ${last.day}${last.day === isoDay(-1) ? ' (yesterday)' : ''} |`,
      `| HTTP status | ${last.status} |`,
      `| Rows (all sections) | ${last.rows} (clinic visits: ${last.clinicRows}) |`,
      `| Size | ${(last.bytes / 1024).toFixed(0)} KB |`,
      `| Request time | ${last.seconds.toFixed(1)} s |`,
      `| Tables in page | ${last.tables} |`,
      `| Logout request | ${logoutStatus} |`,
      '',
      'Requests (path only, redirects not followed):',
      ...attempts.map((a) => `- ${a}`),
      '',
      `Page title: ${last.title}`,
      '',
      `First h1/h2: ${last.heading}`,
      '',
      'Query string sent (last request, no cookies):',
      '```',
      last.query,
      '```',
      'First 300 characters of the visible page text:',
      '```',
      last.first300,
      '```',
    ])
    if (!ok) process.exitCode = 1
  } finally {
    if (loggedIn && logoutStatus === 'not sent') await crm.logout()
  }
}

main().catch((e) => {
  const kind = e instanceof CrmError ? e.kind : 'error'
  const msg = e instanceof CrmError ? e.message : `Unexpected error: ${e?.name ?? 'error'}`
  summary([`## CRM dry run: FAILED (${kind})`, '', msg])
  process.exitCode = 1
})
