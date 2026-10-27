/**
 * "Sales Analysis per Employee": pure helpers (no imports: also run directly by scripts/salesEmployee.test.mjs).
 * The database function sales_by_employee (92_sales_by_employee.sql) returns one row per month x line x direct manager x (rep | vacant box);
 * the browser builds the Company > Line > Direct Manager > Rep / Vacant tree, every total being the sum of its children.
 */

export type Metric = 'value' | 'units'
export const TITLE = 'Sales by Employee'
export const PAGE_SIZE = 1000

/* ------------------------------ rows ------------------------------ */
type Raw = Record<string, unknown>
const num = (v: unknown): number => { const n = typeof v === 'number' ? v : Number(v ?? 0); return Number.isFinite(n) ? n : 0 }
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const text = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
export interface EmpRow {
  month: string; line_id: number | null; line_name: string | null; manager_id: number | null; manager_name: string | null
  rep_id: number | null; rep_name: string | null; rep_code: string | null; territory_id: number | null; territory_names: string | null
  /** Optional: the box name when the function returns it (92 does not use box_id, so it is normally null). */
  box_name: string | null
  s_value: number; s_units: number; t_value: number; t_units: number
}
export const toEmpRow = (r: Raw): EmpRow => ({
  month: String(r.month ?? '').slice(0, 10), line_id: numOrNull(r.line_id), line_name: text(r.line_name), manager_id: numOrNull(r.manager_id), manager_name: text(r.manager_name),
  rep_id: numOrNull(r.rep_id), rep_name: text(r.rep_name), rep_code: text(r.rep_code), territory_id: numOrNull(r.territory_id), territory_names: text(r.territory_names ?? r.territory_name ?? r.territory ?? r.terr_name), box_name: text(r.box_name ?? r.box),
  s_value: num(r.s_value), s_units: num(r.s_units), t_value: num(r.t_value), t_units: num(r.t_units),
})

/** True when the function answered with rows but none carries a territory name (an old copy of the function, or a stale schema cache). */
export const territoryMissing = (rows: EmpRow[]): boolean => rows.length > 0 && rows.every((r) => !(r.territory_names ?? '').trim())

/* ------------------------------ paging ------------------------------ */
/** Reads pages of `pageSize` rows (from, to inclusive) until a page comes back short. PostgREST returns at most 1,000 rows per request. */
export async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<T[]>, pageSize = PAGE_SIZE): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += pageSize) {
    const rows = await fetchPage(from, from + pageSize - 1)
    out.push(...rows)
    if (rows.length < pageSize) return out
  }
}

/** p_products: null (all products) when nothing or everything is selected, else the sorted ids. */
export function productParam(selected: Iterable<number>, allIds: number[]): number[] | null {
  const sel = [...new Set(selected)].filter((id) => allIds.includes(id)).sort((a, b) => a - b)
  return sel.length === 0 || sel.length === new Set(allIds).size ? null : sel
}

