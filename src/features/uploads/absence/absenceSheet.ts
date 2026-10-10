import * as XLSX from 'xlsx'
import { normHeader, type Cell } from '../list/listParse'
import { cellAt, plain, type RowError, type Sheet } from '../list/listSheet'
import { inferDateOrder, keepText, parseVisitDate, type DateOrder } from '../visits/visitsParse'
import {
  ABSENCE_COLUMNS, codeFromCell, parseAbsenceShift, parseTimeOfDay,
  type AbsenceKind, type AbsenceRow, type ActivityRow, type LeaveRow, type OfficeWorkRow,
} from './absenceParse'

export interface ParsedAbsence<R extends AbsenceRow = AbsenceRow> {
  rows: R[]
  excelRows: number[]
  errors: RowError[]
  totalRows: number
  duplicates: number
  /** Rows whose CODE had no cached value / was an error (#REF!, #N/A) / blank. */
  unusableCodes: number
  undecidedDateOrder: boolean
  dateOrder: DateOrder
  headers: string[]
  missing: string[]
}

export function parseAbsenceSheet(kind: AbsenceKind, ws: Sheet, onProgress?: (done: number, total: number) => void): ParsedAbsence {
  const cols = ABSENCE_COLUMNS[kind]
  let first = 0, last = -1, colS = 0, colE = -1
  if (Array.isArray(ws)) {
    last = ws.length - 1
    colE = Math.max(...ws.slice(0, 5).map((r) => (r ? r.length : 0))) - 1
  } else if ((ws as XLSX.WorkSheet)['!ref']) {
    const range = XLSX.utils.decode_range((ws as XLSX.WorkSheet)['!ref'] as string)
    first = range.s.r; last = range.e.r; colS = range.s.c; colE = range.e.c
  }
  const headers: string[] = []
  for (let c = colS; c <= colE; c++) headers.push(String(plain(cellAt(ws, first, c)) ?? ''))

  const byNorm = new Map<string, number>()
  headers.forEach((h, i) => {
    const n = normHeader(h)
    if (n && !byNorm.has(n)) byNorm.set(n, i)
  })
  const index: Record<string, number> = {}
  const missing: string[] = []
  for (const c of cols) {
    const hit = [c.label, ...(c.aliases ?? [])].map(normHeader).find((n) => byNorm.has(n))
    if (hit !== undefined) index[c.key] = byNorm.get(hit) as number
    else if (c.required) missing.push(c.label)
  }
  const base: ParsedAbsence = {
    rows: [], excelRows: [], errors: [], totalRows: 0, duplicates: 0, unusableCodes: 0,
    undecidedDateOrder: false, dateOrder: 'dmy', headers: headers.filter((h) => h.trim() !== ''), missing,
  }
  if (missing.length) return base

  const cellOf = (r: number, key: string) => (index[key] === undefined ? undefined : cellAt(ws, r, colS + index[key]))
  const get = (r: number, key: string): Cell => {
    const c = cellOf(r, key)
    return c === undefined ? null : plain(c)
  }

  // Decide day/month order of text dates from every date column at once.
  const dateKeys = kind === 'leaves' ? ['start_date', 'end_date'] : ['day']
  const texts: string[] = []
  for (let r = first + 1; r <= last; r++) for (const k of dateKeys) {
    const v = get(r, k)
    if (typeof v === 'string') texts.push(v)
  }
  const { order, undecided } = inferDateOrder(texts)

  const rows: AbsenceRow[] = []
  const excelRows: number[] = []
  const errors: RowError[] = []
  let totalRows = 0
  let unusableCodes = 0
  const total = last - first

  for (let r = first + 1; r <= last; r++) {
    let any = false
    for (const c of cols) {
      if (c.key === 'code') {
        const cell = cellOf(r, 'code')
        if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') { any = true; break }
      } else if (get(r, c.key) !== null) { any = true; break }
    }
    if (!any) continue
    totalRows++
    const excelRow = r + 1
    const problems: string[] = []

    const code = codeFromCell(cellOf(r, 'code'))
    if (code.unusable) {
      unusableCodes++
      problems.push('CODE missing/formula error')
    }
    const shift = parseAbsenceShift(get(r, 'shift'))
    if (!shift) problems.push(`Shift must be AM, PM or Full (found "${get(r, 'shift') ?? ''}")`)

    if (kind === 'leaves') {
      const start = parseVisitDate(get(r, 'start_date'), order)
      const end = parseVisitDate(get(r, 'end_date'), order)
      if (!start) problems.push('Start Date is blank or not valid')
      if (!end) problems.push('End Date is blank or not valid')
      if (start && end && end < start) problems.push('End Date is before Start Date')
      if (problems.length) { errors.push({ excelRow, reason: problems.join('; ') }); continue }
      const row: LeaveRow = {
        month: `${(start as string).slice(0, 7)}-01`,
        code: code.code as string,
        leave_type: keepText(get(r, 'leave_type')),
        shift: (shift as { value: string }).value,
        start_date: start as string,
        end_date: end as string,
        status: keepText(get(r, 'status')),
        notes: keepText(get(r, 'notes')),
      }
      rows.push(row)
    } else {
      const day = parseVisitDate(get(r, 'day'), order)
      if (!day) problems.push('Date is blank or not valid')
      let atTime: string | null = null
      if (kind === 'activities') {
        const t = parseTimeOfDay(get(r, 'at_time'))
        if (!t.ok) problems.push(`Time is not valid (found "${get(r, 'at_time') ?? ''}")`)
        else atTime = t.value
      }
      if (problems.length) { errors.push({ excelRow, reason: problems.join('; ') }); continue }
      const month = `${(day as string).slice(0, 7)}-01`
      if (kind === 'office_work') {
        const row: OfficeWorkRow = {
          month, code: code.code as string, ow_type: keepText(get(r, 'ow_type')), shift: (shift as { value: string }).value,
          day: day as string, members: keepText(get(r, 'members')), comments: keepText(get(r, 'comments')),
        }
        rows.push(row)
      } else {
        const row: ActivityRow = {
          month, code: code.code as string, act_type: keepText(get(r, 'act_type')), shift: (shift as { value: string }).value,
          day: day as string, at_time: atTime, members: keepText(get(r, 'members')), comments: keepText(get(r, 'comments')),
        }
        rows.push(row)
      }
    }
    excelRows.push(excelRow)
    if (onProgress && (r - first) % 5000 === 0) onProgress(r - first, total)
  }
  onProgress?.(total, total)
  return { ...base, rows, excelRows, errors, totalRows, unusableCodes, undecidedDateOrder: undecided && texts.length > 0, dateOrder: order, missing: [] }
}
