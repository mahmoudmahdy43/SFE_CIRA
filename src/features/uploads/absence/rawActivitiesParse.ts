/**
 * Raw CRM Activities file (the "Actual Visits Report" with a Visits and an Activities section): HTML saved as .xls,
 * malformed, so string / regex parsing only. Pure functions, unit-tested with Node's native TypeScript support.
 */
import { cleanText, monthsBetween } from '../visits/rawVisitsParse.ts'

/** The payload row sent to load_activities_raw_chunk. */
export interface RawActivityRow {
  crm_id: number | string | null
  act_type: string
  shift: string
  day: string
  at_time: string | null
  members: string
  comments: string | null
}

export interface Tally { key: string; rows: number }

export interface RawActivitiesFile {
  name: string
  /** Set when the file cannot be used as an Activities upload: shown as the error, the file is left out. */
  fatal: string | null
  /** Visit rows found in the Visits section (ignored here). */
  visitRows: number
  titleRange: { from: string; to: string } | null
  rows: RawActivityRow[]
  rowNumbers: number[]
  errors: { row: number; reason: string }[]
  shortRows: number
  noMembers: number
  byType: Tally[]
  byShift: Tally[]
  people: number
}

const ROW_SPLIT = /<tr\s+align=['"]center['"]\s+valign=['"]top['"]/i
const BR = /<br\s*\/?>/i
const inner = (cell: string) => cell.slice(cell.indexOf('>') + 1)
const orNull = (s: string) => (s === '' ? null : s)
const stripDash = (s: string) => s.replace(/^[\s-]+/, '').trim()

/** Members cell: names separated by `<br/>`, each maybe prefixed by `-`; distinct names in order. */
export function splitPeople(cell: string): string[] {
  const out: string[] = []
  for (const p of cell.split(BR)) {
    const name = stripDash(cleanText(p))
    if (name !== '' && !out.includes(name)) out.push(name)
  }
  return out
}

function tally(values: string[]): Tally[] {
  const m = new Map<string, number>()
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m].map(([key, rows]) => ({ key, rows })).sort((a, b) => b.rows - a.rows || a.key.localeCompare(b.key))
}

const LEGEND = (word: string) => new RegExp(`<legend[^>]*>\\s*${word}\\s*<\\/legend>`, 'i')

/** Text of one section: from its legend to the next legend (or the end). */
function section(text: string, word: string): string {
  const m = LEGEND(word).exec(text)
  if (!m) return ''
  const rest = text.slice(m.index + m[0].length)
  const next = rest.search(/<legend\b/i)
  return next < 0 ? rest : rest.slice(0, next)
}

