/**
 * Raw CRM "Vacations Report" (leaves): HTML saved as .xls — malformed, so string / regex parsing only (no DOMParser).
 * Pure functions (no DOM), unit-tested with Node's native TypeScript support (explicit .ts imports only).
 */
import { cleanText, monthsBetween } from '../visits/rawVisitsParse.ts'

export type LeaveStatus = 'Approved' | 'Rejected' | 'Pending'

/** The payload row sent to load_leaves_raw_chunk. `shift` is sent as in the file (AM / PM / Full). */
export interface RawLeaveRow {
  crm_id: number | string | null
  line: string
  employee: string
  leave_type: string
  shift: string
  start_date: string
  end_date: string
  status: LeaveStatus
  approver: string | null
  notes: string | null
}

export interface Tally { key: string; rows: number }

export interface RawLeavesFile {
  name: string
  /** Set when the file is not a Vacations Report: it is left out and this is shown as the error. */
  fatal: string | null
  titleRange: { from: string; to: string } | null
  rows: RawLeaveRow[]
  /** rowNumbers[k] = 1-based position of rows[k] among the data rows of the file. */
  rowNumbers: number[]
  errors: { row: number; reason: string }[]
  shortRows: number
  byLine: Tally[]
  byType: Tally[]
  byShift: Tally[]
  byStatus: Tally[]
}

/** One status per leave: Rejected if any step is Rejected; Approved only with at least one step and ALL Approved; else Pending. */
export function statusOfSteps(steps: string[]): LeaveStatus {
  const s = steps.map((x) => x.trim().toLowerCase())
  if (s.some((x) => x.startsWith('reject'))) return 'Rejected'
  if (s.length > 0 && s.every((x) => x.startsWith('approv'))) return 'Approved'
  return 'Pending'
}

export interface FlowStep { approver: string; status: string; date: string | null }

/** The nested Flow table: one step per `<tr>` that has `<td>` cells: # | approver | status | date. */
export function parseFlow(html: string): FlowStep[] {
  const steps: FlowStep[] = []
  for (const tr of html.split(/<tr\b/i).slice(1)) {
    const cells = tr.split(/<td\b/i).slice(1).map((c) => cleanText(c.slice(c.indexOf('>') + 1)))
    if (cells.length < 3) continue
    const status = /^(approved|rejected|pending)/i.test(cells[2]) ? cells[2] : cells.find((c) => /^(approved|rejected|pending)\b/i.test(c)) ?? cells[2]
    steps.push({ approver: cells[1], status, date: /\d{4}-\d\d-\d\d/.exec(cells[3] ?? '')?.[0] ?? null })
  }
  return steps
}

/** Name shown for the leave: the step that decided it (the rejecting one, else the last approver, else who it is waiting on). */
export function approverOf(steps: FlowStep[], status: LeaveStatus): string | null {
  if (steps.length === 0) return null
  const pick =
    status === 'Rejected' ? steps.find((s) => /^reject/i.test(s.status))
    : status === 'Approved' ? steps[steps.length - 1]
    : steps.find((s) => !/^approv/i.test(s.status))
  return pick?.approver || null
}

