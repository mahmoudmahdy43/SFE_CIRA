/**
 * KPI by Rep for a day range (kpi_range). Frequency is a monthly target, so Coverage, PCF and Total KPI (and the
 * numbers they come from: list doctors, covered, target and valid visits) do not exist for a partial range and stay null.
 * Roll-ups are recomputed from SUMS, never as an average of rates. No runtime imports beyond the pure KPI math.
 */
import { numOrNull, type KpiRepRow, type Metrics } from './kpiRepMath.ts'

export const MONTHLY_ONLY_TIP = 'monthly only (Freq is a monthly target)'
/** Metric columns that need the monthly list / Freq and so are blank for a partial range. */
export const MONTHLY_ONLY_COLUMNS: ReadonlySet<string> = new Set(['list', 'covered', 'coverage', 'target', 'valid', 'pcf', 'kpi'])

const n0 = (v: unknown): number => numOrNull(v) ?? 0
const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null)
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

/** One kpi_range row (+ names the caller looked up) -> a KPI report row with the monthly-only numbers null. */
export function toRangeRepRow(r: Record<string, unknown>, extra: { line: string | null; manager: string | null; hire_date?: string | null }, month: string): KpiRepRow {
  const daysPm = numOrNull(r.days_pm)
  const targetPm = numOrNull(r.target_pm)
  const expected = daysPm !== null && targetPm !== null ? daysPm * targetPm : null
  const total = numOrNull(r.total_visits)
  return {
    month,
    rep_id: n0(r.rep_id),
    line_id: numOrNull(r.line_id),
    manager_id: numOrNull(r.manager_id),
    box: s(r.box_name),
    rep_code: s(r.rep_code),
    rep_name: s(r.rep_name),
    manager: extra.manager,
    hire_date: extra.hire_date ?? null,
    line: extra.line,
    list_doctors: null, covered_doctors: null, coverage: null, target_visits: null, valid_visits: null, pcf: null, total_kpi: null,
    total_visits: total,
    days_pm: daysPm,
    missing_pm: numOrNull(r.missing_pm),
    call_rate_pm: numOrNull(r.call_rate_pm),
    expected_visits: expected,
    ach_cr: numOrNull(r.ach_cr) ?? ratio(n0(total), n0(expected)),
    visits_pm: numOrNull(r.visits_pm) ?? total,
  }
}

/** Sums the reps and recomputes Call Rate PM and Ach CR from those sums; Coverage / PCF / Total KPI stay null. */
export function aggregateRange(rows: KpiRepRow[]): Metrics & { reps: number } {
  const sum = (k: 'total_visits' | 'days_pm' | 'missing_pm' | 'expected_visits' | 'visits_pm') => rows.reduce((a, r) => a + n0(r[k]), 0)
  const total = sum('total_visits')
  const daysPm = sum('days_pm')
  const expected = sum('expected_visits')
  return {
    reps: rows.length,
    list_doctors: null, covered_doctors: null, coverage: null, target_visits: null, valid_visits: null, pcf: null, total_kpi: null,
    total_visits: total,
    days_pm: daysPm,
    missing_pm: sum('missing_pm'),
    call_rate_pm: ratio(sum('visits_pm'), daysPm),
    expected_visits: expected,
    ach_cr: ratio(total, expected),
  }
}

export function groupRange(rows: KpiRepRow[], keyOf: (r: KpiRepRow) => string, labelOf: (r: KpiRepRow) => string) {
  const by = new Map<string, KpiRepRow[]>()
  for (const r of rows) {
    const k = keyOf(r)
    const l = by.get(k)
    if (l) l.push(r)
    else by.set(k, [r])
  }
  return [...by].map(([key, list]) => ({ key, label: labelOf(list[0]), ...aggregateRange(list) }))
}
export const rangeByManager = (rows: KpiRepRow[]) => groupRange(rows, (r) => `${r.line_id ?? 'x'}|${r.manager_id ?? 'x'}`, (r) => r.manager ?? 'No manager')
export const rangeByLine = (rows: KpiRepRow[]) => groupRange(rows, (r) => String(r.line_id ?? 'x'), (r) => r.line ?? 'No line')
