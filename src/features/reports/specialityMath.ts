/**
 * Speciality Mix report helpers. The database views (`v_speciality_mix`, `v_speciality_mix_line`) produce every
 * per-rep / per-line number and red flag: doctors, share_pct, strategy_pct, diff_points, is_off, threshold_points.
 * The browser maps, filters, orders and formats them. The ONE place it derives anything is `totalMixRow`: the
 * pinned Total row covers an arbitrary selection of reps (line / manager / search filters), which no view can
 * pre-aggregate, so its share / strategy / red flag are derived there, from the views' own numbers, with the
 * views' own threshold. Everything else reads is_off as-is.
 * No imports: this file is also run directly by scripts/reportMath.test.mjs.
 */

export const MIX_DASH = '—'

export interface MixCell {
  speciality: string
  doctors: number
  total_docs: number
  share_pct: number | null
  strategy_pct: number | null
  diff_points: number | null
  is_off: boolean
  threshold_points: number | null
}

/** One matrix row: a rep (By rep) or a line (By line). `rep_id` 0 is reserved for the pinned Total row. */
export interface MixRow {
  rep_id: number
  rep_code: string | null
  rep_name: string | null
  line: string | null
  manager: string | null
  total_docs: number
  cells: Map<string, MixCell>
}

export type MixKind = 'rep' | 'line'

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

function toCell(r: Record<string, unknown>): MixCell {
  return {
    speciality: String(r.speciality ?? ''),
    doctors: numOrNull(r.doctors) ?? 0,
    total_docs: numOrNull(r.total_docs) ?? 0,
    share_pct: numOrNull(r.share_pct),
    strategy_pct: numOrNull(r.strategy_pct),
    diff_points: numOrNull(r.diff_points),
    is_off: r.is_off === true,
    threshold_points: numOrNull(r.threshold_points),
  }
}

const cmpText = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

/** Group the view's rows (one per rep x speciality) into one matrix row per rep. */
export function buildRepRows(raw: Record<string, unknown>[]): MixRow[] {
  const byRep = new Map<number, MixRow>()
  for (const r of raw) {
    const id = numOrNull(r.rep_id)
    if (id === null) continue
    let row = byRep.get(id)
    if (!row) {
      row = { rep_id: id, rep_code: s(r.rep_code), rep_name: s(r.rep_name), line: s(r.line), manager: s(r.manager), total_docs: 0, cells: new Map() }
      byRep.set(id, row)
    }
    const cell = toCell(r)
    row.cells.set(cell.speciality, cell)
    row.total_docs = Math.max(row.total_docs, cell.total_docs)
  }
  return [...byRep.values()]
}

/** Group the line view's rows into one matrix row per line (ids are 1.. in line-name order; 0 stays the Total). */
export function buildLineRows(raw: Record<string, unknown>[]): MixRow[] {
  const byLine = new Map<string, MixRow>()
  for (const r of raw) {
    const line = s(r.line)
    if (line === null) continue
    let row = byLine.get(line)
    if (!row) {
      row = { rep_id: 0, rep_code: null, rep_name: line, line, manager: null, total_docs: 0, cells: new Map() }
      byLine.set(line, row)
    }
    const cell = toCell(r)
    row.cells.set(cell.speciality, cell)
    row.total_docs = Math.max(row.total_docs, cell.total_docs)
  }
  return [...byLine.values()].sort((a, b) => cmpText(a.line, b.line)).map((r, i) => ({ ...r, rep_id: i + 1 }))
}

export const isMixTotal = (r: MixRow): boolean => r.rep_id === 0
export const isOffRow = (r: MixRow): boolean => [...r.cells.values()].some((c) => c.is_off)

/* ------------------------------------ filters / order ------------------------------------ */
export interface MixFilters {
  /** Line name (the views carry the name, the shared filter carries the id); null = all lines. */
  line: string | null
  manager: string
  search: string
  onlyRed: boolean
}

export function filterMixRows(rows: MixRow[], f: MixFilters): MixRow[] {
  const q = f.search.trim().toLowerCase()
  return rows.filter(
    (r) =>
      (f.line === null || r.line === f.line) &&
      (f.manager === '' || r.manager === f.manager) &&
      (q === '' || [r.rep_name, r.rep_code].some((v) => v !== null && v.toLowerCase().includes(q))) &&
      (!f.onlyRed || isOffRow(r)),
  )
}

export function mixManagers(rows: MixRow[], line: string | null): string[] {
  return [...new Set(rows.filter((r) => line === null || r.line === line).flatMap((r) => (r.manager ? [r.manager] : [])))].sort(cmpText)
}

/** Line -> Manager -> Rep name (By line rows have one entry per line, so this is just the line order). */
export function orderMixRows(rows: MixRow[]): MixRow[] {
  return [...rows].sort((a, b) => cmpText(a.line, b.line) || cmpText(a.manager, b.manager) || cmpText(a.rep_name, b.rep_name))
}

/** Speciality columns of the visible rows: most doctors first; hidden when there are no doctors AND no strategy. */
export function specialityColumns(rows: MixRow[]): string[] {
  const docs = new Map<string, number>()
  const strat = new Map<string, number>()
  for (const r of rows)
    for (const c of r.cells.values()) {
      docs.set(c.speciality, (docs.get(c.speciality) ?? 0) + c.doctors)
      strat.set(c.speciality, Math.max(strat.get(c.speciality) ?? 0, c.strategy_pct ?? 0))
    }
  return [...docs.keys()]
    .filter((k) => (docs.get(k) ?? 0) > 0 || (strat.get(k) ?? 0) > 0)
    .sort((a, b) => (docs.get(b) ?? 0) - (docs.get(a) ?? 0) || cmpText(a, b))
}