const ROW_SPLIT = /<tr\s+(?:valign=['"]top['"]\s+align=['"]center['"]|align=['"]center['"]\s+valign=['"]top['"])/i
const orNull = (s: string) => (s === '' ? null : s)
const inner = (cell: string) => cell.slice(cell.indexOf('>') + 1)

function tally(values: string[]): Tally[] {
  const m = new Map<string, number>()
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m].map(([key, rows]) => ({ key, rows })).sort((a, b) => b.rows - a.rows || a.key.localeCompare(b.key))
}

export function parseRawLeavesFile(name: string, text: string): RawLeavesFile {
  const cap = /<caption[^>]*>([\s\S]*?)(?:<\/caption>|$)/i.exec(text)
  const title = cleanText(cap ? cap[1] : text.slice(0, 5000))
  const empty = { name, titleRange: null, rows: [], rowNumbers: [], errors: [], shortRows: 0, byLine: [], byType: [], byShift: [], byStatus: [] }
  if (!/Vacations\s+Report/i.test(title)) {
    return { ...empty, fatal: `${name} is not a CRM “Vacations Report” (the caption must contain “Vacations Report”). Export the leaves from the CRM Vacations Report.` }
  }
  const r = /From\s+(\d{4}-\d\d-\d\d)\s+To\s+(\d{4}-\d\d-\d\d)/i.exec(title)
  const titleRange = r ? { from: r[1], to: r[2] } : null

  const rows: RawLeaveRow[] = []
  const rowNumbers: number[] = []
  const errors: { row: number; reason: string }[] = []
  let shortRows = 0
  text.split(ROW_SPLIT).slice(1).forEach((piece, idx) => {
    const rowNo = idx + 1
    // Take the nested Flow <table> out first, so splitting on <td> never cuts inside it. An unclosed table runs to the end of the row.
    let flowHtml = ''
    let main = piece
    const t0 = piece.search(/<table\b/i)
    if (t0 >= 0) {
      const closeAt = piece.slice(t0).search(/<\/table>/i)
      const t1 = closeAt < 0 ? piece.length : t0 + closeAt + '</table>'.length
      flowHtml = piece.slice(t0, t1)
      main = `${piece.slice(0, t0)}FLOW${piece.slice(t1)}`
    }
    const cells = main.split('<td').slice(1)
    if (cells.length < 10) { shortRows++; return }
    const t = (i: number) => cleanText(inner(cells[i] ?? ''))
    const start = /\d{4}-\d\d-\d\d/.exec(t(6))?.[0]
    const end = /\d{4}-\d\d-\d\d/.exec(t(7))?.[0] ?? start
    if (!start || !end) { errors.push({ row: rowNo, reason: 'no valid start date' }); return }
    const idDigits = t(1).replace(/\D/g, '')
    const steps = parseFlow(flowHtml)
    const status = statusOfSteps(steps.map((s) => s.status))
    rows.push({
      crm_id: idDigits === '' ? null : Number.isSafeInteger(Number(idDigits)) ? Number(idDigits) : idDigits,
      line: t(2), employee: t(3), leave_type: t(4), shift: t(5), start_date: start, end_date: end < start ? start : end,
      status, approver: approverOf(steps, status), notes: orNull(t(8)),
    })
    rowNumbers.push(rowNo)
  })
  return {
    ...empty, fatal: null, titleRange, rows, rowNumbers, errors, shortRows,
    byLine: tally(rows.map((x) => x.line || '(no line)')), byType: tally(rows.map((x) => x.leave_type || '(no type)')),
    byShift: tally(rows.map((x) => x.shift || '(no shift)')), byStatus: tally(rows.map((x) => x.status)),
  }
}

/** CRM IDs that appear more than once over all files (with how many times). */
export function duplicateIds(files: RawLeavesFile[]): { id: string; count: number }[] {
  const m = new Map<string, number>()
  for (const f of files) for (const r of f.rows) if (r.crm_id !== null) m.set(String(r.crm_id), (m.get(String(r.crm_id)) ?? 0) + 1)
  return [...m].filter(([, c]) => c > 1).map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

export interface LineRange { line: string; from: string; to: string; rows: number }

export interface RawLeavesPlan {
  rows: number
  /** Replace range per Line: the files' From/To widened to the min / max Start Date of that line's rows, over all files. */
  perLine: LineRange[]
  /** Every month from the earliest cleared / started date to the latest end date: what finish_upload refreshes. */
  months: string[]
  from: string | null
  to: string | null
  notApproved: number
}

export function planRawLeaves(files: RawLeavesFile[]): RawLeavesPlan {
  const by = new Map<string, LineRange>()
  let rows = 0
  let notApproved = 0
  let minStart: string | null = null
  let maxEnd: string | null = null
  for (const f of files) {
    if (f.fatal) continue
    const lines = new Map<string, RawLeaveRow[]>()
    for (const r of f.rows) {
      rows++
      if (r.status !== 'Approved') notApproved++
      if (minStart === null || r.start_date < minStart) minStart = r.start_date
      if (maxEnd === null || r.end_date > maxEnd) maxEnd = r.end_date
      lines.set(r.line, [...(lines.get(r.line) ?? []), r])
    }
    for (const [line, rs] of lines) {
      const starts = rs.map((r) => r.start_date).sort()
      let from = starts[0]
      let to = starts[starts.length - 1]
      if (f.titleRange) { if (f.titleRange.from < from) from = f.titleRange.from; if (f.titleRange.to > to) to = f.titleRange.to }
      const x = by.get(line)
      if (!x) by.set(line, { line, from, to, rows: rs.length })
      else { x.from = from < x.from ? from : x.from; x.to = to > x.to ? to : x.to; x.rows += rs.length }
    }
  }
  const perLine = [...by.values()].sort((a, b) => a.line.localeCompare(b.line, 'en', { numeric: true }))
  const from = perLine.length ? perLine.map((p) => p.from).sort()[0] : null
  const lastClear = perLine.length ? perLine.map((p) => p.to).sort().reverse()[0] : null
  const monthFrom = from !== null && minStart !== null ? (from < minStart ? from : minStart) : null
  const monthTo = maxEnd !== null && lastClear !== null ? (maxEnd > lastClear ? maxEnd : lastClear) : null
  return { rows, perLine, months: monthFrom && monthTo ? monthsBetween(monthFrom, monthTo) : [], from, to: lastClear, notApproved }
}

export interface EmployeeRejection { employee: string; kind: 'unknown employee' | 'employee has no CODE'; count: number }

/** `unknown employee X` / `employee has no CODE: X` -> one line per distinct employee with a count; everything else stays as rows. */
export function splitEmployeeRejections<T extends { reason: string }>(rejected: T[]): { employees: EmployeeRejection[]; other: T[] } {
  const by = new Map<string, EmployeeRejection>()
  const other: T[] = []
  for (const r of rejected) {
    const m = /^(unknown employee|employee has no code)\s*:?\s*(.+)$/i.exec(r.reason.trim())
    if (!m) { other.push(r); continue }
    const kind = m[1].toLowerCase() === 'unknown employee' ? 'unknown employee' : 'employee has no CODE'
    const employee = m[2].trim()
    const g = by.get(`${kind}|${employee}`) ?? { employee, kind, count: 0 }
    g.count++
    by.set(`${kind}|${employee}`, g)
  }
  return { employees: [...by.values()].sort((a, b) => b.count - a.count || a.employee.localeCompare(b.employee)), other }
}
