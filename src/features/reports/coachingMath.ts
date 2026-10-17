/**
 * Coaching report helpers. The database functions (coaching_company_trend, coaching_skill_matrix, coaching_rep_summary,
 * coaching_rep_months, coaching_rep_visits, coaching_effect) return every score, change, gap and conflict flag. The
 * browser only maps, filters, sorts and formats them, and builds the visit-weighted totals / KPI figures the spec allows.
 * No imports: this file is also run directly by scripts/reportMath.test.mjs.
 */

export type EvalGroup = 'ALL' | 'TRAINING' | 'MANAGER'
export const EVAL_OPTIONS: { id: EvalGroup; label: string }[] = [
  { id: 'ALL', label: 'All' }, { id: 'TRAINING', label: 'Training' }, { id: 'MANAGER', label: 'Manager' },
]
export const EVAL_TIP = 'Training = Field Trainers + Training Manager'
export const DEFAULT_GAP = 0.5
export const COACH_TITLE = 'COACHING REPORT'
export const COACH_SUBTITLE = 'Rep skill scores (1-5), trend, weakest skills and evaluator agreement'
export const COACH_EMPTY_TEXT = 'No coaching data for this period. Upload the Coaching file.'
export const NO_EVAL = 'No evaluation'

/* ------------------------------------ rows ------------------------------------ */
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const n0 = (v: unknown): number => numOrNull(v) ?? 0
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const day = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v).slice(0, 10))

export interface TrendRow { month: string; visits: number; reps: number; avg_score: number | null; training_avg: number | null; manager_avg: number | null }
export function toTrendRow(r: Record<string, unknown>): TrendRow {
  return { month: day(r.month) ?? '', visits: n0(r.visits), reps: n0(r.reps), avg_score: numOrNull(r.avg_score), training_avg: numOrNull(r.training_avg), manager_avg: numOrNull(r.manager_avg) }
}
/** Months that actually have coaching visits, oldest first. */
export const monthsWithData = (rows: TrendRow[]): TrendRow[] => rows.filter((r) => r.visits > 0 && r.month !== '').sort((a, b) => a.month.localeCompare(b.month))

export type ScopeType = 'COMPANY' | 'LINE' | 'MANAGER' | 'REP'
export interface SkillRow { scope_type: ScopeType; scope_key: string; scope_name: string; skill_code: string; skill_name: string; sort: number; avg_score: number | null; n: number }
export function toSkillRow(r: Record<string, unknown>): SkillRow {
  const t = String(r.scope_type ?? '').toUpperCase()
  return {
    scope_type: (t === 'LINE' || t === 'MANAGER' || t === 'REP' ? t : 'COMPANY') as ScopeType,
    scope_key: String(r.scope_key ?? ''), scope_name: s(r.scope_name) ?? String(r.scope_key ?? ''),
    skill_code: String(r.skill_code ?? ''), skill_name: s(r.skill_name) ?? String(r.skill_code ?? ''),
    sort: n0(r.sort), avg_score: numOrNull(r.avg_score), n: n0(r.n),
  }
}

export interface RepSummary {
  rep_key: string; rep_id: number | null; rep_name: string; rep_code: string | null; line: string | null; manager: string | null
  visits: number; months_with_eval: number; avg_score: number | null; first_score: number | null; last_score: number | null
  change: number | null; slope_per_month: number | null; last_visit: string | null
  training_visits: number; training_avg: number | null; manager_visits: number; manager_avg: number | null
  gap: number | null; conflict: boolean
}
export function toRepSummary(r: Record<string, unknown>): RepSummary {
  const c = r.conflict
  return {
    rep_key: String(r.rep_key ?? ''), rep_id: numOrNull(r.rep_id), rep_name: s(r.rep_name) ?? String(r.rep_key ?? ''), rep_code: s(r.rep_code), line: s(r.line), manager: s(r.manager),
    visits: n0(r.visits), months_with_eval: n0(r.months_with_eval), avg_score: numOrNull(r.avg_score), first_score: numOrNull(r.first_score), last_score: numOrNull(r.last_score),
    change: numOrNull(r.change), slope_per_month: numOrNull(r.slope_per_month), last_visit: day(r.last_visit),
    training_visits: n0(r.training_visits), training_avg: numOrNull(r.training_avg), manager_visits: n0(r.manager_visits), manager_avg: numOrNull(r.manager_avg),
    gap: numOrNull(r.gap), conflict: c === true || c === 1 || c === 't' || c === 'true' || c === 'TRUE',
  }
}

