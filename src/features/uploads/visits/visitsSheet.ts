import * as XLSX from 'xlsx'
import type { Cell } from '../list/listParse'
import { cellAt, plain, type RowError, type Sheet } from '../list/listSheet'
import {
  codeText, idText, inferDateOrder, keepText, matchVisitHeaders, parseShift, parseVisitDate, parseVisitRoot, parseVisitType,
  VISIT_COLUMNS, type DateOrder, type VisitRow,
} from './visitsParse'

export interface ParsedVisits {
  rows: VisitRow[]
  excelRows: number[]
  errors: RowError[]
  totalRows: number
  duplicates: number
  /** Visit Root values other than Planned / Direct. */
  otherRoots: number
  /** Text dates where the day/month order could not be proven from the file. */
  undecidedDateOrder: boolean
  dateOrder: DateOrder
  headers: string[]
  missing: string[]
}

export function parseVisitsSheet(ws: Sheet, onProgress?: (done: number, total: number) => void): ParsedVisits {
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
  const { index, missing } = matchVisitHeaders(headers)
  const base: ParsedVisits = {
    rows: [], excelRows: [], errors: [], totalRows: 0, duplicates: 0, otherRoots: 0,
    undecidedDateOrder: false, dateOrder: 'dmy', headers: headers.filter((h) => h.trim() !== ''), missing,
  }
  if (missing.length) return base

  const get = (r: number, key: (typeof VISIT_COLUMNS)[number]['key']): Cell => {
    const c = index[key]
    return c === undefined ? null : plain(cellAt(ws, r, colS + c))
  }

  // Pass 1: decide day/month order of text dates from the whole column.
  const texts: string[] = []
  for (let r = first + 1; r <= last; r++) {
    const v = get(r, 'visit_date')
    if (typeof v === 'string') texts.push(v)
  }
  const { order, undecided } = inferDateOrder(texts)

  const rows: VisitRow[] = []
  const excelRows: number[] = []
  const errors: RowError[] = []
  let totalRows = 0
  let otherRoots = 0
  const total = last - first

  for (let r = first + 1; r <= last; r++) {
    let any = false
    for (const c of VISIT_COLUMNS) {
      if (get(r, c.key) !== null) { any = true; break }
    }
    if (!any) continue
    totalRows++
    const excelRow = r + 1

    const date = parseVisitDate(get(r, 'visit_date'), order)
    const shift = parseShift(get(r, 'shift'))
    const type = parseVisitType(get(r, 'visit_type'))
    const code = codeText(get(r, 'code'))
    const doctor = keepText(get(r, 'doctor_name'))

    const problems: string[] = []
    if (!date) problems.push(get(r, 'visit_date') === null ? 'Date is blank' : 'Date is not valid')
    if (!shift) problems.push(`SHIFT must be AM or PM (found "${get(r, 'shift') ?? ''}")`)
    if (!type) problems.push(`Visit Type must be S/D or Single/Double (found "${get(r, 'visit_type') ?? ''}")`)
    if (!code) problems.push('CODE is blank')
    if (!doctor) problems.push('Doctor Name is blank')
    if (problems.length) {
      errors.push({ excelRow, reason: problems.join('; ') })
      continue
    }
    const root = parseVisitRoot(get(r, 'visit_root'))
    if (!root.known) otherRoots++
    rows.push({
      month: `${(date as string).slice(0, 7)}-01`,
      territory: keepText(get(r, 'territory')),
      acc_type: keepText(get(r, 'acc_type')),
      account_id: idText(get(r, 'account_id')),
      doctor_id: idText(get(r, 'doctor_id')),
      code: code as string,
      shift: shift as 'AM' | 'PM',
      visit_type: type as 'S' | 'D',
      acc_name: keepText(get(r, 'acc_name')),
      doctor_name: doctor as string,
      visit_date: date as string,
      members: keepText(get(r, 'members')),
      notes: keepText(get(r, 'notes')),
      visit_root: root.value,
      source: keepText(get(r, 'source')),
    })
    excelRows.push(excelRow)
    if (onProgress && (r - first) % 5000 === 0) onProgress(r - first, total)
  }
  onProgress?.(total, total)
  return { ...base, rows, excelRows, errors, totalRows, otherRoots, undecidedDateOrder: undecided && texts.length > 0, dateOrder: order, missing: [] }
}