/* ------------------------------ months and quick picks ------------------------------ */
const pad = (n: number) => String(n).padStart(2, '0')
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthIso = (y: number, m: number): string => `${y}-${pad(m)}-01`
/** 'Jul 26'. */
export const monthShort = (m: string): string => (/^\d{4}-\d{2}/.test(m) ? `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}` : '')
export const monthLong = (m: string): string => (/^\d{4}-\d{2}/.test(m) ? `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : '')
/** The loaded months (YYYY-MM-01) from `from` to `to`, both included, ascending. */
export const monthsInRange = (loaded: string[], from: string, to: string): string[] => [...new Set(loaded)].filter((m) => m >= from && m <= to).sort()

export type QuickKind = 'quarter' | 'semester' | 'ytd'
/** Calendar months of a quick pick: 'YYYY-Q1'..'Q4' (3 months), 'YYYY-S1' (Jan-Jun) / 'S2' (Jul-Dec), 'YYYY-YTD' (Jan to the latest loaded month of the year). */
export function quickMonths(id: string, loaded: string[]): string[] {
  const y = Number(id.slice(0, 4))
  const q = /^\d{4}-Q([1-4])$/.exec(id)
  if (q) return [0, 1, 2].map((i) => monthIso(y, (Number(q[1]) - 1) * 3 + 1 + i))
  const s = /^\d{4}-S([12])$/.exec(id)
  if (s) return Array.from({ length: 6 }, (_, i) => monthIso(y, (Number(s[1]) - 1) * 6 + 1 + i))
  if (/^\d{4}-YTD$/.test(id)) {
    const last = loaded.filter((m) => m.startsWith(`${y}-`)).sort().pop()
    return last ? Array.from({ length: Number(last.slice(5, 7)) }, (_, i) => monthIso(y, i + 1)) : []
  }
  return []
}
export interface QuickPick { from: string; to: string; shown: number; total: number; incomplete: boolean }
/** A quarter / semester / YTD limits itself to the loaded months: from / to are the first and last loaded month, shown of total = months loaded of the period. */
export function quickPick(id: string, loaded: string[]): QuickPick | null {
  const cal = quickMonths(id, loaded)
  const have = cal.filter((m) => loaded.includes(m)).sort()
  if (have.length === 0) return null
  return { from: have[0], to: have[have.length - 1], shown: have.length, total: cal.length, incomplete: have.length < cal.length }
}
export const quickLabel = (id: string): string => { const y = id.slice(0, 4); const p = id.slice(5); return p === 'YTD' ? `YTD ${y}` : `${p} ${y}` }
/** The quick picks that have at least one loaded month, newest first. */
export function quickOptions(kind: QuickKind, loaded: string[]): { id: string; label: string }[] {
  const ids = new Set<string>()
  for (const m of loaded) {
    const y = m.slice(0, 4)
    const mi = Number(m.slice(5, 7))
    ids.add(kind === 'quarter' ? `${y}-Q${Math.ceil(mi / 3)}` : kind === 'semester' ? `${y}-S${mi <= 6 ? 1 : 2}` : `${y}-YTD`)
  }
  return [...ids].sort().reverse().map((id) => ({ id, label: quickLabel(id) }))
}
/** "Showing N of M months loaded" (only when incomplete). */
export const incompleteNote = (p: QuickPick | null): string => (p && p.incomplete ? `Showing ${p.shown} of ${p.total} months loaded` : '')

/* ------------------------------ tone ------------------------------ */
export type AchTone = 'red' | 'amber' | 'green' | 'none'
/** Same rule as the Sales tab: below 80 % red, 80 to 100 % amber, 100 % or more green. */
export function achTone(ach: number | null): AchTone { if (ach === null) return 'none'; const p = ach * 100; return p < 80 ? 'red' : p < 100 ? 'amber' : 'green' }
/** Ach % = all sales / target; no target -> null. */
export const achOf = (sales: number, target: number): number | null => (target > 0 ? sales / target : null)

/* ------------------------------ tree ------------------------------ */
/** vacant = one row per box (its territories are the children, kind vterr). */
export type Kind = 'company' | 'line' | 'manager' | 'rep' | 'vacant' | 'vterr'
export interface Cell { s: number; t: number }
export interface Node {
  id: string; kind: Kind; label: string; depth: number
  line: string; manager: string; rep: string; territory: string; box: string
  months: Map<string, Cell>; total: Cell; children: Node[]
  /** First month with sales of a rep that does not cover the whole period ('' otherwise). */
  since: string
}
const pick = (r: EmpRow, m: Metric): Cell => (m === 'value' ? { s: r.s_value, t: r.t_value } : { s: r.s_units, t: r.t_units })
const add = (a: Cell, b: Cell): Cell => ({ s: a.s + b.s, t: a.t + b.t })
const ZERO: Cell = { s: 0, t: 0 }
export const VACANT_MANAGER = 'Vacant manager'
/** Text from the database for display: &amp; / &lt; / &gt; / &quot; / &#39; decoded, ends trimmed, inner runs of spaces collapsed. */
export const cleanText = (v: string | null | undefined): string =>
  (v ?? '').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#0*39;/g, "'").replace(/\s+/g, ' ').trim()
/** For comparing two names: cleaned and lower case. */
export const normName = (v: string | null | undefined): string => cleanText(v).toLowerCase()
/** The name of a Vacant row: the TERRITORY (what makes the row unique); the box only when there is no territory; '(territory not set)' when both are empty. The VACANT pill is drawn by the page. */
export const vacantName = (territory: string | null | undefined, box: string | null | undefined): string => cleanText(territory) || cleanText(box) || '(territory not set)'
/** The box shown in gray after the territory: '' when the box is empty or is the same name as the territory (compared after normalising both). */
export const boxHint = (territory: string | null | undefined, box: string | null | undefined): string => (normName(box) !== '' && normName(box) !== normName(territory) ? cleanText(box) : '')
/** "(N territories)" / "(1 territory)". */
export const territoryCount = (n: number): string => `${n} ${n === 1 ? 'territory' : 'territories'}`
/** The text of a Vacant box row: "<Box> (N territories)". */
export const groupText = (n: Pick<Node, 'label' | 'children'>): string => `${n.label} (${territoryCount(n.children.length)})`
/** The full text of a row for the tooltip: "CIRA 2 · VACANT · Box Assuit (2 territories)", "CIRA 2 · VACANT · Assiut 2 · Box Assuit", "CIRA 2 · Rep Name · Box Assuit · Assiut 1, Assiut 2". */
export const fullLabel = (n: Pick<Node, 'kind' | 'label' | 'line' | 'territory' | 'box' | 'children'>): string =>
  (n.kind === 'vacant' ? [n.line, 'VACANT', groupText(n)]
    : n.kind === 'vterr' ? [n.line, 'VACANT', cleanText(n.territory) || n.label, boxHint(n.territory, n.box)]
    : n.kind === 'rep' ? [n.line, cleanText(n.label), cleanText(n.box), cleanText(n.territory)]
    : [n.line, cleanText(n.label)]).filter(Boolean).join(' · ')

function node(id: string, kind: Kind, label: string, depth: number, extra: Partial<Node> = {}): Node {
  return { id, kind, label, depth, line: '', manager: '', rep: '', territory: '', box: '', months: new Map(), total: { ...ZERO }, children: [], since: '', ...extra }
}
/** A parent's months and total are the sum of its children (never recomputed from the rows). */
function rollUp(n: Node): void {
  const months = new Map<string, Cell>()
  for (const c of n.children) for (const [m, v] of c.months) months.set(m, add(months.get(m) ?? ZERO, v))
  n.months = months
  n.total = [...months.values()].reduce(add, { ...ZERO })
}
const byTotalDesc = (a: Node, b: Node): number => b.total.s - a.total.s || a.label.localeCompare(b.label)

/**
 * Company > Line > Direct Manager > Medical Rep / Vacant box. `months` = the columns of the period. Order: lines by name, managers by total
 * descending, reps by total descending, then the Vacant rows (by total descending). A rep row keeps only the months in which the rep is
 * assigned (history stays on the Vacant row of the box).
 */
export function buildTree(rows: EmpRow[], months: string[], metric: Metric): Node {
  const inPeriod = new Set(months)
  const lines = new Map<string, { name: string; managers: Map<string, { name: string; leaves: Map<string, Node> }> }>()
  for (const r of rows) {
    if (!inPeriod.has(r.month)) continue
    const lk = String(r.line_id ?? 'x')
    const line = lines.get(lk) ?? { name: r.line_name ?? '-', managers: new Map() }
    lines.set(lk, line)
    const mk = String(r.manager_id ?? 'v')
    const mgr = line.managers.get(mk) ?? { name: r.manager_name ?? VACANT_MANAGER, leaves: new Map() }
    line.managers.set(mk, mgr)
    const isRep = r.rep_id !== null
    const key = isRep ? `r${r.rep_id}` : `v${r.territory_id ?? 'x'}`
    let leaf = mgr.leaves.get(key)
    if (!leaf) {
      leaf = node(`${lk}|${mk}|${key}`, isRep ? 'rep' : 'vterr', isRep ? (r.rep_name ?? `#${r.rep_id}`) : '', 3,
        { line: line.name, manager: mgr.name, rep: isRep ? (r.rep_name ?? '') : '', territory: '' })
      mgr.leaves.set(key, leaf)
    }
    const c = pick(r, metric)
    leaf.months.set(r.month, add(leaf.months.get(r.month) ?? ZERO, c))
    leaf.box = leaf.box || (r.box_name ?? '')
    const names = new Set([...(leaf.territory ? leaf.territory.split(', ') : []), ...(r.territory_names ? r.territory_names.split(', ') : []).map(cleanText).filter(Boolean)])
    leaf.territory = [...names].sort().join(', ')
    if (!isRep) leaf.label = vacantName(leaf.territory, null)
  }
  const company = node('company', 'company', 'Total Company', 0)
  for (const [lk, line] of [...lines].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    const ln = node(`l:${lk}`, 'line', `Total ${line.name}`, 1, { line: line.name })
    for (const [mk, mgr] of line.managers) {
      const mn = node(`m:${lk}|${mk}`, 'manager', `Total ${mgr.name}`, 2, { line: line.name, manager: mgr.name })
      const leaves = [...mgr.leaves.values()]
      for (const l of leaves) {
        l.total = [...l.months.values()].reduce(add, { ...ZERO })
        if (l.kind === 'rep') { const first = [...l.months].filter(([, v]) => v.s !== 0 || v.t !== 0).map(([m]) => m).sort()[0]; if (first && months.length > 0 && first > months[0]) l.since = first }
      }
      const groups = new Map<string, Node>()
      for (const l of leaves.filter((x) => x.kind === 'vterr')) {
        const gk = normName(l.box) || `t:${l.id}`
        let g = groups.get(gk)
        if (!g) { g = node(`${mn.id}|g:${gk}`, 'vacant', cleanText(l.box) || l.label, 3, { line: line.name, manager: mgr.name, box: cleanText(l.box) }); groups.set(gk, g) }
        l.depth = 4
        g.children.push(l)
      }
      for (const g of groups.values()) {
        g.children.sort(byTotalDesc)
        g.territory = g.children.map((c) => c.territory).filter(Boolean).join(', ')
        rollUp(g)
      }
      mn.children = [...leaves.filter((l) => l.kind === 'rep').sort(byTotalDesc), ...[...groups.values()].sort(byTotalDesc)]
      rollUp(mn)
      ln.children.push(mn)
    }
    ln.children.sort(byTotalDesc)
    rollUp(ln)
    company.children.push(ln)
  }
  rollUp(company)
  return company
}

