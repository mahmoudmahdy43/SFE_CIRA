import { addMonthsIso, monthStart } from '../../lib/norm'
import type { BandRow, CorrRow, MatrixRow, OverviewRow, TerritoryMonth, TerritoryRow } from '../../lib/api/dashV1'

/** Pure helpers of Dashboard V1. Ratios (ach, coverage, shares, growth) are 0-1; effort_pct / ach_pct are already percent. */

export const monthEnd = (m: string): string => {
  const next = addMonthsIso(monthStart(m), 1)
  const d = new Date(`${next}T00:00:00Z`)
  d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}

/** Whole months in [from, to] (first-of-month ISO strings). */
export const monthSpan = (from: string, to: string): number => {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm) + 1
}

/** The period of the same length immediately before [from, to] (months). */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const len = monthSpan(from, to)
  return { from: addMonthsIso(from, -len), to: addMonthsIso(from, -1) }
}

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)
export const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null)

export interface OverviewTotals { sales: number; ach: number | null; coverage: number | null; pcf: number | null; visits: number; callRate: number | null }
export function overviewTotals(rows: OverviewRow[]): OverviewTotals {
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month))
  const lastPcf = [...sorted].reverse().find((r) => r.pcf !== null)?.pcf ?? null
  return {
    sales: sum(rows.map((r) => r.s_value)),
    ach: ratio(sum(rows.map((r) => r.s_value)), sum(rows.map((r) => r.t_value))),
    coverage: ratio(sum(rows.map((r) => r.covered)), sum(rows.map((r) => r.list_doctors))),
    pcf: lastPcf,
    visits: sum(rows.map((r) => r.visits)),
    callRate: ratio(sum(rows.map((r) => r.visits)), sum(rows.map((r) => r.days_pm))),
  }
}

/** Relative change in percent (for money / counts); null when the base is 0. */
export const relChange = (cur: number | null, prev: number | null): number | null =>
  cur === null || prev === null || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100
/** Difference in percentage points between two ratios. */
export const ptsChange = (cur: number | null, prev: number | null): number | null => (cur === null || prev === null ? null : (cur - prev) * 100)

export const metricLabel = (m: string): string => ({ visits: 'Visits per list doctor', coverage: 'Coverage', pcf: 'PCF' } as Record<string, string>)[m] ?? m

export function corrWord(r: number): string {
  const a = Math.abs(r)
  return a < 0.2 ? 'no clear link' : a < 0.4 ? 'weak' : a < 0.6 ? 'moderate' : 'strong'
}
/** r used for display: within-territory when present, else across. */
export const corrValue = (c: CorrRow): number | null => c.r_within ?? c.r_across

export interface Fit { slope: number; intercept: number; r: number; n: number }
/** Least-squares line and Pearson r; null with fewer than 3 points or no spread. */
export function linearFit(pts: { x: number; y: number }[]): Fit | null {
  const k = pts.length
  if (k < 3) return null
  const mx = sum(pts.map((p) => p.x)) / k
  const my = sum(pts.map((p) => p.y)) / k
  let sxx = 0, syy = 0, sxy = 0
  for (const p of pts) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my) }
  if (sxx === 0 || syy === 0) return null
  const slope = sxy / sxx
  return { slope, intercept: my - slope * mx, r: sxy / Math.sqrt(sxx * syy), n: k }
}

export interface Dot { x: number; y: number; name: string; month: string }

/** Territory-month dots for the scatter: line filter, no vacant territory, no row without a list. */
export function scatterPoints(rows: TerritoryMonth[], line: number | null, lineName: string | null): Dot[] {
  const out: Dot[] = []
  for (const r of rows) {
    if (line !== null && r.line_id !== line && !(r.line_id === null && lineName && r.line_name === lineName)) continue
    if (r.vacant || !r.has_list || r.visits_per_doctor === null || r.ach === null) continue
    out.push({ x: r.visits_per_doctor, y: r.ach * 100, name: r.territory_name, month: r.month.slice(0, 7) })
  }
  return out
}

/** Months in the range whose territory rows carry no list (list loaded without territory). */
export function monthsWithoutList(rows: TerritoryMonth[]): string[] {
  const byMonth = new Map<string, boolean>()
  for (const r of rows) byMonth.set(r.month, (byMonth.get(r.month) ?? false) || (r.has_list && r.list_doctors > 0))
  return [...byMonth].filter(([, ok]) => !ok).map(([m]) => m).sort()
}

export const pct = (v: number | null, d = 1): string => (v === null ? '–' : `${(v * 100).toFixed(d)}%`)
export const pctPt = (v: number | null, d = 1): string => (v === null ? '–' : `${v.toFixed(d)}%`)
export const money = (v: number | null): string => {
  if (v === null) return '–'
  const a = Math.abs(v)
  return a >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0)
}
export const num = (v: number | null, d = 0): string => (v === null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: d }))
export const monthLabel = (m: string): string => new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })

/** Territories whose sales share is far below their list share, biggest gap (in points) first. */
export function biggestGaps(rows: TerritoryRow[], top = 10): (TerritoryRow & { gap: number })[] {
  return rows
    .filter((r) => r.share_index !== null && r.share_index < 0.8 && r.list_share !== null && r.sales_share !== null)
    .map((r) => ({ ...r, gap: ((r.list_share ?? 0) - (r.sales_share ?? 0)) * 100 }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, top)
}

export function groupRows(rows: MatrixRow[]): Record<MatrixRow['grp'], MatrixRow[]> {
  const out: Record<MatrixRow['grp'], MatrixRow[]> = { STAR: [], NOT_CONVERTING: [], EFFICIENT: [], INTERVENTION: [], NO_DATA: [] }
  for (const r of rows) out[r.grp].push(r)
  return out
}

export interface Insight { id: string; text: string }

/** Plain-template sentences for the Overview panel; a sentence is skipped when its data is missing. */
export function insights(input: { corr: CorrRow[] | null; bands: BandRow[] | null; territories: TerritoryRow[] | null }): Insight[] {
  const out: Insight[] = []
  const { corr, bands, territories } = input
  const lag1 = (corr ?? []).filter((c) => c.lag === 1 && c.r_within !== null)
  if (lag1.length) {
    const best = [...lag1].sort((a, b) => Math.abs(b.r_within ?? 0) - Math.abs(a.r_within ?? 0))[0]
    const r = best.r_within as number
    out.push({ id: 'corr', text: `${metricLabel(best.metric)} is the KPI most linked with sales (${corrWord(r)}, r = ${r.toFixed(2)}).` })
  }
  if (bands && bands.length >= 2) {
    const first = bands[0]
    const top = bands[bands.length - 1]
    if (first.growth !== null && top.growth !== null) {
      out.push({ id: 'bands', text: `Territories with Coverage ${top.band} grew ${pctPt(top.growth * 100)} vs ${pctPt(first.growth * 100)} for ${first.band}.` })
    }
  }
  if (territories?.length) {
    const gaps = territories.filter((t) => t.share_index !== null && t.share_index < 0.8 && t.list_share !== null && t.sales_share !== null)
    if (gaps.length) {
      out.push({ id: 'gaps', text: `${gaps.length} territories hold ${pctPt(sum(gaps.map((g) => g.list_share ?? 0)) * 100)} of the list but only ${pctPt(sum(gaps.map((g) => g.sales_share ?? 0)) * 100)} of sales.` })
    }
    const vacant = territories.filter((t) => t.vacant_months > 0)
    if (vacant.length) out.push({ id: 'vacant', text: `${vacant.length} territories are vacant; sales there ${money(sum(vacant.map((v) => v.s_value)))}.` })
  }
  return out
}