export interface RepMonth { rep_key: string; rep_name: string; month: string; visits: number; avg_score: number | null; training_avg: number | null; manager_avg: number | null }
export function toRepMonth(r: Record<string, unknown>): RepMonth {
  return { rep_key: String(r.rep_key ?? ''), rep_name: s(r.rep_name) ?? '', month: day(r.month) ?? '', visits: n0(r.visits), avg_score: numOrNull(r.avg_score), training_avg: numOrNull(r.training_avg), manager_avg: numOrNull(r.manager_avg) }
}

export interface RepVisit { visit_id: string; visit_date: string | null; month: string; seq: number; evaluator: string | null; eval_group: string; avg_score: number | null; scores: Record<string, number> }
/** scores arrives as a json object ({"Q1": 3, ...}) or its text form. */
export function parseScores(v: unknown): Record<string, number> {
  let o: unknown = v
  if (typeof v === 'string') { try { o = JSON.parse(v) } catch { return {} } }
  if (o === null || typeof o !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [k, x] of Object.entries(o as Record<string, unknown>)) { const n = numOrNull(x); if (n !== null) out[k] = n }
  return out
}
export function toRepVisit(r: Record<string, unknown>): RepVisit {
  return {
    visit_id: String(r.visit_id ?? ''), visit_date: day(r.visit_date), month: day(r.month) ?? '', seq: n0(r.seq), evaluator: s(r.evaluator),
    eval_group: String(r.eval_group ?? '').toUpperCase(), avg_score: numOrNull(r.avg_score), scores: parseScores(r.scores),
  }
}
export const isTraining = (g: string): boolean => g.toUpperCase().startsWith('TRAIN')

export interface EffectRow { band: string; reps: number; avg_visits: number | null; avg_first: number | null; avg_last: number | null; avg_change: number | null; pct_improved: number | null }
export function toEffectRow(r: Record<string, unknown>): EffectRow {
  return { band: String(r.band ?? ''), reps: n0(r.reps), avg_visits: numOrNull(r.avg_visits), avg_first: numOrNull(r.avg_first), avg_last: numOrNull(r.avg_last), avg_change: numOrNull(r.avg_change), pct_improved: numOrNull(r.pct_improved) }
}
/** pct_improved is a share; if it ever arrives as 0..100 (any value above 1) bring it to 0..1. */
export function normalizeEffect(rows: EffectRow[]): EffectRow[] {
  const max = rows.reduce((a, r) => Math.max(a, r.pct_improved ?? 0), 0)
  return max > 1.0000001 ? rows.map((r) => ({ ...r, pct_improved: r.pct_improved === null ? null : r.pct_improved / 100 })) : rows
}

/* ------------------------------------ formats ------------------------------------ */
export const fmtScore = (v: number | null): string => (v === null ? '—' : v.toFixed(2))
export const fmtInt = (v: number): string => Math.round(v).toLocaleString('en-US')
export const fmtSigned = (v: number | null, d = 2): string => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`)
export const fmtShare = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(0)}%`)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** '2026-09-01' -> 'Sep 2026' */
export function monthName(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  return mo >= 1 && mo <= 12 ? `${MON[mo - 1]} ${y}` : m
}
export const monthShort = (m: string): string => { const [y, mo] = m.split('-').map(Number); return `${MON[mo - 1] ?? '?'} ${String(y).slice(2)}` }
export function fmtDay(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  return m ? `${m[3]}-${MON[Number(m[2]) - 1] ?? '???'}-${m[1]}` : '—'
}

/** Every month start from `from` to `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while ((y < ty || (y === ty && m <= tm)) && out.length < 240) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}
/** Default period: January of the first month with data -> the latest month with data. */
export function defaultPeriod(rows: TrendRow[]): { from: string; to: string } | null {
  const ms = monthsWithData(rows)
  if (ms.length === 0) return null
  return { from: `${ms[0].month.slice(0, 4)}-01-01`, to: ms[ms.length - 1].month }
}

