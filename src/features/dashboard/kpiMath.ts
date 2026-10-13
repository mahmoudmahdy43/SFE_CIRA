/**
 * Pure helpers for the KPI dashboard. The browser never computes KPIs from raw rows: every ratio comes
 * from the SQL views. These helpers only format, handle nulls, group rows and build the drill-down tree.
 */

export type Nullable<T> = T | null

/** PostgREST may return numeric/bigint as strings; null and non-finite values stay null. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const NA = '—'

/** 0.8512 -> "85.1%". null -> "—" (never "0%"). */
export function fmtPct(v: number | null, digits = 1): string {
  return v === null ? NA : `${(v * 100).toFixed(digits)}%`
}
/** Call rate with 2 decimals. */
export function fmtRate(v: number | null): string {
  return v === null ? NA : v.toFixed(2)
}
export function fmtInt(v: number | null): string {
  return v === null ? NA : Math.round(v).toLocaleString('en-US')
}

/** Percentage-point difference between two ratios (0.82 vs 0.80 -> 2.0). null if either side is missing. */
export function deltaPts(cur: number | null, prev: number | null): number | null {
  return cur === null || prev === null ? null : Math.round((cur - prev) * 1e6) / 1e4
}

/** share = part / whole as a ratio, null when the whole is missing or zero. */
export function share(part: number | null, whole: number | null): number | null {
  return part === null || whole === null || whole === 0 ? null : part / whole
}

export function sumNullable(...vals: (number | null)[]): number | null {
  const present = vals.filter((v): v is number => v !== null)
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0)
}

/* ------------------------------ row shapes ------------------------------ */
export interface KpiNumbers {
  reps: number | null
  list_doctors: number | null
  covered_doctors: number | null
  total_visits: number | null
  valid_visits: number | null
  planned_visits: number | null
  direct_visits: number | null
  days_am: number | null
  days_pm: number | null
  missing_am: number | null
  missing_pm: number | null
  leave_days: number | null
  ow_days: number | null
  activity_days: number | null
  visits_am: number | null
  visits_pm: number | null
  expected_visits: number | null
  coverage: number | null
  pcf: number | null
  ach_cr: number | null
  call_rate_am: number | null
  call_rate_pm: number | null
  total_kpi: number | null
}

const KPI_KEYS: (keyof KpiNumbers)[] = [
  'reps', 'list_doctors', 'covered_doctors', 'total_visits', 'valid_visits', 'planned_visits', 'direct_visits',
  'days_am', 'days_pm', 'missing_am', 'missing_pm', 'leave_days', 'ow_days', 'activity_days', 'visits_am',
  'visits_pm', 'expected_visits', 'coverage', 'pcf', 'ach_cr', 'call_rate_am', 'call_rate_pm', 'total_kpi',
]

/** Normalise one view row into numbers/nulls. */
export function toKpi(row: Record<string, unknown>): KpiNumbers {
  const out = {} as KpiNumbers
  for (const k of KPI_KEYS) out[k] = num(row[k])
  return out
}

/** A ratio is only meaningful when its denominator exists: Ach CR needs expected visits > 0. */
export function achCrAvailable(k: KpiNumbers): boolean {
  return (k.expected_visits ?? 0) > 0 && k.ach_cr !== null
}

/** Slots by status from the view sums (plain arithmetic on counts, not a KPI). */
export function statusMix(k: KpiNumbers): { worked: number; missing: number; leave: number; office_work: number; activity: number } {
  const actual = (k.days_am ?? 0) + (k.days_pm ?? 0)
  const missing = (k.missing_am ?? 0) + (k.missing_pm ?? 0)
  return {
    worked: Math.max(0, actual - missing),
    missing,
    leave: k.leave_days ?? 0,
    office_work: k.ow_days ?? 0,
    activity: k.activity_days ?? 0,
  }
}

/* ------------------------------ drill-down tree ------------------------------ */
export interface TreeNode extends KpiNumbers {
  id: string
  level: 'line' | 'manager' | 'rep'
  name: string
  code: string | null
  repId: number | null
  lineId: number | null
  managerId: number | null
  boxName: string | null
  target_am: number | null
  target_pm: number | null
  planned_pct: number | null
  children: TreeNode[]
}

export interface LineRow extends KpiNumbers { line_id: number | null }
export interface ManagerRow extends KpiNumbers { line_id: number | null; manager_id: number | null }
export interface RepRow extends KpiNumbers {
  /** Σ Freq over the rep's C/PC list doctors (v_kpi_rep.target_visits); the PCF denominator. */
  target_visits: number | null
  rep_id: number
  box_id: number | null
  line_id: number | null
  manager_id: number | null
  target_am: number | null
  target_pm: number | null
}