/* ------------------------------ expand / collapse ------------------------------ */
/** Ids of the nodes that have children. */
export function expandableIds(root: Node): string[] {
  const out: string[] = []
  const walk = (n: Node) => { if (n.children.length > 0) { out.push(n.id); n.children.forEach(walk) } }
  walk(root)
  return out
}
/** Default: Company and the Lines are open (so the managers show), the managers are closed. */
export const defaultExpanded = (root: Node): Set<string> => new Set(['company', ...root.children.map((l) => l.id)])
export const expandAll = (root: Node): Set<string> => new Set(expandableIds(root))
/** Collapse all: only the Company stays open, so the three lines still show. */
export const collapseAll = (): Set<string> => new Set(['company'])
export interface FlatRow { node: Node; open: boolean; expandable: boolean }
/** The rows on screen, in order, for an expanded set. */
export function flatten(root: Node, expanded: Set<string>): FlatRow[] {
  const out: FlatRow[] = []
  const walk = (n: Node) => {
    const expandable = n.children.length > 0
    const open = expandable && expanded.has(n.id)
    out.push({ node: n, open, expandable })
    if (open) n.children.forEach(walk)
  }
  walk(root)
  return out
}

/* ------------------------------ figures ------------------------------ */
export interface Figures { total: number; target: number; ach: number | null; avg: number }
/** Total, target, Ach % (all sales / target) and the average per month of the period (`monthCount` columns). */
export const figures = (n: Pick<Node, 'total'>, monthCount: number): Figures => ({ total: n.total.s, target: n.total.t, ach: achOf(n.total.s, n.total.t), avg: monthCount > 0 ? n.total.s / monthCount : 0 })
export const fmtNum = (v: number): string => Math.round(v).toLocaleString('en-US')
export const fmtPct = (v: number | null): string => (v === null ? '-' : `${(v * 100).toFixed(1)}%`)
/** A month cell: "-" when the node has no rows that month. */
export const monthCell = (n: Pick<Node, 'months'>, m: string): string => { const c = n.months.get(m); return c ? fmtNum(c.s) : '-' }