/* ------------------------------------ KPIs / totals ------------------------------------ */
const wavg = (items: { v: number | null; w: number }[]): number | null => {
  let sum = 0
  let w = 0
  for (const i of items) if (i.v !== null && i.w > 0) { sum += i.v * i.w; w += i.w }
  return w > 0 ? sum / w : null
}

export interface CoachKpis { avg: number | null; visits: number; repsCoached: number; pctImproving: number | null; improving: number; eligible: number }
export function coachKpis(reps: RepSummary[]): CoachKpis {
  const coached = reps.filter((r) => r.visits > 0)
  const eligible = coached.filter((r) => r.visits >= 2 && r.change !== null)
  const improving = eligible.filter((r) => (r.change as number) > 0).length
  return {
    avg: wavg(coached.map((r) => ({ v: r.avg_score, w: r.visits }))), visits: coached.reduce((a, r) => a + r.visits, 0), repsCoached: coached.length,
    pctImproving: eligible.length > 0 ? improving / eligible.length : null, improving, eligible: eligible.length,
  }
}

/** Weakest company skill (lowest average among the COMPANY rows). */
export function weakestCompanySkill(rows: SkillRow[]): { name: string; score: number } | null {
  const c = rows.filter((r) => r.scope_type === 'COMPANY' && r.avg_score !== null).sort((a, b) => (a.avg_score as number) - (b.avg_score as number) || a.sort - b.sort)[0]
  return c ? { name: c.skill_name, score: c.avg_score as number } : null
}

/** Pinned totals row, weighted by visits (training / manager averages by their own visit counts). */
export function totalReps(reps: RepSummary[]): RepSummary {
  const c = reps.filter((r) => r.visits > 0)
  const training = wavg(c.map((r) => ({ v: r.training_avg, w: r.training_visits })))
  const manager = wavg(c.map((r) => ({ v: r.manager_avg, w: r.manager_visits })))
  return {
    rep_key: '', rep_id: null, rep_name: `TOTAL  (${c.length} reps coached)`, rep_code: null, line: null, manager: null,
    visits: c.reduce((a, r) => a + r.visits, 0), months_with_eval: 0,
    avg_score: wavg(c.map((r) => ({ v: r.avg_score, w: r.visits }))),
    first_score: wavg(c.map((r) => ({ v: r.first_score, w: r.visits }))), last_score: wavg(c.map((r) => ({ v: r.last_score, w: r.visits }))),
    change: wavg(c.map((r) => ({ v: r.change, w: r.visits }))), slope_per_month: null, last_visit: null,
    training_visits: c.reduce((a, r) => a + r.training_visits, 0), training_avg: training,
    manager_visits: c.reduce((a, r) => a + r.manager_visits, 0), manager_avg: manager,
    gap: training !== null && manager !== null ? training - manager : null,
    conflict: false,
  }
}

/* ------------------------------------ filters / sort ------------------------------------ */
export interface RepFilters { line: string | null; manager: string; search: string }
export function filterReps(rows: RepSummary[], f: RepFilters): RepSummary[] {
  const q = f.search.trim().toLowerCase()
  return rows.filter(
    (r) => (f.line === null || r.line === f.line) && (f.manager === '' || r.manager === f.manager) &&
      (q === '' || [r.rep_name, r.rep_code].some((v) => v !== null && v.toLowerCase().includes(q))),
  )
}
export function repManagers(rows: RepSummary[], line: string | null): string[] {
  return [...new Set(rows.filter((r) => line === null || r.line === line).flatMap((r) => (r.manager ? [r.manager] : [])))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }))
}