export interface Names {
  lines: Map<number, string>
  managers: Map<number, string>
  reps: Map<number, { code: string; name: string }>
  boxes: Map<number, string>
}

const plannedPct = (k: KpiNumbers) => share(k.planned_visits, sumNullable(k.planned_visits, k.direct_visits))

/** Line -> Manager (null = "Vacant manager") -> Rep. Every level uses the numbers the views gave for it. */
export function buildTree(lines: LineRow[], managers: ManagerRow[], reps: RepRow[], names: Names): TreeNode[] {
  const lineName = (id: number | null) => (id === null ? 'No line' : names.lines.get(id) ?? `Line #${id}`)
  const repNodes = (lineId: number | null, managerId: number | null): TreeNode[] =>
    reps
      .filter((r) => r.line_id === lineId && r.manager_id === managerId)
      .map((r) => {
        const info = names.reps.get(r.rep_id)
        return {
          ...r,
          id: `r${r.rep_id}`,
          level: 'rep' as const,
          name: info?.name ?? `Rep #${r.rep_id}`,
          code: info?.code ?? null,
          repId: r.rep_id,
          lineId,
          managerId,
          boxName: r.box_id === null ? null : names.boxes.get(r.box_id) ?? null,
          planned_pct: plannedPct(r),
          children: [],
        }
      })
  const managerNodes = (lineId: number | null): TreeNode[] =>
    managers
      .filter((m) => m.line_id === lineId)
      .map((m) => ({
        ...m,
        id: `m${lineId}-${m.manager_id ?? 'vacant'}`,
        level: 'manager' as const,
        name: m.manager_id === null ? 'Vacant manager' : names.managers.get(m.manager_id) ?? `Manager #${m.manager_id}`,
        code: null,
        repId: null,
        lineId,
        managerId: m.manager_id,
        boxName: null,
        target_am: null,
        target_pm: null,
        planned_pct: plannedPct(m),
        children: repNodes(lineId, m.manager_id),
      }))
  return lines.map((l) => ({
    ...l,
    id: `l${l.line_id ?? 'none'}`,
    level: 'line' as const,
    name: lineName(l.line_id),
    code: null,
    repId: null,
    lineId: l.line_id,
    managerId: null,
    boxName: null,
    target_am: null,
    target_pm: null,
    planned_pct: plannedPct(l),
    children: managerNodes(l.line_id),
  }))
}

/** Boxes (with at least one rep row) that have no usable call-rate target for the month. */
export function boxesMissingTargets(reps: RepRow[]): number {
  const boxes = new Set<number>()
  for (const r of reps) {
    if (r.box_id === null) continue
    const none = (r.target_am ?? 0) === 0 && (r.target_pm ?? 0) === 0
    if (none) boxes.add(r.box_id)
  }
  return boxes.size
}

/** Latest month (YYYY-MM-01) from a list of months with KPI data, or null. */
export function latestMonth(months: string[]): string | null {
  return months.length === 0 ? null : [...months].sort()[months.length - 1]
}

/** Flat rows for CSV export of the visible tree (indent by level in the name column). */
export function flattenForCsv(nodes: TreeNode[], depth = 0): Record<string, string | number>[] {
  const out: Record<string, string | number>[] = []
  for (const n of nodes) {
    out.push({
      level: n.level,
      name: `${'  '.repeat(depth)}${n.name}`,
      code: n.code ?? '',
      reps: n.reps ?? '',
      list_doctors: n.list_doctors ?? '',
      coverage: n.coverage === null ? '' : n.coverage,
      pcf: n.pcf === null ? '' : n.pcf,
      ach_cr: n.ach_cr === null ? '' : n.ach_cr,
      call_rate_am: n.call_rate_am === null ? '' : n.call_rate_am,
      call_rate_pm: n.call_rate_pm === null ? '' : n.call_rate_pm,
      target_am: n.target_am ?? '',
      target_pm: n.target_pm ?? '',
      total_visits: n.total_visits ?? '',
      planned_pct: n.planned_pct === null ? '' : n.planned_pct,
      missing_am: n.missing_am ?? '',
      missing_pm: n.missing_pm ?? '',
      total_kpi: n.total_kpi === null ? '' : n.total_kpi,
    })
    out.push(...flattenForCsv(n.children, depth + 1))
  }
  return out
}