/** True once any strategy percentage above 0 exists in the data (false = "No List Strategy entered yet"). */
export const hasStrategy = (rows: MixRow[]): boolean => rows.some((r) => [...r.cells.values()].some((c) => (c.strategy_pct ?? 0) > 0))

/** The threshold the views applied (the same value is on every row). */
export function mixThreshold(rows: MixRow[]): number | null {
  for (const r of rows) for (const c of r.cells.values()) if (c.threshold_points !== null) return c.threshold_points
  return null
}

/* ------------------------------------ Total row ------------------------------------ */
/**
 * Pinned Total: doctors per speciality summed over `rows`; share = doctors / all doctors of those rows; strategy =
 * the rows' strategies weighted by their list size (the line's own strategy when one line is visible); red uses the
 * views' threshold with the same rule as the views (|share - strategy| > threshold, percentage points).
 */
export function totalMixRow(rows: MixRow[], specs: string[], threshold: number | null, label: string): MixRow {
  const totalDocs = rows.reduce((a, r) => a + r.total_docs, 0)
  const cells = new Map<string, MixCell>()
  for (const sp of specs) {
    let doctors = 0
    let weighted = 0
    for (const r of rows) {
      const c = r.cells.get(sp)
      doctors += c?.doctors ?? 0
      weighted += (c?.strategy_pct ?? 0) * r.total_docs
    }
    const share = totalDocs > 0 ? (doctors / totalDocs) * 100 : null
    const strategy = totalDocs > 0 ? weighted / totalDocs : null
    const diff = share !== null && strategy !== null ? share - strategy : null
    cells.set(sp, {
      speciality: sp, doctors, total_docs: totalDocs, share_pct: share, strategy_pct: strategy, diff_points: diff,
      is_off: threshold !== null && diff !== null && Math.abs(diff) > threshold, threshold_points: threshold,
    })
  }
  return { rep_id: 0, rep_code: null, rep_name: label, line: null, manager: null, total_docs: totalDocs, cells }
}

/* ------------------------------------ formatting ------------------------------------ */
const trim1 = (v: number): string => String(Number(v.toFixed(1)))
export const fmtMixCount = (v: number): string => Math.round(v).toLocaleString('en-US')
export const fmtMixPct = (v: number | null): string => (v === null ? MIX_DASH : `${trim1(v)}%`)
export const fmtMixPts = (v: number | null): string => (v === null ? MIX_DASH : `${v > 0 ? '+' : v < 0 ? '-' : ''}${trim1(Math.abs(v))} pts`)

/** "Gyn: 50 doctors = 42% of the list, strategy 50%, -8 pts (threshold 15 pts)" */
export function cellTip(c: MixCell): string {
  const thr = c.threshold_points === null ? MIX_DASH : `${trim1(c.threshold_points)} pts`
  return `${c.speciality}: ${fmtMixCount(c.doctors)} ${c.doctors === 1 ? 'doctor' : 'doctors'} = ${fmtMixPct(c.share_pct)} of the list, strategy ${fmtMixPct(c.strategy_pct)}, ${fmtMixPts(c.diff_points)} (threshold ${thr})`
}

export const thresholdText = (v: number): string => `Red when the share differs from the strategy by more than ${trim1(v)} points`
export const NO_STRATEGY_TEXT = 'No List Strategy entered yet - enter it in Settings > List Strategy'

/* ------------------------------------ export ------------------------------------ */
type Out = Record<string, string | number | null>
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10)

export interface MixExport {
  /** Doctor counts, one column per speciality. */
  doctors: Out[]
  /** share % and strategy % per speciality (two columns each). */
  shares: Out[]
  /** Red cells, keyed `${dataRowIndex}|${header}` (dataRowIndex is 0-based, the header row excluded). */
  doctorsRed: Set<string>
  sharesRed: Set<string>
}

/** Rows (+ the Total row last) as flat records for the two sheets; the red set marks the cells the views flagged. */
export function exportMix(rows: MixRow[], specs: string[], total: MixRow, kind: MixKind): MixExport {
  const all = [...rows, total]
  const out: MixExport = { doctors: [], shares: [], doctorsRed: new Set(), sharesRed: new Set() }
  all.forEach((r, i) => {
    const ident: Out = kind === 'rep'
      ? { Rep: r.rep_name, Code: r.rep_code, Line: r.line, Manager: r.manager, 'Total doctors': r.total_docs }
      : { Line: r.rep_name, 'Total doctors': r.total_docs }
    const d: Out = { ...ident }
    const sh: Out = { ...ident }
    for (const sp of specs) {
      const c = r.cells.get(sp)
      d[sp] = c?.doctors ?? 0
      sh[`${sp} share %`] = round1(c?.share_pct ?? null)
      sh[`${sp} strategy %`] = round1(c?.strategy_pct ?? null)
      if (c?.is_off) {
        out.doctorsRed.add(`${i}|${sp}`)
        out.sharesRed.add(`${i}|${sp} share %`)
        out.sharesRed.add(`${i}|${sp} strategy %`)
      }
    }
    out.doctors.push(d)
    out.shares.push(sh)
  })
  return out
}
