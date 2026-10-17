/**
 * Sales report helpers. The database functions (sales_months, sales_summary, sales_monthly, sales_products, sales_gap,
 * sales_rep_product, sales_rep_actions, sales_vacant, sales_field) return every sum, target, gap and status. The
 * browser maps, sorts, picks the periods and builds the figures the spec asks for on the client: the like-for-like
 * period rule, Pareto classes, the price / volume / mix bridge, projection, medians and heat-map bands.
 * No imports: this file is also run directly by scripts/reportMath.test.mjs.
 */

export const SALES_TITLE = 'SALES REPORT'
export const SALES_SUBTITLE = 'Sales vs target and vs the previous period, by line, product, rep and box'
export const SALES_EMPTY_TEXT = 'No sales data for this period. Upload the Sales files.'
export const CURRENCY = 'EGP'
export const NO_TARGET = 'No target'
export const DEFAULT_THRESHOLD = 80
export const DEFAULT_DOWN = 3

/* ------------------------------------ rows ------------------------------------ */
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const n0 = (v: unknown): number => numOrNull(v) ?? 0
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const day = (v: unknown): string => (v === null || v === undefined ? '' : String(v).slice(0, 10))
type Raw = Record<string, unknown>

export type Metric = 'value' | 'units'
export const metricPick = (m: Metric, value: number, units: number): number => (m === 'value' ? value : units)

export interface MonthRow { month: string; line_id: number | null; line_name: string | null; rows: number; s_value: number; t_value: number }
export const toMonthRow = (r: Raw): MonthRow => ({ month: day(r.month), line_id: numOrNull(r.line_id), line_name: s(r.line_name), rows: n0(r.rows), s_value: n0(r.s_value), t_value: n0(r.t_value) })

export interface SummaryRow {
  line_id: number | null; line_name: string | null
  s_value: number; s_units: number; t_value: number; t_units: number; s_value_tgt: number; s_units_tgt: number; s_value_notgt: number
  c_value: number; c_units: number; c_t_value: number; c_value_tgt: number; vacant_value: number
}
export const toSummaryRow = (r: Raw): SummaryRow => ({
  line_id: numOrNull(r.line_id), line_name: s(r.line_name),
  s_value: n0(r.s_value), s_units: n0(r.s_units), t_value: n0(r.t_value), t_units: n0(r.t_units), s_value_tgt: n0(r.s_value_tgt), s_units_tgt: n0(r.s_units_tgt), s_value_notgt: n0(r.s_value_notgt),
  c_value: n0(r.c_value), c_units: n0(r.c_units), c_t_value: n0(r.c_t_value), c_value_tgt: n0(r.c_value_tgt), vacant_value: n0(r.vacant_value),
})

export interface MonthlyRow { month: string; line_id: number | null; s_value: number; s_units: number; t_value: number; t_units: number; s_value_tgt: number; s_units_tgt: number; vacant_value: number }
export const toMonthlyRow = (r: Raw): MonthlyRow => ({
  month: day(r.month), line_id: numOrNull(r.line_id), s_value: n0(r.s_value), s_units: n0(r.s_units), t_value: n0(r.t_value), t_units: n0(r.t_units),
  s_value_tgt: n0(r.s_value_tgt), s_units_tgt: n0(r.s_units_tgt), vacant_value: n0(r.vacant_value),
})

export interface ProductRow {
  product_id: number; product_name: string; line_id: number | null; line_name: string | null
  s_value: number; s_units: number; t_value: number; t_units: number; s_value_tgt: number; s_units_tgt: number
  c_value: number; c_units: number; c_t_value: number; c_value_tgt: number
}
export const toProductRow = (r: Raw): ProductRow => ({
  product_id: n0(r.product_id), product_name: s(r.product_name) ?? String(r.product_id ?? ''), line_id: numOrNull(r.line_id), line_name: s(r.line_name),
  s_value: n0(r.s_value), s_units: n0(r.s_units), t_value: n0(r.t_value), t_units: n0(r.t_units), s_value_tgt: n0(r.s_value_tgt), s_units_tgt: n0(r.s_units_tgt),
  c_value: n0(r.c_value), c_units: n0(r.c_units), c_t_value: n0(r.c_t_value), c_value_tgt: n0(r.c_value_tgt),
})

