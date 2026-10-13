/**
 * Pure helpers for the "KPI by Rep" report. The database gives every rep's numbers (v_kpi_rep, PM shift, Clinic + Poly Clinic).
 * Because the user can exclude reps, totals and roll-ups are recomputed here from the SUMS of the remaining reps,
 * never as an average of the reps' ratios. No runtime imports: also run by scripts/reportMath.test.mjs.
 */

export const DASH = '—'

export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const n0 = (v: unknown): number => numOrNull(v) ?? 0
const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null)

/** No data at all: nothing in the list, no visits and no expected visits. Only then is Total KPI a dash. */
export const hasNoData = (list: number | null, total: number | null, expected: number | null): boolean =>
  (list ?? 0) === 0 && (total ?? 0) === 0 && (expected ?? 0) === 0

/**
 * Total KPI = PCF x 50% + Coverage x 35% + Ach CR x 15%, same as the database and the Dashboard:
 * a missing component counts as 0 in the formula (its own cell still shows a dash). Null only when there is no data.
 */
export function totalKpiOf(pcf: number | null, coverage: number | null, achCr: number | null, noData = false): number | null {
  return noData ? null : (pcf ?? 0) * 0.5 + (coverage ?? 0) * 0.35 + (achCr ?? 0) * 0.15
}

/** The numbers every row (rep or roll-up) shows. */
export interface Metrics {
  list_doctors: number | null
  covered_doctors: number | null
  coverage: number | null
  total_visits: number | null
  target_visits: number | null
  valid_visits: number | null
  pcf: number | null
  days_pm: number | null
  missing_pm: number | null
  call_rate_pm: number | null
  expected_visits: number | null
  ach_cr: number | null
  total_kpi: number | null
}

export interface KpiRepRow extends Metrics {
  month: string
  rep_id: number
  line_id: number | null
  manager_id: number | null
  box: string | null
  rep_code: string | null
  rep_name: string | null
  manager: string | null
  hire_date: string | null
  line: string | null
  /** PM visits (the Call Rate PM numerator); falls back to total_visits, which is PM-only too. */
  visits_pm: number | null
}

export function toKpiRepRow(r: Record<string, unknown>): KpiRepRow {
  const s = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))
  const total = numOrNull(r.total_visits)
  const target_visits = numOrNull(r.target_visits)
  const valid_visits = numOrNull(r.valid_visits)
  const pcf = ratio(n0(valid_visits), n0(target_visits))
  return {
    month: String(r.month ?? ''),
    rep_id: n0(r.rep_id),
    line_id: numOrNull(r.line_id),
    manager_id: numOrNull(r.manager_id),
    box: s(r.box),
    rep_code: s(r.rep_code),
    rep_name: s(r.rep_name),
    manager: s(r.manager),
    hire_date: s(r.hire_date),
    line: s(r.line),
    list_doctors: numOrNull(r.list_doctors),
    covered_doctors: numOrNull(r.covered_doctors),
    coverage: numOrNull(r.coverage),
    total_visits: total,
    target_visits,
    valid_visits,
    pcf, // valid visits / target visits, recomputed here (the view's own pcf is the old definition)
    days_pm: numOrNull(r.days_pm),
    missing_pm: numOrNull(r.missing_pm),
    call_rate_pm: numOrNull(r.call_rate_pm),
    expected_visits: numOrNull(r.expected_visits),
    ach_cr: numOrNull(r.ach_cr),
    // computed here from the new PCF (the database total_kpi still uses the old one)
    total_kpi: hasNoData(numOrNull(r.list_doctors), total, numOrNull(r.expected_visits))
      ? null
      : totalKpiOf(pcf, numOrNull(r.coverage), numOrNull(r.ach_cr)),
    visits_pm: numOrNull(r.visits_pm) ?? total,
  }
}

/* ------------------------------ roll-ups ------------------------------ */
export interface KpiGroup extends Metrics {
  key: string
  label: string
  reps: number
}

/** Sums the given reps and recomputes every ratio from those sums. */
export function aggregate(rows: KpiRepRow[]): Metrics & { reps: number } {
  const sum = (k: 'list_doctors' | 'covered_doctors' | 'total_visits' | 'target_visits' | 'valid_visits' | 'days_pm' | 'missing_pm' | 'expected_visits' | 'visits_pm') =>
    rows.reduce((a, r) => a + n0(r[k]), 0)
  const list = sum('list_doctors')
  const covered = sum('covered_doctors')
  const total = sum('total_visits')
  const target = sum('target_visits')
  const valid = sum('valid_visits')
  const daysPm = sum('days_pm')
  const expected = sum('expected_visits')
  const coverage = ratio(covered, list)
  const pcf = ratio(valid, target)
  const ach = ratio(total, expected)
  return {
    reps: rows.length,
    list_doctors: list,
    covered_doctors: covered,
    coverage,
    total_visits: total,
    target_visits: target,
    valid_visits: valid,
    pcf,
    days_pm: daysPm,
    missing_pm: sum('missing_pm'),
    call_rate_pm: ratio(sum('visits_pm'), daysPm),
    expected_visits: expected,
    ach_cr: ach,
    total_kpi: totalKpiOf(pcf, coverage, ach, hasNoData(list, total, expected)),
  }
}