export function parseRawActivitiesFile(name: string, text: string): RawActivitiesFile {
  const base = { name, visitRows: 0, titleRange: null, rows: [] as RawActivityRow[], rowNumbers: [] as number[], errors: [] as { row: number; reason: string }[], shortRows: 0, noMembers: 0, byType: [], byShift: [], people: 0 }
  const cap = /<caption[^>]*>([\s\S]*?)(?:<\/caption>|$)/i.exec(text)
  const title = cleanText(cap ? cap[1] : text.slice(0, 5000))
  if (!/Actual\s+Visits\s+Report/i.test(title) || !LEGEND('Activities').test(text)) {
    return { ...base, fatal: `${name} is not a CRM Actual Visits Report with an Activities section (caption “Actual Visits Report …” and a “Activities” legend are expected).` }
  }
  const r = /From\s+(\d{4}-\d\d-\d\d)\s+To\s+(\d{4}-\d\d-\d\d)/i.exec(title)
  const titleRange = r ? { from: r[1], to: r[2] } : null
  const visitRows = Math.max(0, section(text, 'Visits').split(ROW_SPLIT).length - 1)

  const rows: RawActivityRow[] = []
  const rowNumbers: number[] = []
  const errors: { row: number; reason: string }[] = []
  const people = new Set<string>()
  let shortRows = 0
  let noMembers = 0
  section(text, 'Activities').split(ROW_SPLIT).slice(1).forEach((piece, idx) => {
    const rowNo = idx + 1
    const cells = piece.split('<td').slice(1)
    if (cells.length < 9) { shortRows++; return }
    const t = (i: number) => cleanText(inner(cells[i]))
    const day = /\d{4}-\d\d-\d\d/.exec(t(5))?.[0]
    if (!day) { errors.push({ row: rowNo, reason: 'no valid date' }); return }
    const idDigits = t(1).replace(/\D/g, '')
    const names = splitPeople(inner(cells[7]))
    if (names.length === 0) noMembers++
    names.forEach((n) => people.add(n))
    rows.push({
      crm_id: idDigits === '' ? null : Number.isSafeInteger(Number(idDigits)) ? Number(idDigits) : idDigits,
      act_type: t(3), shift: t(4).toUpperCase(), day, at_time: /\d\d:\d\d/.exec(t(6))?.[0] ?? null,
      members: names.join(' | '), comments: orNull(stripDash(t(8))),
    })
    rowNumbers.push(rowNo)
  })

  if (rows.length === 0) {
    const msg = visitRows > 0 ? `${name} is a visits file (${visitRows.toLocaleString()} visit rows, no activities): use the Visits upload.` : `${name}: no activities in this file.`
    return { ...base, fatal: msg, visitRows, titleRange, errors, shortRows }
  }
  return {
    ...base, fatal: null, visitRows, titleRange, rows, rowNumbers, errors, shortRows, noMembers, people: people.size,
    byType: tally(rows.map((x) => x.act_type || '(no type)')), byShift: tally(rows.map((x) => x.shift || '(no shift)')),
  }
}

/** First digit of "…1_10…" = the line number to suggest (null when the name has no such pattern or the digit is 0). */
export function guessActivityLine(fileName: string): number | null {
  const m = /(\d)[_\s-]*(\d{1,2})/.exec(fileName)
  const n = m ? Number(m[1]) : 0
  return n >= 1 ? n : null
}

export interface PlannedActivityFile { file: RawActivitiesFile; line: number | null }
export interface LineRange { line: number; from: string; to: string; rows: number }

export interface RawActivitiesPlan {
  rows: number
  perLine: LineRange[]
  from: string | null
  to: string | null
  /** Every month from the first to the last day cleared / loaded: refreshed after the load. */
  months: string[]
  overlaps: string[]
}

/** Replace range per chosen line: the files' From/To widened to the min / max Date of the rows. */
export function planRawActivities(files: PlannedActivityFile[]): RawActivitiesPlan {
  const by = new Map<number, LineRange>()
  const spans = files.map((p) => {
    const days = p.file.rows.map((r) => r.day).sort()
    if (days.length === 0) return null
    let from = days[0]
    let to = days[days.length - 1]
    if (p.file.titleRange) { if (p.file.titleRange.from < from) from = p.file.titleRange.from; if (p.file.titleRange.to > to) to = p.file.titleRange.to }
    return { from, to }
  })
  let rows = 0
  const overlaps: string[] = []
  files.forEach((p, i) => {
    rows += p.file.rows.length
    const s = spans[i]
    if (!s || p.line === null) return
    const x = by.get(p.line)
    if (!x) by.set(p.line, { line: p.line, from: s.from, to: s.to, rows: p.file.rows.length })
    else { if (s.from < x.from) x.from = s.from; if (s.to > x.to) x.to = s.to; x.rows += p.file.rows.length }
    for (let j = i + 1; j < files.length; j++) {
      const o = spans[j]
      if (o && files[j].line === p.line && s.from <= o.to && o.from <= s.to) overlaps.push(`${p.file.name} and ${files[j].file.name} have the same line and overlapping dates (${s.from} → ${s.to} / ${o.from} → ${o.to}) — likely a duplicate.`)
    }
  })
  const perLine = [...by.values()].sort((a, b) => a.line - b.line)
  const from = perLine.length ? perLine.map((p) => p.from).sort()[0] : null
  const to = perLine.length ? perLine.map((p) => p.to).sort().reverse()[0] : null
  return { rows, perLine, from, to, months: from && to ? monthsBetween(from, to) : [], overlaps }
}
