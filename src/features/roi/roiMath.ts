/**
 * Speciality ROI helpers. Pure (no imports): also run by scripts/specialityRoi.test.mjs.
 * Months are "YYYY-MM", days "YYYY-MM-DD". The database does the ROI maths; this file only picks colours and words,
 * finds the cost that applies to a month, sorts rows and matches names for the speciality-map suggestion.
 */

/* ------------------------------ cost per visit ------------------------------ */
export const DEFAULT_COST = 600
export interface CostRow { month_from: string; cost: number }

/** Cost per visit that applies to month `ym`: the latest entry that starts on or before it (same rule as visit_cost_for). */
export function costFor(history: CostRow[], ym: string): number {
  let best: CostRow | null = null
  for (const h of history) {
    const m = h.month_from.slice(0, 7)
    if (m <= ym && (best === null || m > best.month_from.slice(0, 7))) best = h
  }
  return best ? best.cost : DEFAULT_COST
}

/** Text box -> cost, or null when it is empty, negative or not a number. */
export function parseCost(text: string): number | null {
  const t = text.trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/* ------------------------------ ROI colours and words ------------------------------ */
/** ROI below `amber` is red, from `amber` up to `green` is amber, `green` and above is green. */
export const ROI_THRESHOLDS = { amber: 1, green: 2 } as const
export type RoiTone = 'red' | 'amber' | 'green' | 'none'

export function roiTone(roi: number | null): RoiTone {
  if (roi === null) return 'none'
  return roi < ROI_THRESHOLDS.amber ? 'red' : roi < ROI_THRESHOLDS.green ? 'amber' : 'green'
}
export const fmtRoi = (roi: number | null): string => (roi === null ? '—' : `${roi.toFixed(1)}x`)

/** Strength of the visits ↔ sales link: |r| < 0.2 no clear link, < 0.4 weak, < 0.6 moderate, else strong. */
export function corrWord(r: number | null): string {
  if (r === null) return 'not enough data'
  const a = Math.abs(r)
  return a < 0.2 ? 'no clear link' : a < 0.4 ? 'weak' : a < 0.6 ? 'moderate' : 'strong'
}

/* ------------------------------ data quality banner ------------------------------ */
export interface QualityRow { line_name: string; doctor_visits: number; no_doctor: number; no_speciality: number; in_groups: number; classified_pct: number | null }
export const QUALITY_WARN = 0.8

export interface QualitySummary { visits: number; classified: number | null; noSpeciality: number | null; noDoctor: number | null; warn: boolean }

/** Totals over the lines shown; every share is of all the doctor visits. */
export function summariseQuality(rows: QualityRow[]): QualitySummary {
  const visits = rows.reduce((a, r) => a + r.doctor_visits, 0)
  if (visits === 0) return { visits: 0, classified: null, noSpeciality: null, noDoctor: null, warn: false }
  const share = (f: (r: QualityRow) => number) => rows.reduce((a, r) => a + f(r), 0) / visits
  const classified = share((r) => r.in_groups)
  return { visits, classified, noSpeciality: share((r) => r.no_speciality), noDoctor: share((r) => r.no_doctor), warn: classified < QUALITY_WARN }
}
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)
export function qualityText(s: QualitySummary): string {
  return `${pct(s.classified)} of doctor visits are inside a mapped group; ${pct(s.noSpeciality)} have no speciality; ${pct(s.noDoctor)} are not linked to a doctor.`
}

/* ------------------------------ URL state ------------------------------ */
export type Shift = 'ALL' | 'AM' | 'PM'
export const SHIFTS: Shift[] = ['ALL', 'AM', 'PM']
export const parseShift = (v: string | null): Shift => (SHIFTS as string[]).includes(v ?? '') ? (v as Shift) : 'ALL'
export const parseLine = (v: string | null): number | null => {
  const n = Number(v)
  return v !== null && Number.isInteger(n) && n > 0 ? n : null
}

/* ------------------------------ sorting ------------------------------ */
export type SortDir = 'asc' | 'desc'
/** Stable sort by a column value; null / undefined / NaN always go last, whatever the direction. */
export function sortRows<T>(rows: T[], value: (r: T) => string | number | null | undefined, dir: SortDir): T[] {
  const ok = (v: unknown): v is string | number => v !== null && v !== undefined && !(typeof v === 'number' && Number.isNaN(v))
  return rows
    .map((r, i) => ({ r, i, v: value(r) }))
    .sort((a, b) => {
      if (!ok(a.v) || !ok(b.v)) return ok(a.v) === ok(b.v) ? a.i - b.i : ok(a.v) ? -1 : 1
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v))
      return (dir === 'asc' ? c : -c) || a.i - b.i
    })
    .map((x) => x.r)
}

