/**
 * Pure helpers for the Reports page. The database views produce every per-rep number; the browser only
 * sums counts for the pinned Total row and recomputes ratios from those sums (never averages ratios).
 * No imports: this file is also run directly by scripts/reportMath.test.mjs.
 */

export const DASH = '—'

export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const n0 = (v: unknown): number => numOrNull(v) ?? 0

export type Shift = 'am' | 'pm' | 'total'
export type ViewMode = 'both' | 'am' | 'pm'

/* ------------------------------------ row shapes ------------------------------------ */
export interface RepIdentity {
  month: string
  rep_id: number
  line_id: number | null
  manager_id: number | null
  box: string | null
  rep_code: string | null
  rep_name: string | null
  manager: string | null
  hire_date: string | null
}
export interface CoverageRow extends RepIdentity {
  list_doctors: number
  fully_covered: number
  partially_covered: number
  not_visited: number
  coverage: number | null
}

export const CALL_GROUPS = ['working', 'field', 'leave', 'ow', 'activity', 'visits', 'call_rate', 'missing'] as const
export type CallGroup = (typeof CALL_GROUPS)[number]
export type CountGroup = Exclude<CallGroup, 'call_rate'>
export type CallRateRow = RepIdentity & { [K in `${CountGroup}_${Shift}`]: number } & {
  call_rate_am: number | null
  call_rate_pm: number | null
  call_rate_total: number | null
}

function identity(r: Record<string, unknown>): RepIdentity {
  const s = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))
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
  }
}

export function toCoverageRow(r: Record<string, unknown>): CoverageRow {
  return {
    ...identity(r),
    list_doctors: n0(r.list_doctors),
    fully_covered: n0(r.fully_covered),
    partially_covered: n0(r.partially_covered),
    not_visited: n0(r.not_visited),
    coverage: numOrNull(r.coverage),
  }
}

export function toCallRateRow(r: Record<string, unknown>): CallRateRow {
  const out: Record<string, unknown> = { ...identity(r) }
  for (const g of CALL_GROUPS) {
    if (g === 'call_rate') continue
    for (const s of ['am', 'pm', 'total'] as const) out[`${g}_${s}`] = n0(r[`${g}_${s}`])
  }
  for (const s of ['am', 'pm', 'total'] as const) out[`call_rate_${s}`] = numOrNull(r[`call_rate_${s}`])
  return out as unknown as CallRateRow
}

/* ------------------------------------ totals ------------------------------------ */
const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null)

function totalIdentity(rows: RepIdentity[]): RepIdentity {
  return {
    month: rows[0]?.month ?? '', rep_id: 0, line_id: null, manager_id: null,
    box: 'Total', rep_code: null, rep_name: `${new Set(rows.map((r) => r.rep_id)).size} reps`, manager: null, hire_date: null,
  }
}

export function totalCoverage(rows: CoverageRow[]): CoverageRow {
  const sum = (k: 'list_doctors' | 'fully_covered' | 'partially_covered' | 'not_visited') => rows.reduce((a, r) => a + r[k], 0)
  const list = sum('list_doctors')
  const fully = sum('fully_covered')
  const partial = sum('partially_covered')
  return {
    ...totalIdentity(rows),
    list_doctors: list, fully_covered: fully, partially_covered: partial, not_visited: sum('not_visited'),
    coverage: ratio(fully + partial, list),
  }
}

export function totalCallRate(rows: CallRateRow[]): CallRateRow {
  const out: Record<string, unknown> = { ...totalIdentity(rows) }
  for (const g of CALL_GROUPS) {
    if (g === 'call_rate') continue
    for (const s of ['am', 'pm', 'total'] as const) {
      const key = `${g}_${s}` as const
      out[key] = rows.reduce((a, r) => a + r[key], 0)
    }
  }
  const t = out as unknown as CallRateRow
  t.call_rate_am = ratio(t.visits_am, t.field_am)
  t.call_rate_pm = ratio(t.visits_pm, t.field_pm)
  t.call_rate_total = ratio(t.visits_total, t.field_total)
  return t
}

/* ------------------------------------ formatting ------------------------------------ */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** '2024-03-05' -> '05-Mar-2024'; null / unparseable -> '—'. */
export function fmtHireDate(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  if (!m) return DASH
  return `${m[3]}-${MONTHS[Number(m[2]) - 1] ?? '???'}-${m[1]}`
}
export const fmtCount = (v: number | null): string => (v === null ? DASH : Math.round(v).toLocaleString('en-US'))
export const fmtCoverage = (v: number | null): string => (v === null ? DASH : `${(v * 100).toFixed(1)}%`)
export const fmtCallRate = (v: number | null): string => (v === null ? DASH : v.toFixed(2))
export const fmtTarget = (v: number | null): string => (v === null ? DASH : v.toFixed(1))

