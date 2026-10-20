/**
 * Range KPIs from dash_kpi_months rows. Ranges are aggregated from TOTALS (sum the columns, then divide), never by
 * averaging monthly ratios. Pure: no imports, also run by scripts/dashboardPeriod.test.mjs.
 */

export interface KpiMonth {
  month: string
  reps: number; list_doctors: number; covered_doctors: number; total_visits: number; valid_visits: number; target_visits: number
  planned_visits: number; direct_visits: number; visits_am: number; visits_pm: number; pharmacy_visits: number
  days_am: number; days_pm: number; missing_am: number; missing_pm: number; leave_days: number; ow_days: number; activity_days: number
  expected_visits: number
}

/** One month of one line (dash_kpi_months_lines); line_id null = rows without a line. */
export interface KpiMonthLine extends KpiMonth { line_id: number | null }

export interface RangeKpi extends Omit<KpiMonth, 'month'> {
  coverage: number | null; pcf: number | null; ach_cr: number | null; total_kpi: number | null
  call_rate_am: number | null; call_rate_pm: number | null; planned_share: number | null; missing_days: number
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null)
const SUM_KEYS: Exclude<keyof KpiMonth, 'month' | 'reps'>[] = [
  'list_doctors', 'covered_doctors', 'total_visits', 'valid_visits', 'target_visits', 'planned_visits', 'direct_visits', 'visits_am', 'visits_pm', 'pharmacy_visits',
  'days_am', 'days_pm', 'missing_am', 'missing_pm', 'leave_days', 'ow_days', 'activity_days', 'expected_visits',
]

/** Total KPI = PCF x 50% + Coverage x 35% + Ach CR x 15%; null when one of the three is missing. */
export const totalKpi = (pcf: number | null, coverage: number | null, achCr: number | null): number | null =>
  pcf === null || coverage === null || achCr === null ? null : pcf * 0.5 + coverage * 0.35 + achCr * 0.15

/** One row's ratios from its own totals. */
export function ratiosOf(s: Omit<KpiMonth, 'month' | 'reps'>): Pick<RangeKpi, 'coverage' | 'pcf' | 'ach_cr' | 'total_kpi' | 'call_rate_am' | 'call_rate_pm' | 'planned_share' | 'missing_days'> {
  const coverage = div(s.covered_doctors, s.list_doctors)
  const pcf = div(s.valid_visits, s.target_visits) // target = Σ Freq of the C/PC list doctors, not total visits
  const ach_cr = div(s.total_visits, s.expected_visits)
  return {
    coverage, pcf, ach_cr, total_kpi: totalKpi(pcf, coverage, ach_cr),
    call_rate_am: div(s.visits_am, s.days_am), call_rate_pm: div(s.visits_pm, s.days_pm),
    planned_share: div(s.planned_visits, s.planned_visits + s.direct_visits), missing_days: s.missing_am + s.missing_pm,
  }
}

/** Sum the columns over the rows, then derive every ratio. `reps` is the largest monthly head-count. */
export function aggregate(rows: KpiMonth[]): RangeKpi {
  const s = Object.fromEntries(SUM_KEYS.map((k) => [k, 0])) as Record<(typeof SUM_KEYS)[number], number>
  let reps = 0
  for (const r of rows) {
    for (const k of SUM_KEYS) s[k] += r[k]
    reps = Math.max(reps, r.reps)
  }
  return { reps, ...s, ...ratiosOf(s) }
}

/** A month counts as "with data" when it has a list or any visit. */
export const hasData = (r: KpiMonth): boolean => r.list_doctors > 0 || r.total_visits > 0

export const rowsIn = (rows: KpiMonth[], fromYM: string, toYM: string): KpiMonth[] => rows.filter((r) => r.month.slice(0, 7) >= fromYM && r.month.slice(0, 7) <= toYM)

/** The previous period is comparable only when it has data for every one of its months. */
export const comparable = (prev: KpiMonth[], n: number): boolean => prev.filter(hasData).length === n

/* ------------------------------ number formatting ------------------------------ */
/** 1,234 / 12.4K / 3.2M (sign kept). */
export function fmtMoney(v: number | null): string {
  if (v === null) return '—'
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`
  return Math.round(v).toLocaleString('en-US')
}
export const fmtSigned = (v: number | null): string => (v === null ? '—' : `${v < 0 ? '−' : '+'}${fmtMoney(Math.abs(v))}`)

/* ------------------------------ derive everything from the one per-line call ------------------------------ */
const NUM_KEYS: Exclude<keyof KpiMonth, 'month'>[] = ['reps', 'list_doctors', 'covered_doctors', 'total_visits', 'valid_visits', 'target_visits', 'planned_visits', 'direct_visits', 'visits_am', 'visits_pm', 'pharmacy_visits',
  'days_am', 'days_pm', 'missing_am', 'missing_pm', 'leave_days', 'ow_days', 'activity_days', 'expected_visits']

/** Company = the sum of all lines, month by month. */
export function companyMonths(rows: KpiMonthLine[]): KpiMonth[] {
  const by = new Map<string, KpiMonth>()
  for (const r of rows) {
    let m = by.get(r.month)
    if (!m) { m = { month: r.month } as KpiMonth; for (const k of NUM_KEYS) m[k] = 0; by.set(r.month, m) }
    for (const k of NUM_KEYS) m[k] += r[k]
  }
  return [...by.values()].sort((a, b) => a.month.localeCompare(b.month))
}

/** One line's months. */
export const lineMonths = (rows: KpiMonthLine[], lineId: number): KpiMonth[] =>
  rows.filter((r) => r.line_id === lineId).sort((a, b) => a.month.localeCompare(b.month))