/* ------------------------------ Excel ------------------------------ */
type XCell = string | number | null
export const exportFileName = (from: string, to: string): string => `Sales_by_Employee_${from.slice(0, 7)}_${to.slice(0, 7)}.xlsx`
const pct = (v: number | null): number | null => (v === null ? null : Math.round(v * 1000) / 10)
function figureCells(n: Node, months: string[]): Record<string, XCell> {
  const f = figures(n, months.length)
  return { ...Object.fromEntries(months.map((m) => [monthShort(m), n.months.has(m) ? Math.round(n.months.get(m)!.s) : null])), Total: Math.round(f.total), Target: Math.round(f.target), 'Ach %': pct(f.ach), 'Avg per month': Math.round(f.avg) }
}
/** The full hierarchy with indentation (two spaces per level), whatever is expanded on screen. */
export function hierarchyRows(root: Node, months: string[]): Record<string, XCell>[] {
  const out: Record<string, XCell>[] = []
  const walk = (n: Node) => { out.push({ Name: `${'  '.repeat(n.depth)}${n.kind === 'vacant' ? groupText(n) : n.label}`, Level: n.kind, Line: n.line, ...figureCells(n, months) }); n.children.forEach(walk) }
  walk(root)
  return out
}
/** One row per rep or Vacant territory: Line, Manager, Rep, Type (Rep / Vacant), Territory, Box, the months, Total, Target, Ach %. */
export function flatRows(root: Node, months: string[]): Record<string, XCell>[] {
  const out: Record<string, XCell>[] = []
  const walk = (n: Node) => {
    if (n.kind === 'rep' || n.kind === 'vterr') {
      const f = figureCells(n, months)
      out.push({ Line: n.line, Manager: n.manager, Rep: n.kind === 'rep' ? n.rep : '', Type: n.kind === 'rep' ? 'Rep' : 'Vacant', Territory: n.territory, Box: cleanText(n.box), ...f })
    }
    n.children.forEach(walk)
  }
  walk(root)
  return out
}