export type RepColId = 'rep' | 'line' | 'manager' | 'visits' | 'months' | 'first' | 'last' | 'change' | 'trend' | 'training' | 'managerAvg' | 'gap' | 'conflict'
export interface RepColDef { id: RepColId; header: string; numeric: boolean; sortable: boolean; tip?: string }
export const REP_COLS: RepColDef[] = [
  { id: 'rep', header: 'Rep', numeric: false, sortable: true },
  { id: 'line', header: 'Line', numeric: false, sortable: true },
  { id: 'manager', header: 'Manager', numeric: false, sortable: true },
  { id: 'visits', header: 'Coaching visits', numeric: true, sortable: true },
  { id: 'months', header: 'Months evaluated', numeric: true, sortable: true },
  { id: 'first', header: 'First', numeric: true, sortable: true, tip: 'Average score of the first evaluated month' },
  { id: 'last', header: 'Last', numeric: true, sortable: true, tip: 'Average score of the last evaluated month' },
  { id: 'change', header: 'Change', numeric: true, sortable: true, tip: 'Last − First' },
  { id: 'trend', header: 'Trend', numeric: false, sortable: false, tip: 'Monthly average score; a gap means no evaluation that month' },
  { id: 'training', header: 'Training avg', numeric: true, sortable: true },
  { id: 'managerAvg', header: 'Manager avg', numeric: true, sortable: true },
  { id: 'gap', header: 'Gap', numeric: true, sortable: true, tip: 'Training avg − Manager avg' },
  { id: 'conflict', header: 'Conflict', numeric: false, sortable: true },
]

export function repValue(id: RepColId, r: RepSummary): string | number | null {
  switch (id) {
    case 'rep': return r.rep_name
    case 'line': return r.line
    case 'manager': return r.manager
    case 'visits': return r.visits
    case 'months': return r.visits > 0 ? r.months_with_eval : null
    case 'first': return r.first_score
    case 'last': return r.last_score
    case 'change': return r.change
    case 'trend': return null
    case 'training': return r.training_avg
    case 'managerAvg': return r.manager_avg
    case 'gap': return r.gap === null ? null : Math.abs(r.gap)
    case 'conflict': return r.conflict ? 1 : 0
  }
}
export interface RepSort { id: RepColId; desc: boolean }
const cmp = (a: string | number | null, b: string | number | null, desc: boolean): number => {
  if (a === null && b === null) return 0
  if (a === null) return 1 // empty always last
  if (b === null) return -1
  const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' })
  return desc ? -c : c
}
/** Reps with no coaching in the period always sort last, whatever the column. */
export function sortReps(rows: RepSummary[], sort: RepSort): RepSummary[] {
  return [...rows].sort((a, b) => {
    if ((a.visits > 0) !== (b.visits > 0)) return a.visits > 0 ? -1 : 1
    return cmp(repValue(sort.id, a), repValue(sort.id, b), sort.desc) || a.rep_name.localeCompare(b.rep_name, 'en', { sensitivity: 'base' })
  })
}

/* ------------------------------------ conflict ------------------------------------ */
export const higherSide = (r: RepSummary): 'Training' | 'Manager' | null =>
  r.training_avg === null || r.manager_avg === null || r.training_avg === r.manager_avg ? null : r.training_avg > r.manager_avg ? 'Training' : 'Manager'

export interface ConflictSummary { conflicts: number; comparable: number; pct: number | null }
/** Comparable = reps with at least one Training and one Manager visit in the period. */
export function conflictSummary(rows: RepSummary[]): ConflictSummary {
  const comparable = rows.filter((r) => r.training_visits > 0 && r.manager_visits > 0)
  const conflicts = comparable.filter((r) => r.conflict).length
  return { conflicts, comparable: comparable.length, pct: comparable.length > 0 ? conflicts / comparable.length : null }
}

/* ------------------------------------ skills ------------------------------------ */
export interface WeakItem { name: string; score: number }
export interface WeakScope { scope_type: ScopeType; scope_key: string; scope_name: string; skills: WeakItem[] }

/** Lowest `n` skills of every scope of the given types (ties: skill order). */
export function weakestByScope(rows: SkillRow[], types: ScopeType[], n = 5): WeakScope[] {
  const m = new Map<string, SkillRow[]>()
  for (const r of rows) {
    if (!types.includes(r.scope_type) || r.avg_score === null) continue
    const k = `${r.scope_type}|${r.scope_key}`
    const a = m.get(k)
    if (a) a.push(r)
    else m.set(k, [r])
  }
  const order = (t: ScopeType) => types.indexOf(t)
  return [...m.values()]
    .map((a) => ({
      scope_type: a[0].scope_type, scope_key: a[0].scope_key, scope_name: a[0].scope_name,
      skills: [...a].sort((x, y) => (x.avg_score as number) - (y.avg_score as number) || x.sort - y.sort).slice(0, n).map((x) => ({ name: x.skill_name, score: x.avg_score as number })),
    }))
    .sort((a, b) => order(a.scope_type) - order(b.scope_type) || a.scope_name.localeCompare(b.scope_name, 'en', { numeric: true, sensitivity: 'base' }))
}

