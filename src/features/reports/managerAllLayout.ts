/**
 * Managers report, shift = All: the 18-column performance layout (screen table, Excel grid, CSV).
 * Day columns for leave / office work / activity and the field / missing figures are the PM-shift values (the same slots as the PM view).
 */
import type { GridSheet, GridSheetCell } from '../../lib/xlsxExport.ts'
import { monthLabel } from '../../lib/dateRange.ts'
import type { ExportRow } from './absenceMath.ts'
import type { ManagerRow } from './managerMath.ts'

export type AllKind = 'text' | 'days' | 'count' | 'rate' | 'coaching' | 'dates'
export type AllTone = 'default' | 'pharmacy' | 'dates'
export interface AllCol {
  id: string
  header: string
  kind: AllKind
  tone: AllTone
  /** Part of the dashed AM block (columns 13-16). */
  am?: boolean
  /** Missing-day column: > 0 is flagged red. */
  flag?: boolean
  value: (r: ManagerRow) => string | number | null
  /** Sum for the totals row (absent = no total). */
  sum?: boolean
}

/** Rate shown with one decimal, blank when there are no visits to rate. */
const rate = (rateV: number | null, visits: number): number | null => (rateV === null || visits <= 0 ? null : rateV)

export const ALL_COLS: AllCol[] = [
  { id: 'line', header: 'Line', kind: 'text', tone: 'default', value: (r) => r.line },
  { id: 'name', header: 'Sales Manager', kind: 'text', tone: 'default', value: (r) => r.name },
  { id: 'fieldPm', header: 'PM Field Day', kind: 'days', tone: 'default', sum: true, value: (r) => r.slots.field_pm },
  { id: 'leave', header: 'Vacation', kind: 'days', tone: 'default', sum: true, value: (r) => r.slots.leave_pm },
  { id: 'ow', header: 'Office Work', kind: 'days', tone: 'default', sum: true, value: (r) => r.slots.ow_pm },
  { id: 'act', header: 'Activity', kind: 'days', tone: 'default', sum: true, value: (r) => r.slots.act_pm },
  { id: 'missPm', header: 'PM Missing Day', kind: 'days', tone: 'default', flag: true, sum: true, value: (r) => r.slots.missing_pm },
  { id: 'single', header: 'Single Visits', kind: 'count', tone: 'default', sum: true, value: (r) => r.slots.single_pm },
  { id: 'double', header: 'Double Visits', kind: 'count', tone: 'default', sum: true, value: (r) => r.slots.double_pm },
  { id: 'coaching', header: 'Coaching Report', kind: 'coaching', tone: 'default', value: () => null },
  { id: 'ratePm', header: 'PM Call Rate', kind: 'rate', tone: 'default', value: (r) => rate(r.call_rate_pm, r.visits_pm) },
  { id: 'ratePh', header: 'Pharmacies Call Rate', kind: 'rate', tone: 'pharmacy', value: (r) => rate(r.call_rate_pharmacy, r.visits_pharmacy) },
  { id: 'fieldAm', header: 'AM Field Day', kind: 'days', tone: 'default', am: true, sum: true, value: (r) => r.slots.field_am },
  { id: 'visitsAm', header: 'AM Total Visits', kind: 'count', tone: 'default', am: true, sum: true, value: (r) => r.visits_am },
  { id: 'rateAm', header: 'AM Call Rate', kind: 'rate', tone: 'default', am: true, value: (r) => rate(r.call_rate_am, r.visits_am) },
  { id: 'missAm', header: 'AM Missing Days', kind: 'days', tone: 'default', am: true, flag: true, sum: true, value: (r) => r.slots.missing_am },
  { id: 'datesAm', header: 'AM Missing Date', kind: 'dates', tone: 'dates', value: (r) => r.missing_dates_am || null },
  { id: 'datesPm', header: 'PM Missing Date', kind: 'dates', tone: 'dates', value: (r) => r.missing_dates_pm || null },
]