/* ------------------------------ KPI strip, heat and tooltip ------------------------------ */
export interface Kpis { sales: number; target: number; ach: number | null; vacant: number; vacantShare: number | null }
/** Company sales, target, Ach %, and the sales of the Vacant rows with their share of the total (they follow the filters: the tree is built from the filtered rows). */
export function kpis(root: Node): Kpis {
  let vacant = 0
  const walk = (n: Node) => { if (n.kind === 'vacant') { vacant += n.total.s; return } n.children.forEach(walk) }
  walk(root)
  return { sales: root.total.s, target: root.total.t, ach: achOf(root.total.s, root.total.t), vacant, vacantShare: root.total.s !== 0 ? vacant / root.total.s : null }
}
/** Light heat scale within a row: 0 (lowest month) to 1 (highest month); {} for total rows and rows with one value or all equal values. */
export function rowHeat(n: Pick<Node, 'kind' | 'months'>): Map<string, number> {
  const out = new Map<string, number>()
  if (n.kind !== 'rep' && n.kind !== 'vacant' && n.kind !== 'vterr') return out
  const vals = [...n.months.values()].map((c) => c.s)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  if (vals.length < 2 || hi === lo) return out
  for (const [m, c] of n.months) out.set(m, (c.s - lo) / (hi - lo))
  return out
}
/** Tooltip of a month cell: "Jul 2026: 1,234 (12.5% of the row total)". */
export function cellTitle(n: Pick<Node, 'months' | 'total'>, m: string): string {
  const c = n.months.get(m)
  if (!c) return `${monthLong(m)}: no sales`
  return `${monthLong(m)}: ${fmtNum(c.s)}${n.total.s !== 0 ? ` (${((c.s / n.total.s) * 100).toFixed(1)}% of the row total)` : ''}`
}
