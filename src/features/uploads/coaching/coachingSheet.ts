import * as XLSX from 'xlsx'
import type { Cell } from '../list/listParse'
import { cellAt, plain, type RowError, type Sheet } from '../list/listSheet'
import {
  COACHING_COLUMNS, idText, keepText, matchCoachingHeaders, parseCoachingDate, parseCoachingMonth, scoreText, type CoachingRow,
} from './coachingParse'

export interface ParsedCoaching {
  rows: CoachingRow[]
  excelRows: number[]
  errors: RowError[]
  totalRows: number
  /** Rows repeating an earlier (visit_id, skill_code) pair. */
  duplicates: number
  headers: string[]
  missing: string[]
}

export function parseCoachingSheet(ws: Sheet, onProgress?: (done: number, total: number) => void): ParsedCoaching {
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
  const { index, missing } = matchCoachingHeaders(headers)
  const base: ParsedCoaching = { rows: [], excelRows: [], errors: [], totalRows: 0, duplicates: 0, headers: headers.filter((h) => h.trim() !== ''), missing }
  if (missing.length) return base

  const get = (r: number, key: string): Cell => {
    const c = index[key]
    return c === undefined ? null : plain(cellAt(ws, r, colS + c))
  }

  const rows: CoachingRow[] = []
  const excelRows: number[] = []
  const errors: RowError[] = []
  const seen = new Set<string>()
  let totalRows = 0
  let duplicates = 0
  const total = last - first
  for (let r = first + 1; r <= last; r++) {
    let any = false
    for (const c of COACHING_COLUMNS) if (get(r, c.key) !== null) { any = true; break }
    if (!any) continue
    totalRows++
    const excelRow = r + 1
    const month = parseCoachingMonth(get(r, 'month'))
    const date = parseCoachingDate(get(r, 'visit_date'))
    const name = keepText(get(r, 'emp_name'))
    const code = keepText(get(r, 'skill_code'))
    const visit = idText(get(r, 'visit_id'))
    const score = scoreText(get(r, 'score'))
    const problems: string[] = []
    if (!month) problems.push(get(r, 'month') === null ? 'month is blank' : 'month is not YYYY-MM')
    if (!date) problems.push(get(r, 'visit_date') === null ? 'visit_date is blank' : 'visit_date is not M/D/YYYY')
    if (!name) problems.push('emp_name is blank')
    if (!code) problems.push('skill_code is blank')
    if (!visit) problems.push('visit_id is blank')
    if (!score) problems.push(get(r, 'score') === null ? 'score is blank' : `score is not a number (found "${get(r, 'score')}")`)
    if (problems.length) { errors.push({ excelRow, reason: problems.join('; ') }); continue }
    const key = `${visit}|${code}`
    if (seen.has(key)) duplicates++
    else seen.add(key)
    rows.push({
      month: month as string,
      team_name: keepText(get(r, 'team_name')),
      emp_id: idText(get(r, 'emp_id')),
      emp_name: name as string,
      skill_code: code as string,
      skill_name: keepText(get(r, 'skill_name')),
      visit_id: visit as string,
      visit_date: date as string,
      evaluator: keepText(get(r, 'evaluator')),
      score: score as string,
    })
    excelRows.push(excelRow)
    if (onProgress && (r - first) % 5000 === 0) onProgress(r - first, total)
  }
  onProgress?.(total, total)
  return { ...base, rows, excelRows, errors, totalRows, duplicates, missing: [] }
}