/* ------------------------------ speciality-map suggestion ------------------------------ */
export interface SuggestedGroup { line: string; group: string; specialities: string[]; products: string[] }

/** The 2026 strategy map. Specialities that share products are one group; the user can split a group afterwards. */
export const STRATEGY_MAP: SuggestedGroup[] = [
  { line: 'CIRA 1', group: 'Gyna', specialities: ['Gyna'], products: ['Irovast', 'Axal'] },
  { line: 'CIRA 1', group: 'Surg + Plastic Surg + Derma', specialities: ['Surg', 'Plastic Surg', 'Derma'], products: ['Tipo Star', 'Delecar', 'Biotin'] },
  { line: 'CIRA 2', group: 'Gyna + Ophtha', specialities: ['Gyna', 'Andrology', 'Ophtha'], products: ['Mamimilk', 'Heya', 'Selenostar'] },
  { line: 'CIRA 2', group: 'Derma', specialities: ['Derma'], products: ['Capilorin', 'Hepta Beta'] },
  { line: 'CIRA 3', group: 'Ortho + Vascular Surg', specialities: ['Ortho', 'Vascular Surg'], products: ['Repaion N', 'Granmove Emulgel'] },
  { line: 'CIRA 3', group: 'Dentist', specialities: ['Dentist'], products: ['Q-Afta', 'Q-SaniHex'] },
  { line: 'CIRA 3', group: 'Nutrition', specialities: ['Nutrition'], products: ['Servilight'] },
]

/** Other names the strategy document uses for a product (Heya is NEO-MUM / A2Z). */
const PRODUCT_ALIASES: Record<string, string[]> = { heya: ['neo mum', 'neomum', 'a2z'], mamimilk: ['mami milk'] }

/** lower case, letters and digits only, one space between words. */
export const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const compact = (s: string): string => normName(s).replace(/ /g, '')

function commonPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}
/** One word is a stem of the other ("surg" ~ "surgery", "gyna" ~ "gynecology", "derma" ~ "dermatology"). */
function sameStem(t: string, c: string): boolean {
  const cp = commonPrefix(t, c)
  return cp >= Math.min(t.length, c.length) || (t.length >= 4 && cp >= Math.min(t.length - 1, 3))
}

export type How = 'exact' | 'close' | 'none'
export interface Match { name: string | null; how: How }

/**
 * Speciality name -> the database name. Exact words first; then the SAME number of words, each one a stem of the
 * other ("Surg" matches "Surgery" but never "Plastic Surg" or "Vascular Surg"). Several close candidates = no match (ambiguous).
 */
export function matchSpeciality(wanted: string, names: string[]): Match {
  const w = normName(wanted)
  const exact = names.filter((n) => normName(n) === w)
  if (exact.length > 0) return { name: exact[0], how: 'exact' }
  const ww = w.split(' ')
  const close = names.filter((n) => {
    const cw = normName(n).split(' ')
    return cw.length === ww.length && ww.every((x, i) => sameStem(x, cw[i]))
  })
  return close.length === 1 ? { name: close[0], how: 'close' } : { name: null, how: 'none' }
}

export interface ProductName { name: string; line: string | null }
/** Product name -> the database name, preferring products of the same line; spacing / dashes are ignored ("Q-Afta" ~ "Q Afta"). */
export function matchProduct(wanted: string, products: ProductName[], line: string): Match {
  const sameLine = products.filter((p) => p.line === null || normName(p.line) === normName(line))
  const forms = [compact(wanted), ...(PRODUCT_ALIASES[compact(wanted)] ?? []).map(compact)]
  const pick = (pool: ProductName[]): Match | null => {
    const exact = pool.filter((p) => forms.includes(compact(p.name)))
    if (exact.length > 0) return { name: exact[0].name, how: 'exact' }
    const part = pool.filter((p) => forms.some((f) => f.length >= 3 && (compact(p.name).includes(f) || (compact(p.name).length >= 4 && f.includes(compact(p.name))))))
    if (part.length > 0) return { name: [...part].sort((a, b) => a.name.length - b.name.length)[0].name, how: 'close' }
    return null
  }
  return pick(sameLine) ?? { name: null, how: 'none' }
}

export interface Slot { wanted: string; matched: string | null; how: How }
export interface Suggestion { line: string; group: string; specialities: Slot[]; products: Slot[] }

export function suggestMap(map: SuggestedGroup[], specialities: string[], products: ProductName[]): Suggestion[] {
  return map.map((g) => ({
    line: g.line,
    group: g.group,
    specialities: g.specialities.map((w) => { const m = matchSpeciality(w, specialities); return { wanted: w, matched: m.name, how: m.how } }),
    products: g.products.map((w) => { const m = matchProduct(w, products, g.line); return { wanted: w, matched: m.name, how: m.how } }),
  }))
}