export type GapGroup = 'rep' | 'manager' | 'territory' | 'product' | 'line'
export interface GapRow {
  key_id: string; key_name: string; line_names: string | null; manager_names: string | null
  s_value: number; t_value: number; s_value_tgt: number; s_units: number; t_units: number; gap: number; vacant_months: number
}
export const toGapRow = (r: Raw): GapRow => ({
  key_id: r.key_id === null || r.key_id === undefined ? s(r.key_name) ?? '' : String(r.key_id), key_name: s(r.key_name) ?? '(no name)', line_names: s(r.line_names), manager_names: s(r.manager_names),
  s_value: n0(r.s_value), t_value: n0(r.t_value), s_value_tgt: n0(r.s_value_tgt), s_units: n0(r.s_units), t_units: n0(r.t_units), gap: n0(r.gap), vacant_months: n0(r.vacant_months),
})

export interface RepProductRow { rep_id: number | null; rep_name: string; manager_name: string | null; product_id: number; product_name: string; s_value: number; t_value: number; s_value_tgt: number; s_units: number }
export const toRepProductRow = (r: Raw): RepProductRow => ({
  rep_id: numOrNull(r.rep_id), rep_name: s(r.rep_name) ?? 'Vacant', manager_name: s(r.manager_name), product_id: n0(r.product_id), product_name: s(r.product_name) ?? String(r.product_id ?? ''),
  s_value: n0(r.s_value), t_value: n0(r.t_value), s_value_tgt: n0(r.s_value_tgt), s_units: n0(r.s_units),
})

export interface GapProduct { product: string; shortfall: number; ach: number | null }
export interface ActionMonth { month: string; s: number; t: number; st: number }
export type ActionStatus = 'ACTION' | 'WATCH' | 'OK'
export interface ActionRow {
  rep_id: number | null; rep_name: string; line_names: string | null; manager_name: string | null; territories: number
  s_value: number; t_value: number; s_value_tgt: number; ach: number | null; gap: number; shortfall: number; last_ach: number | null
  decline_run: number; below: boolean; declining: boolean; status: ActionStatus; top_gap_products: GapProduct[]; months: ActionMonth[]
}
function jsonList(v: unknown): Raw[] {
  let x = v
  if (typeof x === 'string') { try { x = JSON.parse(x) } catch { return [] } }
  return Array.isArray(x) ? x.filter((y): y is Raw => !!y && typeof y === 'object') : []
}
export function toActionRow(r: Raw): ActionRow {
  const st = String(r.status ?? 'OK').toUpperCase()
  return {
    rep_id: numOrNull(r.rep_id), rep_name: s(r.rep_name) ?? 'Vacant', line_names: s(r.line_names), manager_name: s(r.manager_name), territories: n0(r.territories),
    s_value: n0(r.s_value), t_value: n0(r.t_value), s_value_tgt: n0(r.s_value_tgt), ach: numOrNull(r.ach), gap: n0(r.gap), shortfall: n0(r.shortfall), last_ach: numOrNull(r.last_ach),
    decline_run: n0(r.decline_run), below: r.below === true || r.below === 'true' || r.below === 't', declining: r.declining === true || r.declining === 'true' || r.declining === 't',
    status: (st === 'ACTION' || st === 'WATCH' ? st : 'OK') as ActionStatus,
    top_gap_products: jsonList(r.top_gap_products).map((p) => ({ product: String(p.product ?? ''), shortfall: n0(p.shortfall), ach: numOrNull(p.ach) })),
    months: jsonList(r.months).map((m) => ({ month: day(m.month), s: n0(m.s), t: n0(m.t), st: n0(m.st) })).sort((a, b) => a.month.localeCompare(b.month)),
  }
}

export interface VacantRow {
  territory_id: number | null; territory_name: string; line_name: string | null; months_vacant: number; months_total: number; currently_vacant: boolean
  last_rep: string | null; s_value: number; t_value: number; s_value_tgt: number; gap: number
}
export const toVacantRow = (r: Raw): VacantRow => ({
  territory_id: numOrNull(r.territory_id), territory_name: s(r.territory_name) ?? '', line_name: s(r.line_name), months_vacant: n0(r.months_vacant), months_total: n0(r.months_total),
  currently_vacant: r.currently_vacant === true || r.currently_vacant === 'true' || r.currently_vacant === 't', last_rep: s(r.last_rep),
  s_value: n0(r.s_value), t_value: n0(r.t_value), s_value_tgt: n0(r.s_value_tgt), gap: n0(r.gap),
})

export interface FieldRow { rep_id: number; visits: number; coaching_visits: number; coaching_avg: number | null }
export const toFieldRow = (r: Raw): FieldRow => ({ rep_id: n0(r.rep_id), visits: n0(r.visits), coaching_visits: n0(r.coaching_visits), coaching_avg: numOrNull(r.coaching_avg) })

