/**
 * Employee performance report (PM shift only): one row per rep for a day range, straight from employee_performance_range.
 * Pure helpers: row shape, the colour rules, the title and the Excel grid. Coverage is computed by the database on the visits
 * inside the range against the month's frequency; nothing here recomputes it.
 */
import type { GridSheet, GridSheetCell } from '../../lib/xlsxExport.ts'
import { lastDayOf } from '../../lib/dateRange.ts'
import { numOrNull, defaultOrder, type RepIdentity } from './reportMath.ts'

/** Actual CR below this share of Target CR is flagged red. */
export const CR_RED_RATIO = 0.7
/** Coverage colour steps: below RED red, below GREEN yellow, from GREEN up green. */
export const COVERAGE_RED_BELOW = 0.7
export const COVERAGE_GREEN_FROM = 0.85

export const PERF_RED = '#F8CBD0'
export const PERF_YELLOW = '#FFEB9C'
export const PERF_GREEN = '#C6EFCE'
export const PERF_BAND = '#DDE6F5'
const HEAD_GREEN = '#C6E0B4'
const HEAD_CALL = '#FFE699'
const HEAD_COVER = '#9DC3E6'

export interface PerfRow extends RepIdentity {
  line_name: string | null
  actual_days: number | null
  total_visits: number | null
  target_cr: number | null
  actual_cr: number | null
  list_doctors: number | null
  fully_covered: number | null
  partially_covered: number | null
  uncovered: number | null
  /** Fraction 0..1. */
  coverage: number | null
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

/** A coverage that arrives as a percentage (> 1) is turned into a fraction. */
const fraction = (v: number | null): number | null => (v !== null && v > 1 ? v / 100 : v)

export function toPerfRow(r: Record<string, unknown>): PerfRow {
  return {
    month: String(r.month ?? ''),
    rep_id: numOrNull(r.rep_id) ?? 0,
    line_id: numOrNull(r.line_id),
    manager_id: numOrNull(r.manager_id),
    box: str(r.box),
    rep_code: str(r.rep_code),
    rep_name: str(r.rep_name),
    manager: str(r.manager),
    hire_date: str(r.hire_date),
    line_name: str(r.line_name),
    actual_days: numOrNull(r.actual_days),
    total_visits: numOrNull(r.total_visits),
    target_cr: numOrNull(r.target_cr),
    actual_cr: numOrNull(r.actual_cr),
    list_doctors: numOrNull(r.list_doctors),
    fully_covered: numOrNull(r.fully_covered),
    partially_covered: numOrNull(r.partially_covered),
    uncovered: numOrNull(r.uncovered),
    coverage: fraction(numOrNull(r.coverage)),
  }
}

export const orderPerf = (rows: PerfRow[]): PerfRow[] => defaultOrder(rows)

export const isLowCr = (r: PerfRow): boolean => r.actual_cr !== null && r.target_cr !== null && r.target_cr > 0 && r.actual_cr < CR_RED_RATIO * r.target_cr

export function coverageFill(v: number | null): string | null {
  if (v === null) return null
  return v < COVERAGE_RED_BELOW ? PERF_RED : v < COVERAGE_GREEN_FROM ? PERF_YELLOW : PERF_GREEN
}

export type PerfGroup = 'ident' | 'call' | 'cover'
export interface PerfCol {
  id: string
  header: string
  group: PerfGroup
  kind: 'text' | 'int' | 'cr' | 'pct'
  width: number
  value: (r: PerfRow) => string | number | null
}

export const PERF_COLS: PerfCol[] = [
  { id: 'line', header: 'Line', group: 'ident', kind: 'text', width: 11, value: (r) => r.line_name },
  { id: 'manager', header: 'Direct Manager', group: 'ident', kind: 'text', width: 24, value: (r) => r.manager },
  { id: 'box', header: 'Box', group: 'ident', kind: 'text', width: 20, value: (r) => r.box },
  { id: 'rep', header: 'MD Name', group: 'ident', kind: 'text', width: 28, value: (r) => r.rep_name },
  { id: 'days', header: 'Actual Day', group: 'ident', kind: 'int', width: 10, value: (r) => r.actual_days },
  { id: 'visits', header: 'Total Visits', group: 'call', kind: 'int', width: 10, value: (r) => r.total_visits },
  { id: 'target', header: 'Target CR', group: 'call', kind: 'cr', width: 10, value: (r) => r.target_cr },
  { id: 'actual', header: 'Actual CR', group: 'call', kind: 'cr', width: 10, value: (r) => r.actual_cr },
  { id: 'list', header: 'List', group: 'cover', kind: 'int', width: 8, value: (r) => r.list_doctors },
  { id: 'fully', header: 'Fully Covered', group: 'cover', kind: 'int', width: 10, value: (r) => r.fully_covered },
  { id: 'partial', header: 'Partially Covered', group: 'cover', kind: 'int', width: 11, value: (r) => r.partially_covered },
  { id: 'uncovered', header: 'UnCovered', group: 'cover', kind: 'int', width: 10, value: (r) => r.uncovered },
  { id: 'coverage', header: 'Coverage', group: 'cover', kind: 'pct', width: 10, value: (r) => r.coverage },
]

/** Display text: CR one decimal, Coverage as a whole percent, counts as they are; empty for null. */
export function fmtPerf(c: PerfCol, v: string | number | null): string {
  if (v === null || v === '') return ''
  if (typeof v === 'string') return v
  if (c.kind === 'cr') return v.toFixed(1)
  if (c.kind === 'pct') return `${Math.round(v * 100)}%`
  return String(v)
}

/** Fill of one body cell, or null for the plain/banded background. */
export function perfCellFill(c: PerfCol, r: PerfRow): string | null {
  if (c.id === 'actual') return isLowCr(r) ? PERF_RED : null
  if (c.id === 'coverage') return coverageFill(r.coverage)
  return null
}

export const groupFill = { ident: HEAD_GREEN, call: HEAD_CALL, cover: HEAD_COVER } satisfies Record<PerfGroup, string>

const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dm = (d: string) => `${Number(d.slice(8, 10))}-${SHORT[Number(d.slice(5, 7)) - 1]}`

/** "September Mid-Month Performance Report | Call Rate & Coverage | 1-Sep to 19-Sep" ("Mid-Month" only while To is before the month end). */
export function perfTitle(from: string, to: string): string {
  const month = MONTH[Number(to.slice(5, 7)) - 1]
  const mid = to < lastDayOf(`${to.slice(0, 7)}-01`)
  return `${month} ${mid ? 'Mid-Month ' : ''}Performance Report | Call Rate & Coverage | ${dm(from)} to ${dm(to)}`
}

export const perfFileName = (from: string, to: string): string => `Employee_performance_${from}_to_${to}`

/** CSV / flat rows: the 13 columns in order. */
export function exportPerfFlat(rows: PerfRow[]): Record<string, string | number | null>[] {
  return rows.map((r) => Object.fromEntries(PERF_COLS.map((c) => [c.header, c.kind === 'pct' && typeof c.value(r) === 'number' ? Math.round((c.value(r) as number) * 100) / 100 : c.value(r)])))
}

/* --------------------------------- Excel grid --------------------------------- */
const rgb = (hex: string) => hex.replace('#', '')
const fill = (hex: string) => ({ patternType: 'solid', fgColor: { rgb: rgb(hex) } })
const thin = { style: 'thin', color: { rgb: '000000' } }
const border = { top: thin, bottom: thin, left: thin, right: thin }
const center = { horizontal: 'center', vertical: 'center', wrapText: true }

export function buildPerfGrid(rows: PerfRow[], from: string, to: string): GridSheet {
  const n = PERF_COLS.length
  const firstCall = PERF_COLS.findIndex((c) => c.group === 'call')
  const firstCover = PERF_COLS.findIndex((c) => c.group === 'cover')
  const blank = (): GridSheetCell => ({ v: null })
  const cells: GridSheetCell[][] = Array.from({ length: 2 }, () => Array.from({ length: n }, blank))

  // row 1: title over the identity columns, "Call Rate" and "Coverage" group cells
  for (let c = 0; c < firstCall; c++) cells[0][c] = { v: c === 0 ? perfTitle(from, to) : null, s: { fill: fill(HEAD_GREEN), font: { bold: true, sz: 12 }, alignment: { horizontal: 'left', vertical: 'center', wrapText: true }, border } }
  for (let c = firstCall; c < firstCover; c++) cells[0][c] = { v: c === firstCall ? 'Call Rate' : null, s: { fill: fill(HEAD_CALL), font: { bold: true }, alignment: center, border } }
  for (let c = firstCover; c < n; c++) cells[0][c] = { v: c === firstCover ? 'Coverage' : null, s: { fill: fill(HEAD_GREEN), font: { bold: true }, alignment: center, border } }
  // row 2: column headers
  PERF_COLS.forEach((c, ci) => {
    cells[1][ci] = { v: c.header, s: { fill: fill(groupFill[c.group]), font: { bold: true }, alignment: center, border } }
  })
  // body: banded rows, rule colours on Actual CR and Coverage
  rows.forEach((r, ri) => {
    const band = ri % 2 === 1 ? PERF_BAND : '#FFFFFF'
    cells.push(
      PERF_COLS.map((c) => {
        const v = c.value(r)
        const f = perfCellFill(c, r) ?? band
        const s = { fill: fill(f), alignment: { horizontal: c.kind === 'text' ? 'left' : 'center', vertical: 'center' }, border }
        return { v, s, z: c.kind === 'cr' ? '0.0' : c.kind === 'pct' ? '0%' : undefined }
      }),
    )
  })
  return {
    name: 'Employee performance',
    cells,
    merges: [
      { s: { r: 0, c: 0 }, e: { r: 0, c: firstCall - 1 } },
      { s: { r: 0, c: firstCall }, e: { r: 0, c: firstCover - 1 } },
      { s: { r: 0, c: firstCover }, e: { r: 0, c: n - 1 } },
    ],
    widths: PERF_COLS.map((c) => c.width),
    heights: [26, 32],
    freeze: { rows: 2, cols: PERF_COLS.findIndex((c) => c.id === 'rep') + 1 },
    autofilter: { row: 1, fromCol: 0, toCol: n - 1, lastRow: rows.length + 1 },
  }
}

/* ------------------------- second sheet: uncovered doctors ------------------------- */
export interface UncoveredDoctor { line_name: string | null; manager: string | null; rep_name: string | null; territory: string | null; doctor_name: string | null }

export const toUncoveredDoctor = (r: Record<string, unknown>): UncoveredDoctor => ({
  line_name: str(r.line_name), manager: str(r.manager), rep_name: str(r.rep_name), territory: str(r.territory), doctor_name: str(r.doctor_name),
})

const UNCOVERED_COLS: { header: string; width: number; value: (d: UncoveredDoctor) => string | null }[] = [
  { header: 'Line', width: 11, value: (d) => d.line_name },
  { header: 'DM', width: 24, value: (d) => d.manager },
  { header: 'Emp. Name', width: 28, value: (d) => d.rep_name },
  { header: 'Territory', width: 22, value: (d) => d.territory },
  { header: 'Doctor Name', width: 34, value: (d) => d.doctor_name },
]

/** "Uncovered Doctors" sheet: list doctors with no visit in the range, in the order the database returned them. Header only when empty. */
export function buildUncoveredGrid(rows: UncoveredDoctor[]): GridSheet {
  const cells: GridSheetCell[][] = [UNCOVERED_COLS.map((c) => ({ v: c.header, s: { fill: fill(HEAD_GREEN), font: { bold: true }, alignment: center, border } }))]
  rows.forEach((d, ri) => {
    const band = ri % 2 === 1 ? PERF_BAND : '#FFFFFF'
    cells.push(UNCOVERED_COLS.map((c) => ({ v: c.value(d), s: { fill: fill(band), alignment: { horizontal: 'left', vertical: 'center' }, border } })))
  })
  return {
    name: 'Uncovered Doctors',
    cells,
    widths: UNCOVERED_COLS.map((c) => c.width),
    heights: [26],
    freeze: { rows: 1, cols: 0 },
    autofilter: { row: 0, fromCol: 0, toCol: UNCOVERED_COLS.length - 1, lastRow: rows.length },
  }
}