/* ------------------------------ scope (company / line / product) ------------------------------ */
export type Measure = 'value' | 'units'
export const parseMeasure = (v: string | null): Measure => (v === 'units' ? 'units' : 'value')
export const DEFAULT_MIN_VISITS = 10
/** Min-visits box -> whole number >= 0; empty or invalid falls back to the default. */
export function parseMinVisits(text: string | null): number {
  if (text === null || text.trim() === '') return DEFAULT_MIN_VISITS
  const n = Number(text)
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MIN_VISITS
}

/** What the chart and the territories table show: one group (old functions) or the scope Line / Product (new functions). */
export interface Selection { group: number | null; line: number | null; product: number | null }
export interface RpcCall { fn: string; args: Record<string, unknown> }

/** A product only makes sense inside a line. */
export const scopeProduct = (line: number | null, product: number | null): number | null => (line === null ? null : product)

export function monthlyCall(sel: Selection, from: string, to: string, shift: Shift): RpcCall {
  if (sel.group !== null) return { fn: 'speciality_roi_monthly', args: { p_group: sel.group, p_from: from, p_to: to, p_shift: shift } }
  return { fn: 'speciality_roi_scope_monthly', args: { p_from: from, p_to: to, p_line: sel.line, p_product: scopeProduct(sel.line, sel.product), p_shift: shift } }
}
export function territoriesCall(sel: Selection, from: string, to: string, shift: Shift, minVisits: number): RpcCall {
  if (sel.group !== null) return { fn: 'speciality_roi_territories', args: { p_group: sel.group, p_from: from, p_to: to, p_shift: shift } }
  return { fn: 'speciality_roi_territories_scope', args: { p_from: from, p_to: to, p_line: sel.line, p_product: scopeProduct(sel.line, sel.product), p_shift: shift, p_min_visits: minVisits } }
}
/** Stable cache key for a call (same function + same parameters = same entry). */
export const callKey = (c: RpcCall): string => c.fn + ':' + Object.keys(c.args).sort().map((k) => String(c.args[k] ?? 'null')).join(':')

/* ------------------------------ coverage / PCF colours ------------------------------ */
/** Coverage and PCF: below `amber` red, from `amber` to below `green` amber, `green` and above green (ratios 0..1). */
export const COVERAGE_THRESHOLDS = { amber: 0.7, green: 0.85 } as const
export function ratioTone(v: number | null): RoiTone {
  if (v === null) return 'none'
  return v < COVERAGE_THRESHOLDS.amber ? 'red' : v < COVERAGE_THRESHOLDS.green ? 'amber' : 'green'
}
export const fmtPct1 = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)
export const DOCTORS_TIP = 'List doctors of the selected shift: PM = Clinic + Poly Clinic, AM = other doctor types, All = both; pharmacies excluded; last list month of the period'
export const KPI_TIP = 'Coverage = covered / list doctors, PCF = valid visits / target visits (sum of Freq), for the doctors linked to the selection (Clinic + Poly Clinic)'

/** Coverage / PCF of a row; "—" (null) when the row has no KPI doctors. */
export const kpiRatio = (kpiDoctors: number, v: number | null): number | null => (kpiDoctors > 0 ? v : null)

/** Rows that fail `pred` first (in their order), the ones that pass last: low-sample rows stay at the bottom whatever the sort. */
export function lastWhen<T>(rows: T[], pred: (r: T) => boolean): T[] {
  return [...rows.filter((r) => !pred(r)), ...rows.filter(pred)]
}

export interface ScopeTotals { visits: number; s_value: number; s_units: number; cost: number; list_doctors: number; sales_per_visit: number | null; roi: number | null; coverage: number | null; pcf: number | null }
interface TotalIn { visits: number; s_value: number; s_units: number; cost: number; list_doctors: number; kpi_doctors: number; covered_doctors: number; valid_visits: number; target_visits: number }
/** Total row: sums; ROI = total sales (value) / total cost; coverage = sum covered / sum KPI doctors; PCF = sum valid visits / sum target visits. */
export function scopeTotals(rows: TotalIn[]): ScopeTotals {
  const sum = (f: (r: TotalIn) => number) => rows.reduce((a, r) => a + f(r), 0)
  const visits = sum((r) => r.visits), s_value = sum((r) => r.s_value), cost = sum((r) => r.cost), kpi = sum((r) => r.kpi_doctors), target = sum((r) => r.target_visits)
  return {
    visits, s_value, cost, s_units: sum((r) => r.s_units), list_doctors: sum((r) => r.list_doctors),
    sales_per_visit: visits > 0 ? s_value / visits : null, roi: cost > 0 ? s_value / cost : null, coverage: kpi > 0 ? sum((r) => r.covered_doctors) / kpi : null,
    pcf: kpi > 0 && target > 0 ? sum((r) => r.valid_visits) / target : null,
  }
}