/* ------------------------------------ ratios and formats ------------------------------------ */
/** a / b, null when b is missing or zero. */
export const ratio = (a: number, b: number | null): number | null => (b === null || b === 0 || !Number.isFinite(b) ? null : a / b)
export const growthOf = (cur: number, cmp: number): number | null => (cmp === 0 ? null : (cur - cmp) / Math.abs(cmp))
export const achOf = (salesTgt: number, target: number): number | null => ratio(salesTgt, target > 0 ? target : null)
export const fmtPct = (v: number | null, d = 1): string => (v === null ? '-' : `${(v * 100).toFixed(d)}%`)
export const fmtSignedPct = (v: number | null, d = 1): string => (v === null ? '-' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`)
export const fmtNum = (v: number | null): string => (v === null ? '-' : Math.round(v).toLocaleString('en-US'))
export const fmtSigned = (v: number | null): string => (v === null ? '-' : `${v > 0 ? '+' : ''}${Math.round(v).toLocaleString('en-US')}`)
export function fmtK(v: number | null): string {
  if (v === null) return '-'
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(Math.round(v))
}
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthShort = (m: string): string => `${MON[Number(m.slice(5, 7)) - 1] ?? m}`
export const monthLong = (m: string): string => `${monthShort(m)} ${m.slice(0, 4)}`
export const unitLabel = (m: Metric): string => (m === 'value' ? CURRENCY : 'units')

/* ------------------------------------ periods ------------------------------------ */
export type CompareMode = 'month' | 'quarter' | 'semester' | 'ytd'
export const COMPARE_MODES: { id: CompareMode; label: string }[] = [
  { id: 'month', label: 'Month vs Month' }, { id: 'quarter', label: 'Quarter vs Quarter' }, { id: 'semester', label: 'Semester vs Semester' }, { id: 'ytd', label: 'YTD' },
]
const pad = (n: number) => String(n).padStart(2, '0')
export const monthIso = (y: number, m: number): string => `${y}-${pad(m)}-01`

export function loadedMonths(rows: MonthRow[]): string[] {
  return [...new Set(rows.filter((r) => r.rows > 0 || r.s_value !== 0 || r.t_value !== 0).map((r) => r.month))].filter((m) => m !== '').sort()
}

/** Calendar months (YYYY-MM-01) of a period id: 'YYYY-MM-01', 'YYYY-Q3', 'YYYY-S2'. */
export function calendarMonths(id: string): string[] {
  const y = Number(id.slice(0, 4))
  if (/^\d{4}-\d{2}-01$/.test(id)) return [id]
  const q = /^(\d{4})-Q([1-4])$/.exec(id)
  if (q) return [0, 1, 2].map((i) => monthIso(y, (Number(q[2]) - 1) * 3 + 1 + i))
  const h = /^(\d{4})-S([12])$/.exec(id)
  if (h) return Array.from({ length: 6 }, (_, i) => monthIso(y, (Number(h[2]) - 1) * 6 + 1 + i))
  return []
}

export interface PeriodOption { id: string; label: string; short: string; months: string[] }

/** Periods of the mode that have at least one loaded month, oldest first. `months` = the loaded months inside. */
export function periodOptions(mode: CompareMode, loaded: string[]): PeriodOption[] {
  const set = new Set(loaded)
  const ids = new Set<string>()
  for (const m of loaded) {
    const y = m.slice(0, 4)
    const mi = Number(m.slice(5, 7))
    ids.add(mode === 'month' ? m : mode === 'quarter' ? `${y}-Q${Math.ceil(mi / 3)}` : mode === 'semester' ? `${y}-S${mi <= 6 ? 1 : 2}` : `${y}-YTD`)
  }
  return [...ids].sort().map((id) => {
    const y = id.slice(0, 4)
    if (mode === 'ytd') {
      const months = loaded.filter((m) => m.startsWith(y))
      return { id, label: `YTD ${y}`, short: `YTD ${y}`, months }
    }
    const months = calendarMonths(id).filter((m) => set.has(m))
    const part = id.slice(5)
    return mode === 'month'
      ? { id, label: monthLong(id), short: monthLong(id), months }
      : { id, label: `${part} ${y}`, short: part, months }
  })
}

export interface Resolved {
  from: string; to: string; cmpFrom: string; cmpTo: string
  hasCmp: boolean; nSel: number; nCmp: number
  banner: string | null; selLabel: string; cmpLabel: string
}

/**
 * Like-for-like: a period is limited to its loaded months. When the selected period has fewer months than the
 * comparison one, the comparison keeps only the same number of months from its start.
 * YTD = Jan to the latest loaded month with no comparison (the comparison range then repeats the selected one and is ignored).
 */
export function resolvePeriods(mode: CompareMode, options: PeriodOption[], selId: string | null, cmpId: string | null): Resolved | null {
  const sel = options.find((o) => o.id === selId) ?? options[options.length - 1]
  if (!sel || sel.months.length === 0) return null
  const from = mode === 'ytd' ? `${sel.id.slice(0, 4)}-01-01` : sel.months[0]
  const to = sel.months[sel.months.length - 1]
  if (mode === 'ytd') {
    return { from, to, cmpFrom: from, cmpTo: to, hasCmp: false, nSel: sel.months.length, nCmp: 0, banner: null, selLabel: sel.label, cmpLabel: '-' }
  }
  const cmp = options.find((o) => o.id === cmpId && o.id !== sel.id)
  if (!cmp || cmp.months.length === 0) {
    return { from, to, cmpFrom: from, cmpTo: to, hasCmp: false, nSel: sel.months.length, nCmp: 0, banner: null, selLabel: sel.label, cmpLabel: '-' }
  }
  const nSel = sel.months.length
  const useN = Math.min(nSel, cmp.months.length)
  const cmpMonths = cmp.months.slice(0, useN)
  let banner: string | null = null
  if (nSel < cmp.months.length) {
    banner = `Comparing ${nSel} month${nSel > 1 ? 's' : ''} vs ${nSel} month${nSel > 1 ? 's' : ''} (${sel.short} vs first ${nSel} month${nSel > 1 ? 's' : ''} of ${cmp.short})`
  } else if (nSel > cmp.months.length) {
    banner = `Comparing ${nSel} months vs ${cmp.months.length} month${cmp.months.length > 1 ? 's' : ''} (${sel.short} vs ${cmp.short}): the comparison period has fewer loaded months, so growth is not like-for-like`
  }
  return {
    from, to, cmpFrom: cmpMonths[0], cmpTo: cmpMonths[cmpMonths.length - 1], hasCmp: true, nSel, nCmp: cmpMonths.length, banner,
    selLabel: sel.label, cmpLabel: cmp.months.length === useN ? cmp.label : `${cmp.short} (first ${useN})`,
  }
}

/** Default pickers: the latest period and the one before it (null when there is none). */
export function defaultPeriods(options: PeriodOption[]): { sel: string | null; cmp: string | null } {
  const n = options.length
  return { sel: n > 0 ? options[n - 1].id : null, cmp: n > 1 ? options[n - 2].id : null }
}

/** 'Sep 2026' / 'Jul - Sep 2026' */
export function rangeText(from: string, to: string): string {
  const fy = from.slice(0, 4), ty = to.slice(0, 4)
  const fm = Number(from.slice(5, 7)), tm = Number(to.slice(5, 7))
  if (from.slice(0, 7) === to.slice(0, 7)) return `${MON[tm - 1]} ${ty}`
  return fy === ty ? `${MON[fm - 1]} - ${MON[tm - 1]} ${ty}` : `${MON[fm - 1]} ${fy} - ${MON[tm - 1]} ${ty}`
}

/* ------------------------------------ KPIs and lines ------------------------------------ */
export interface SalesKpi {
  sales: number; target: number; ach: number | null; gap: number; cmp: number; growth: number | null
  vacant: number; vacantShare: number | null; noTarget: number
}

/** The Company row of sales_summary (or the sum of the lines when it is missing), in the chosen metric. */
export function companyRow(rows: SummaryRow[]): SummaryRow | null {
  const co = rows.find((r) => r.line_id === null)
  if (co) return co
  const lines = rows.filter((r) => r.line_id !== null)
  if (lines.length === 0) return null
  const sum = (k: keyof SummaryRow) => lines.reduce((a, r) => a + (r[k] as number), 0)
  return {
    line_id: null, line_name: 'Company', s_value: sum('s_value'), s_units: sum('s_units'), t_value: sum('t_value'), t_units: sum('t_units'), s_value_tgt: sum('s_value_tgt'), s_units_tgt: sum('s_units_tgt'),
    s_value_notgt: sum('s_value_notgt'), c_value: sum('c_value'), c_units: sum('c_units'), c_t_value: sum('c_t_value'), c_value_tgt: sum('c_value_tgt'), vacant_value: sum('vacant_value'),
  }
}

export function salesKpi(r: SummaryRow, m: Metric): SalesKpi {
  const sales = metricPick(m, r.s_value, r.s_units)
  const target = metricPick(m, r.t_value, r.t_units)
  const tgtSales = metricPick(m, r.s_value_tgt, r.s_units_tgt)
  const cmp = metricPick(m, r.c_value, r.c_units)
  return {
    sales, target, ach: achOf(tgtSales, target), gap: tgtSales - target, cmp, growth: growthOf(sales, cmp),
    vacant: r.vacant_value, vacantShare: ratio(r.vacant_value, r.s_value), noTarget: r.s_value_notgt,
  }
}

export interface LineRow { id: number | null; name: string; kpi: SalesKpi; isCompany: boolean }
export function lineRows(rows: SummaryRow[], m: Metric, lineName: (id: number) => string): LineRow[] {
  const lines = rows.filter((r) => r.line_id !== null).sort((a, b) => (a.line_id as number) - (b.line_id as number))
  const out: LineRow[] = lines.map((r) => ({ id: r.line_id, name: r.line_name ?? lineName(r.line_id as number), kpi: salesKpi(r, m), isCompany: false }))
  const co = companyRow(rows)
  if (co) out.push({ id: null, name: 'Company', kpi: salesKpi(co, m), isCompany: true })
  return out
}

export type AchTone = 'red' | 'amber' | 'green' | 'none'
/** Lines table: red below the threshold, amber up to 100 %, green at 100 % or more. `threshold` is in percent. */
export function achTone(ach: number | null, threshold: number): AchTone {
  if (ach === null) return 'none'
  const p = ach * 100
  return p < threshold ? 'red' : p < 100 ? 'amber' : 'green'
}
/** Heat map bands: red < 60, orange 60-80, yellow 80-100, green >= 100, gray when there is no target. */
export type HeatTone = 'red' | 'orange' | 'yellow' | 'green' | 'gray'
export function heatTone(ach: number | null): HeatTone {
  if (ach === null) return 'gray'
  const p = ach * 100
  return p < 60 ? 'red' : p < 80 ? 'orange' : p < 100 ? 'yellow' : 'green'
}

/* ------------------------------------ trend and projection ------------------------------------ */
export interface TrendPoint { month: string; sales: number; target: number; ach: number | null; vacant: number; mom: number | null }

/** One point per month for the chosen lines (null = whole company), in the chosen metric. */
export function trendPoints(rows: MonthlyRow[], lineId: number | null, m: Metric): TrendPoint[] {
  const by = new Map<string, { sales: number; target: number; tgtSales: number; vacant: number }>()
  for (const r of rows) {
    if (lineId !== null && r.line_id !== lineId) continue
    const x = by.get(r.month) ?? { sales: 0, target: 0, tgtSales: 0, vacant: 0 }
    x.sales += metricPick(m, r.s_value, r.s_units)
    x.target += metricPick(m, r.t_value, r.t_units)
    x.tgtSales += metricPick(m, r.s_value_tgt, r.s_units_tgt)
    x.vacant += r.vacant_value
    by.set(r.month, x)
  }
  const out = [...by].filter(([k]) => k !== '').sort((a, b) => a[0].localeCompare(b[0])).map(([month, x]) => ({
    month, sales: x.sales, target: x.target, ach: achOf(x.tgtSales, x.target), vacant: x.vacant, mom: null as number | null,
  }))
  for (let i = 1; i < out.length; i++) out[i].mom = growthOf(out[i].sales, out[i - 1].sales)
  return out
}

export interface Projection { months: string[]; perMonth: number; ytd: number; total: number; remaining: number }
/** YTD + the average of the last 3 loaded months x the months left to December (null when the year is complete). */
export function projectYear(points: TrendPoint[]): Projection | null {
  if (points.length === 0) return null
  const last = points[points.length - 1]
  const year = last.month.slice(0, 4)
  const inYear = points.filter((p) => p.month.startsWith(year))
  const lastNum = Number(last.month.slice(5, 7))
  const remaining = 12 - lastNum
  if (remaining <= 0) return null
  const tail = inYear.slice(-3)
  const perMonth = tail.reduce((a, p) => a + p.sales, 0) / tail.length
  const ytd = inYear.reduce((a, p) => a + p.sales, 0)
  return { months: Array.from({ length: remaining }, (_, i) => monthIso(Number(year), lastNum + 1 + i)), perMonth, ytd, total: ytd + perMonth * remaining, remaining }
}

/* ------------------------------------ products ------------------------------------ */
export type SortDir = 'asc' | 'desc'
export type AbcClass = 'A' | 'B' | 'C'
export interface ProductView {
  id: number; name: string; line: string | null
  sales: number; share: number | null; target: number; ach: number | null; gap: number | null; cmp: number; growth: number | null
  avgPrice: number | null; abc: AbcClass; noTarget: boolean
}

/** Pareto classes: A = until 70 % of cumulative sales is reached (the product that crosses 70 % is still A), B = until 90 %, C = rest. */
export function abcClasses(sales: number[]): AbcClass[] {
  const total = sales.reduce((a, v) => a + Math.max(0, v), 0)
  const order = sales.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v)
  const out: AbcClass[] = new Array(sales.length).fill('C')
  let cum = 0
  for (const o of order) {
    const before = total > 0 ? cum / total : 1
    out[o.i] = before < 0.7 ? 'A' : before < 0.9 ? 'B' : 'C'
    cum += Math.max(0, o.v)
  }
  return out
}

export function productViews(rows: ProductRow[], m: Metric): ProductView[] {
  const sales = rows.map((r) => metricPick(m, r.s_value, r.s_units))
  const total = sales.reduce((a, v) => a + v, 0)
  const abc = abcClasses(sales)
  return rows.map((r, i) => {
    const target = metricPick(m, r.t_value, r.t_units)
    const tgtSales = metricPick(m, r.s_value_tgt, r.s_units_tgt)
    const cmp = metricPick(m, r.c_value, r.c_units)
    const noTarget = r.t_value === 0
    return {
      id: r.product_id, name: r.product_name, line: r.line_name, sales: sales[i], share: ratio(sales[i], total > 0 ? total : null),
      target, ach: noTarget ? null : achOf(tgtSales, target), gap: noTarget ? null : tgtSales - target, cmp, growth: growthOf(sales[i], cmp),
      avgPrice: ratio(r.s_value, r.s_units > 0 ? r.s_units : null), abc: abc[i], noTarget,
    }
  })
}

export type ProductCol = 'name' | 'line' | 'sales' | 'share' | 'target' | 'ach' | 'gap' | 'cmp' | 'growth' | 'avgPrice' | 'abc'
export function sortProducts(rows: ProductView[], col: ProductCol, dir: SortDir): ProductView[] {
  const k = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = a[col], y = b[col]
    if (x === null && y === null) return a.name.localeCompare(b.name)
    if (x === null) return 1
    if (y === null) return -1
    const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, 'en', { numeric: true }) : (x as number) - (y as number)
    return c === 0 ? a.name.localeCompare(b.name) : c * k
  })
}

export interface ProductTotal { sales: number; target: number; ach: number | null; gap: number; cmp: number; growth: number | null; avgPrice: number | null }
/** Totals row: achievement and gap come from the database's s_value_tgt (now all sales). */
export function productTotal(rows: ProductRow[], m: Metric): ProductTotal {
  const sum = (f: (r: ProductRow) => number) => rows.reduce((a, r) => a + f(r), 0)
  const sales = sum((r) => metricPick(m, r.s_value, r.s_units))
  const target = sum((r) => metricPick(m, r.t_value, r.t_units))
  const tgt = sum((r) => metricPick(m, r.s_value_tgt, r.s_units_tgt))
  const cmp = sum((r) => metricPick(m, r.c_value, r.c_units))
  const units = sum((r) => r.s_units)
  return { sales, target, ach: achOf(tgt, target), gap: tgt - target, cmp, growth: growthOf(sales, cmp), avgPrice: ratio(sum((r) => r.s_value), units > 0 ? units : null) }
}

/* ------------------------------------ price / volume / mix bridge ------------------------------------ */
export interface Pvm { v0: number; v1: number; volume: number; price: number; mix: number }
/**
 * Per product U0, U1 (units) and V0, V1 (value) in the comparison and selected periods.
 * price = sum((P1 - P0) x U1) over products sold in both periods; volume = (sumU1 - sumU0) x (sumV0 / sumU0);
 * mix = everything else, so volume + price + mix = V1 - V0 exactly (new and discontinued products fall into mix).
 */
export function pvmBridge(rows: ProductRow[]): Pvm {
  const v0 = rows.reduce((a, r) => a + r.c_value, 0)
  const v1 = rows.reduce((a, r) => a + r.s_value, 0)
  const u0 = rows.reduce((a, r) => a + r.c_units, 0)
  const u1 = rows.reduce((a, r) => a + r.s_units, 0)
  let price = 0
  for (const r of rows) {
    if (r.c_units > 0 && r.s_units > 0) price += (r.s_value / r.s_units - r.c_value / r.c_units) * r.s_units
  }
  const volume = u0 > 0 ? (u1 - u0) * (v0 / u0) : 0
  return { v0, v1, volume, price, mix: v1 - v0 - price - volume }
}

export interface WaterStep { name: string; value: number; total?: boolean }
export interface WaterBar { name: string; base: number; up: number; down: number; total: number; end: number; delta: number }
/** Running waterfall: totals stand on zero, deltas float from the running level. */
export function waterfall(steps: WaterStep[]): WaterBar[] {
  let level = 0
  return steps.map((st) => {
    if (st.total) {
      level = st.value
      return { name: st.name, base: 0, up: 0, down: 0, total: st.value, end: st.value, delta: 0 }
    }
    const start = level
    level += st.value
    return { name: st.name, base: Math.min(start, level), up: st.value > 0 ? st.value : 0, down: st.value < 0 ? -st.value : 0, total: 0, end: level, delta: st.value }
  })
}

/** Lower bound for a truncated waterfall axis so the deltas are visible. */
export function waterDomainMin(bars: WaterBar[]): number {
  const levels = bars.flatMap((b) => [b.base, b.end, b.total > 0 ? b.total : b.end]).filter((v) => v > 0)
  if (levels.length === 0) return 0
  const lo = Math.min(...levels), hi = Math.max(...levels)
  const min = lo - (hi - lo) * 1.2
  return min <= 0 ? 0 : Math.floor(min / 1000) * 1000
}

export interface ProductDelta { name: string; delta: number }
/** Value change per product: the biggest `max` movers each way, the rest as one "Other" step; sorted up first then down. */
export function productDeltas(rows: ProductRow[], max = 7): ProductDelta[] {
  const all = rows.map((r) => ({ name: r.product_name, delta: r.s_value - r.c_value })).filter((d) => d.delta !== 0)
  const up = all.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta)
  const down = all.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta)
  const other = [...up.slice(max), ...down.slice(max)].reduce((a, d) => a + d.delta, 0)
  const out = [...up.slice(0, max), ...down.slice(0, max)]
  if (other !== 0) out.push({ name: 'Other', delta: other })
  return out.sort((a, b) => b.delta - a.delta)
}

export interface RepDelta { key: string; name: string; line: string | null; delta: number; cur: number; cmp: number }
/** Value change per rep between two sales_gap('rep') answers; reps missing in one period count as 0 there. */
export function repDeltas(cur: GapRow[], cmp: GapRow[]): RepDelta[] {
  const before = new Map(cmp.map((r) => [r.key_id, r]))
  const seen = new Set<string>()
  const out: RepDelta[] = []
  for (const r of cur) {
    seen.add(r.key_id)
    const b = before.get(r.key_id)
    out.push({ key: r.key_id, name: r.key_name, line: r.line_names, cur: r.s_value, cmp: b?.s_value ?? 0, delta: r.s_value - (b?.s_value ?? 0) })
  }
  for (const r of cmp) if (!seen.has(r.key_id)) out.push({ key: r.key_id, name: r.key_name, line: r.line_names, cur: 0, cmp: r.s_value, delta: -r.s_value })
  return out
}
export const topMovers = (d: RepDelta[], dir: 'up' | 'down', n = 5): RepDelta[] =>
  dir === 'up' ? d.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, n) : d.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, n)

/* ------------------------------------ gap analysis ------------------------------------ */
export interface GapView extends GapRow { ach: number | null; isVacant: boolean }
export function gapViews(rows: GapRow[]): GapView[] {
  return rows
    .map((r) => ({ ...r, ach: achOf(r.s_value_tgt, r.t_value), isVacant: /^vacant$/i.test(r.key_name) }))
    .sort((a, b) => a.gap - b.gap || a.key_name.localeCompare(b.key_name))
}
export const GAP_TABS: { id: GapGroup; label: string }[] = [
  { id: 'line', label: 'Line' }, { id: 'manager', label: 'Manager' }, { id: 'rep', label: 'Rep' }, { id: 'territory', label: 'Box' }, { id: 'product', label: 'Product' },
]

export interface HeatRow { rep: string; manager: string | null; ach: number | null; cells: Map<number, { ach: number | null; sales: number; target: number }> }
export interface HeatMap { products: { id: number; name: string }[]; reps: HeatRow[] }
/** Rep x product, Ach % per cell (gray when the cell has no target). Reps worst first, products by sales. */
export function heatMap(rows: RepProductRow[]): HeatMap {
  const prod = new Map<number, { name: string; sales: number }>()
  const reps = new Map<string, { rep: string; manager: string | null; tgt: number; target: number; cells: HeatRow['cells'] }>()
  for (const r of rows) {
    const p = prod.get(r.product_id) ?? { name: r.product_name, sales: 0 }
    p.sales += r.s_value
    prod.set(r.product_id, p)
    const key = `${r.rep_id ?? 'v'}|${r.rep_name}`
    const x = reps.get(key) ?? { rep: r.rep_name, manager: r.manager_name, tgt: 0, target: 0, cells: new Map() }
    x.tgt += r.s_value_tgt
    x.target += r.t_value
    x.cells.set(r.product_id, { ach: achOf(r.s_value_tgt, r.t_value), sales: r.s_value, target: r.t_value })
    reps.set(key, x)
  }
  return {
    products: [...prod].sort((a, b) => b[1].sales - a[1].sales).map(([id, p]) => ({ id, name: p.name })),
    reps: [...reps.values()].map((x) => ({ rep: x.rep, manager: x.manager, ach: achOf(x.tgt, x.target), cells: x.cells }))
      .sort((a, b) => (a.ach ?? Infinity) - (b.ach ?? Infinity) || a.rep.localeCompare(b.rep)),
  }
}

/* ------------------------------------ action list ------------------------------------ */
/** The database may answer ach as a percent (64.2) or a fraction (0.642): detect it from the rows' own sums. */
export function achScale(rows: ActionRow[]): 1 | 100 {
  for (const r of rows) {
    const mine = achOf(r.s_value_tgt, r.t_value)
    if (r.ach !== null && mine !== null && mine > 0.05) return Math.abs(r.ach - mine * 100) < Math.abs(r.ach - mine) ? 100 : 1
  }
  return 1
}

export interface ActionView extends ActionRow {
  achF: number | null; lastAchF: number | null
  visits: number | null; perVisit: number | null; coachAvg: number | null; reason: string
}

export function reasonOf(r: { achF: number | null; below: boolean; declining: boolean; decline_run: number; status: ActionStatus }, threshold: number): string {
  const parts: string[] = []
  if (r.below && r.achF !== null) parts.push(`Ach ${Math.round(r.achF * 100)}% (< ${threshold})`)
  if (r.declining) parts.push(`sales down ${r.decline_run} month${r.decline_run === 1 ? '' : 's'} in a row`)
  if (parts.length === 0) return r.status === 'OK' ? 'On track' : '-'
  const text = parts.join(' and ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function actionViews(rows: ActionRow[], field: Map<number, FieldRow>, threshold: number): ActionView[] {
  const scale = achScale(rows)
  return rows.map((r) => {
    const f = r.rep_id !== null ? field.get(r.rep_id) : undefined
    const achF = achOf(r.s_value_tgt, r.t_value) ?? (r.ach === null ? null : r.ach / scale)
    const visits = f && f.visits > 0 ? f.visits : null
    return {
      ...r, achF, lastAchF: r.last_ach === null ? null : r.last_ach / scale,
      visits, perVisit: visits === null ? null : r.s_value / visits, coachAvg: f?.coaching_avg ?? null,
      reason: reasonOf({ achF, below: r.below, declining: r.declining, decline_run: r.decline_run, status: r.status }, threshold),
    }
  })
}
const STATUS_ORDER: Record<ActionStatus, number> = { ACTION: 0, WATCH: 1, OK: 2 }
export function sortActions(rows: ActionView[]): ActionView[] {
  return [...rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.shortfall - a.shortfall || a.rep_name.localeCompare(b.rep_name))
}
export const actionCounts = (rows: ActionRow[]): { action: number; watch: number; ok: number } => ({
  action: rows.filter((r) => r.status === 'ACTION').length, watch: rows.filter((r) => r.status === 'WATCH').length, ok: rows.filter((r) => r.status === 'OK').length,
})

/* ------------------------------------ field vs sales ------------------------------------ */
export function median(v: number[]): number | null {
  if (v.length === 0) return null
  const a = [...v].sort((x, y) => x - y)
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}
export interface ScatterPoint { name: string; x: number; y: number; status: ActionStatus; manager: string | null }
/** Reps with visits data and a target: x = visits, y = Ach %. */
export function scatterPoints(rows: ActionView[]): ScatterPoint[] {
  return rows.filter((r) => r.visits !== null && r.achF !== null).map((r) => ({ name: r.rep_name, x: r.visits as number, y: (r.achF as number) * 100, status: r.status, manager: r.manager_name }))
}
export type Quadrant = 'High activity / high result' | 'High activity / low result' | 'Low activity / high result' | 'Low activity / low result'
export function quadrantOf(p: { x: number; y: number }, mx: number, my: number): Quadrant {
  return p.x >= mx ? (p.y >= my ? 'High activity / high result' : 'High activity / low result') : p.y >= my ? 'Low activity / high result' : 'Low activity / low result'
}

/* ------------------------------------ vacant ------------------------------------ */
export function sortVacant(rows: VacantRow[]): VacantRow[] {
  return [...rows].sort((a, b) => a.gap - b.gap || b.months_vacant - a.months_vacant || a.territory_name.localeCompare(b.territory_name, 'en', { numeric: true }))
}