export function groupRows(rows: KpiRepRow[], keyOf: (r: KpiRepRow) => string, labelOf: (r: KpiRepRow) => string): KpiGroup[] {
  const by = new Map<string, KpiRepRow[]>()
  for (const r of rows) {
    const k = keyOf(r)
    const list = by.get(k)
    if (list) list.push(r)
    else by.set(k, [r])
  }
  return [...by].map(([key, list]) => ({ key, label: labelOf(list[0]), ...aggregate(list) }))
}

export const byManager = (rows: KpiRepRow[]) => groupRows(rows, (r) => `${r.line_id ?? 'x'}|${r.manager_id ?? 'x'}`, (r) => r.manager ?? 'No manager')
export const byLine = (rows: KpiRepRow[]) => groupRows(rows, (r) => String(r.line_id ?? 'x'), (r) => r.line ?? 'No line')

/* ------------------------------ exclusion ------------------------------ */
export function splitExcluded<T extends { rep_id: number }>(rows: T[], excluded: ReadonlySet<number>): { included: T[]; excluded: T[] } {
  const included: T[] = []
  const out: T[] = []
  for (const r of rows) (excluded.has(r.rep_id) ? out : included).push(r)
  return { included, excluded: out }
}

/** localStorage payload -> rep ids; anything unexpected -> empty. */
export function parseIds(raw: string | null): number[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isInteger(x)) : []
  } catch {
    return []
  }
}

/* ------------------------------ formatting ------------------------------ */
export const fmtPct = (v: number | null): string => (v === null ? DASH : `${(v * 100).toFixed(1)}%`)
export const fmtRate = (v: number | null): string => (v === null ? DASH : v.toFixed(2))
export const fmtInt = (v: number | null): string => (v === null ? DASH : Math.round(v).toLocaleString('en-US'))

/* ------------------------------ export ------------------------------ */
export type ExportRow = Record<string, string | number | null>
const round = (v: number | null, d: number) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d)
const pct = (v: number | null) => round(v === null ? null : v * 100, 1)

function metricCells(m: Metrics): ExportRow {
  return {
    'List Doctors': m.list_doctors,
    Covered: m.covered_doctors,
    'Coverage %': pct(m.coverage),
    'Total Visits (C/PC)': m.total_visits,
    'Target Visits': m.target_visits,
    'Valid Visits': m.valid_visits,
    'PCF %': pct(m.pcf),
    'Days PM': m.days_pm,
    'Missing Days': m.missing_pm,
    'Call Rate PM': round(m.call_rate_pm, 2),
    'Expected Visits': m.expected_visits,
    'Ach CR %': pct(m.ach_cr),
    'Total KPI %': pct(m.total_kpi),
  }
}

/** Rep rows (+ Total). With `showExcluded` the excluded reps follow, flagged in an "Excluded" column; the Total never includes them. */
export function exportReps(included: KpiRepRow[], total: Metrics & { reps: number }, excludedRows: KpiRepRow[], showExcluded: boolean): ExportRow[] {
  const ident = (r: KpiRepRow, ex: boolean): ExportRow => ({
    Rep: r.rep_name, Code: r.rep_code, Box: r.box, Line: r.line, DM: r.manager, ...metricCells(r), ...(showExcluded ? { Excluded: ex ? 'Yes' : 'No' } : {}),
  })
  return [
    ...included.map((r) => ident(r, false)),
    ...(showExcluded ? excludedRows.map((r) => ident(r, true)) : []),
    { Rep: `Total (${total.reps} reps)`, Code: null, Box: null, Line: null, DM: null, ...metricCells(total), ...(showExcluded ? { Excluded: null } : {}) },
  ]
}

export function exportGroups(groups: KpiGroup[], total: Metrics & { reps: number }, label: string): ExportRow[] {
  return [
    ...groups.map((g) => ({ [label]: g.label, Reps: g.reps, ...metricCells(g) })),
    { [label]: 'Total', Reps: total.reps, ...metricCells(total) },
  ]
}