/** Dot colour of a call rate against its box target: >=100% success, 80-99% warning, <80% danger; no target -> none. */
export function targetTone(value: number | null, target: number | null): 'success' | 'warning' | 'danger' | null {
  if (value === null || target === null || !(target > 0)) return null
  const r = value / target
  return r >= 1 ? 'success' : r >= 0.8 ? 'warning' : 'danger'
}

/* ------------------------------------ default order ------------------------------------ */
const cmpNullLast = (a: number | null, b: number | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b)
const cmpText = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

/** Line -> Manager -> Box (then rep name, so the order is fully deterministic). */
export function defaultOrder<T extends RepIdentity>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      cmpNullLast(a.line_id, b.line_id) || cmpText(a.manager, b.manager) || cmpText(a.box, b.box) || cmpText(a.rep_name, b.rep_name),
  )
}

/* ------------------------------------ filters ------------------------------------ */
export interface ReportFilters { lineId: number | null; manager: string; search: string }

export function filterRows<T extends RepIdentity>(rows: T[], f: ReportFilters): T[] {
  const q = f.search.trim().toLowerCase()
  return rows.filter(
    (r) =>
      (f.lineId === null || r.line_id === f.lineId) &&
      (f.manager === '' || r.manager === f.manager) &&
      (q === '' || [r.rep_name, r.rep_code, r.box].some((v) => v !== null && v.toLowerCase().includes(q))),
  )
}

/** Distinct manager names of the rows (optionally limited to a line), sorted. */
export function managerOptions(rows: RepIdentity[], lineId: number | null): string[] {
  return [...new Set(rows.filter((r) => lineId === null || r.line_id === lineId).flatMap((r) => (r.manager ? [r.manager] : [])))].sort(cmpText)
}

/* ------------------------------------ call-rate columns / modes ------------------------------------ */
export const GROUP_LABEL: Record<CallGroup, string> = {
  working: 'Working days', field: 'Field days', leave: 'Vacation', ow: 'Office work',
  activity: 'Activities', visits: 'Visits', call_rate: 'Call rate', missing: 'Missing days',
}
export const SHIFT_LABEL: Record<Shift, string> = { am: 'AM', pm: 'PM', total: 'Total' }

export interface CallCol { id: keyof CallRateRow & string; group: CallGroup; shift: Shift; header: string }

/** Shifts shown in a mode. Total mixes both shifts, so single-shift modes hide it. */
export const shiftsFor = (mode: ViewMode): Shift[] => (mode === 'both' ? ['am', 'pm', 'total'] : [mode])

/** Visible grouped columns for a mode, in display order. */
export function callRateColumns(mode: ViewMode, showMissing: boolean): CallCol[] {
  const groups = CALL_GROUPS.filter((g) => g !== 'missing' || showMissing)
  return groups.flatMap((g) =>
    shiftsFor(mode).map((s) => ({
      id: `${g}_${s}` as CallCol['id'], group: g, shift: s, header: `${GROUP_LABEL[g]} ${SHIFT_LABEL[s]}`,
    })),
  )
}

/* ------------------------------------ export mapping ------------------------------------ */
export type ExportRow = Record<string, string | number | null>
const round = (v: number | null, d: number) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d)

/** Identity columns shared by both reports; `visible` takes the column ids box / rep / manager / hire. */
function identityCells(r: RepIdentity, visible: (id: string) => boolean): ExportRow {
  const o: ExportRow = {}
  if (visible('box')) o['Box'] = r.box
  if (visible('rep')) {
    o['Medical Rep'] = r.rep_name
    o['Rep code'] = r.rep_code
  }
  if (visible('manager')) o['Direct Manager'] = r.manager
  if (visible('hire')) o['Hiring date'] = r.hire_date === null ? null : fmtHireDate(r.hire_date)
  return o
}

/** Rows + pinned Total as flat records with the same headers as the table. Null stays null (empty cell). */
export function exportCoverage(rows: CoverageRow[], total: CoverageRow, visible: (id: string) => boolean = () => true): ExportRow[] {
  return [...rows, total].map((r) => {
    const o = identityCells(r, visible)
    if (visible('list')) o['List'] = r.list_doctors
    if (visible('fully')) o['Fully covered'] = r.fully_covered
    if (visible('partial')) o['Partially covered'] = r.partially_covered
    if (visible('not_visited')) o['Not visited'] = r.not_visited
    if (visible('coverage')) o['Coverage %'] = round(r.coverage === null ? null : r.coverage * 100, 1)
    return o
  })
}

/** `visible` takes the identity ids plus the group names (working, field, ..., call_rate, missing). */
export function exportCallRate(
  rows: CallRateRow[], total: CallRateRow, mode: ViewMode, showMissing: boolean, visible: (id: string) => boolean = () => true,
): ExportRow[] {
  const cols = callRateColumns(mode, showMissing).filter((c) => visible(c.group))
  return [...rows, total].map((r) => {
    const o = identityCells(r, visible)
    for (const c of cols) o[c.header] = c.group === 'call_rate' ? round(r[c.id] as number | null, 2) : (r[c.id] as number)
    return o
  })
}