export interface ScopeOption { key: string; name: string }
export function scopeOptions(rows: SkillRow[], type: ScopeType, search: string): ScopeOption[] {
  const q = search.trim().toLowerCase()
  const m = new Map<string, string>()
  for (const r of rows) if (r.scope_type === type && !m.has(r.scope_key)) m.set(r.scope_key, r.scope_name)
  return [...m].map(([key, name]) => ({ key, name })).filter((o) => q === '' || o.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }))
}

export interface SkillBar { code: string; name: string; score: number | null; n: number; company: number | null; weak: boolean }
/** The 15 skills of one scope, ascending by score; the lowest `weakCount` are flagged; company average per skill for the marker. */
export function skillBars(rows: SkillRow[], type: ScopeType, key: string, weakCount = 5): SkillBar[] {
  const company = new Map<string, number>()
  for (const r of rows) if (r.scope_type === 'COMPANY' && r.avg_score !== null) company.set(r.skill_code, r.avg_score)
  const own = rows.filter((r) => r.scope_type === type && (type === 'COMPANY' || r.scope_key === key))
  const sorted = [...own].sort((a, b) => (a.avg_score === null ? 1 : b.avg_score === null ? -1 : a.avg_score - b.avg_score) || a.sort - b.sort)
  const scored = sorted.filter((r) => r.avg_score !== null).length
  return sorted.map((r, i) => ({ code: r.skill_code, name: r.skill_name, score: r.avg_score, n: r.n, company: company.get(r.skill_code) ?? null, weak: r.avg_score !== null && i < Math.min(weakCount, scored) }))
}

/** code -> name, in the questionnaire order (from the COMPANY rows). */
export function skillCatalog(rows: SkillRow[]): { code: string; name: string }[] {
  const m = new Map<string, { code: string; name: string; sort: number }>()
  for (const r of rows) if (!m.has(r.skill_code)) m.set(r.skill_code, { code: r.skill_code, name: r.skill_name, sort: r.sort })
  return [...m.values()].sort((a, b) => a.sort - b.sort).map(({ code, name }) => ({ code, name }))
}

/* ------------------------------------ sparkline / month grid ------------------------------------ */
export interface SparkPoint { x: number; y: number }
/** Monthly scores (1-5) over `months`, as separate runs: a month without an evaluation breaks the line. */
export function sparkRuns(months: string[], byMonth: Map<string, number | null>, w: number, h: number, pad = 3): { runs: SparkPoint[][]; points: number } {
  const runs: SparkPoint[][] = []
  let cur: SparkPoint[] = []
  let points = 0
  const step = months.length > 1 ? (w - 2 * pad) / (months.length - 1) : 0
  months.forEach((m, i) => {
    const v = byMonth.get(m) ?? null
    if (v === null) { if (cur.length) runs.push(cur); cur = []; return }
    const y = h - pad - ((Math.min(5, Math.max(1, v)) - 1) / 4) * (h - 2 * pad)
    cur.push({ x: months.length > 1 ? pad + i * step : w / 2, y })
    points++
  })
  if (cur.length) runs.push(cur)
  return { runs, points }
}

export interface MonthCell { month: string; score: number | null; visits: number }
export function monthGrid(months: string[], rows: RepMonth[]): MonthCell[] {
  const m = new Map(rows.map((r) => [r.month, r]))
  return months.map((month) => { const r = m.get(month); return { month, score: r ? r.avg_score : null, visits: r ? r.visits : 0 } })
}
export function groupRepMonths(rows: RepMonth[]): Map<string, RepMonth[]> {
  const m = new Map<string, RepMonth[]>()
  for (const r of rows) { const a = m.get(r.rep_key); if (a) a.push(r); else m.set(r.rep_key, [r]) }
  return m
}