export const isFlagged = (c: AllCol, v: string | number | null): boolean => !!c.flag && typeof v === 'number' && v > 0

/** Display text for the screen table (days: one decimal only when needed; rates: one decimal; blanks stay empty). */
export function fmtAll(c: AllCol, v: string | number | null): string {
  if (v === null || v === '') return ''
  if (typeof v === 'string') return v
  if (c.kind === 'rate') return v.toFixed(1)
  if (c.kind === 'days') return Number.isInteger(v) ? String(v) : v.toFixed(1)
  return String(v)
}

export const lineSpans = (rows: ManagerRow[]): number[] => {
  // For each row: how many rows its Line cell spans (0 = covered by the cell above).
  const out = rows.map(() => 0)
  let start = 0
  for (let i = 1; i <= rows.length; i++) {
    if (i === rows.length || rows[i].line !== rows[start].line) {
      out[start] = i - start
      start = i
    }
  }
  return out
}

export const ROLE_TITLE: Record<string, string> = {
  DM: 'District Sales Manager',
  NSM: 'National Sales Manager',
  FT: 'Field Trainer',
  PM: 'Product Manager',
  TM: 'Training Manager',
  SD: 'Sales Director',
}
export const roleTitle = (role: string): string => ROLE_TITLE[role] ?? 'Managers'
export const bannerText = (role: string): string => `CIRA PHARMA | ${roleTitle(role)} Performance – PM Visits`

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const md = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`
/** "Oct 2026" for a whole month, otherwise "Oct 3 – Oct 7, 2026" (years on both ends when they differ). */
export function reportingPeriod(from: string, to: string, isFullMonth: boolean): string {
  if (isFullMonth) return monthLabel(`${from.slice(0, 7)}-01`)
  return from.slice(0, 4) === to.slice(0, 4) ? `${md(from)} – ${md(to)}, ${to.slice(0, 4)}` : `${md(from)}, ${from.slice(0, 4)} – ${md(to)}, ${to.slice(0, 4)}`
}

export const workingDaysOf = (rows: ManagerRow[]): number => rows.reduce((m, r) => Math.max(m, r.working_days), 0)

/** File name: Managers_All_<role>_<from>_to_<to> (role omitted for All roles). */
export const allFileName = (role: string, from: string, to: string): string => `Managers_All_${role ? `${role}_` : ''}${from}_to_${to}`

/** CSV: plain columns 1-18 in the same order. */
export function exportAllCsv(rows: ManagerRow[]): ExportRow[] {
  return rows.map((r) => Object.fromEntries(ALL_COLS.map((c) => [c.header, c.value(r)])) as ExportRow)
}

/* --------------------------------- Excel grid --------------------------------- */
const GREEN = '1E6B3A'
const DARK_GREEN = '14532D'
const YELLOW = 'FFFFCC'
const GREY = 'BFBFBF'
const RED_FILL = 'F8CBD0'
const RED_TEXT = '9C0006'
const BLACK = '000000'

type Side = 'thin' | 'dashed'
const edge = (style: Side) => ({ style, color: { rgb: BLACK } })
const AM_FIRST = ALL_COLS.findIndex((c) => c.am)
const AM_LAST = ALL_COLS.length - 1 - [...ALL_COLS].reverse().findIndex((c) => c.am)
const DATE_FIRST = ALL_COLS.findIndex((c) => c.kind === 'dates')

/** Header cell borders: dashed box around the AM block, dashed all round for the two date columns, thin elsewhere. */
function borderFor(ci: number, isHeader: boolean, isLastRow: boolean) {
  const inAm = ci >= AM_FIRST && ci <= AM_LAST
  const isDate = ci >= DATE_FIRST
  if (isDate) return isHeader ? { top: edge('dashed'), bottom: edge('dashed'), left: edge('dashed'), right: edge('dashed') } : { top: edge('thin'), bottom: edge('thin'), left: edge('thin'), right: edge('thin') }
  return {
    top: edge(inAm && isHeader ? 'dashed' : 'thin'),
    bottom: edge(inAm && isLastRow ? 'dashed' : 'thin'),
    left: edge(ci === AM_FIRST ? 'dashed' : 'thin'),
    right: edge(ci === AM_LAST ? 'dashed' : 'thin'),
  }
}

export function buildAllGrid(rows: ManagerRow[], o: { role: string; from: string; to: string; isFullMonth: boolean }): GridSheet {
  const n = ALL_COLS.length
  const blank = (): GridSheetCell => ({ v: null })
  const cells: GridSheetCell[][] = Array.from({ length: 4 }, () => Array.from({ length: n }, blank))
  const center = { horizontal: 'center', vertical: 'center', wrapText: true }
  const logoC = n - 3 // the last 3 columns stay empty for the logo

  // row 1: banner (the logo area to its right is left blank)
  for (let c = 0; c < logoC; c++) cells[0][c] = { v: c === 0 ? bannerText(o.role) : null, s: { fill: { patternType: 'solid', fgColor: { rgb: DARK_GREEN } }, font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } }, alignment: { horizontal: 'left', vertical: 'center' } } }
  // row 2: working days + reporting period
  cells[1][0] = { v: 'Working Days:', s: { font: { bold: true }, alignment: { horizontal: 'right', vertical: 'center' } } }
  cells[1][2] = { v: workingDaysOf(rows), s: { fill: { patternType: 'solid', fgColor: { rgb: YELLOW } }, font: { bold: true }, alignment: center, border: borderFor(99, false, false) } }
  cells[1][3] = { v: `Reporting Period: ${reportingPeriod(o.from, o.to, o.isFullMonth)}`, s: { font: { bold: true }, alignment: center } }

  // row 4: header
  ALL_COLS.forEach((c, ci) => {
    const white = c.kind === 'dates'
    const fill = c.tone === 'pharmacy' ? GREY : white ? 'FFFFFF' : GREEN
    cells[3][ci] = { v: c.header, s: { fill: { patternType: 'solid', fgColor: { rgb: fill } }, font: { bold: true, color: { rgb: white ? BLACK : 'FFFFFF' } }, alignment: center, border: borderFor(ci, true, false) } }
  })

  // body
  const spans = lineSpans(rows)
  const merges: NonNullable<GridSheet['merges']> = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: logoC - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
    { s: { r: 1, c: 3 }, e: { r: 1, c: logoC - 1 } },
    { s: { r: 0, c: logoC }, e: { r: 2, c: n - 1 } }, // logo area: left empty on purpose
  ]
  rows.forEach((r, ri) => {
    const last = ri === rows.length - 1
    cells.push(
      ALL_COLS.map((c, ci) => {
        const v = c.value(r)
        const fill = isFlagged(c, v) ? RED_FILL : c.tone === 'pharmacy' ? GREY : c.tone === 'dates' ? YELLOW : null
        const s: Record<string, unknown> = {
          alignment: { horizontal: ci === 1 ? 'left' : 'center', vertical: 'center', wrapText: c.kind === 'dates' },
          border: borderFor(ci, false, last),
        }
        if (fill) s.fill = { patternType: 'solid', fgColor: { rgb: fill } }
        if (ci === 0) s.font = { bold: true }
        else if (isFlagged(c, v)) s.font = { color: { rgb: RED_TEXT } }
        return { v, s, z: c.kind === 'rate' ? '0.0' : undefined }
      }),
    )
    if (spans[ri] > 1) merges.push({ s: { r: 4 + ri, c: 0 }, e: { r: 4 + ri + spans[ri] - 1, c: 0 } })
  })

  const widths = ALL_COLS.map((c, ci) => (ci === 0 ? 14 : ci === 1 ? 24 : c.kind === 'dates' ? 24 : c.id === 'ratePh' ? 12 : 11))
  const heights = [28, 20, 20, 44]
  return { name: 'Managers', cells, merges, widths, heights, freeze: { rows: 4, cols: 2 } }
}
