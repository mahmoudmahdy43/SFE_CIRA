/**
 * Manager Coverage report helpers. The database functions `manager_coverage`, `manager_coverage_spec` and
 * `manager_coverage_doctors` return every per-row number (coverage_pct, share_pct, ...). The browser only maps,
 * filters, groups, sorts and formats them, and builds the totals the spec allows: SUM(covered) / SUM(list), never an
 * average of percentages.
 * No imports: this file is also run directly by scripts/reportMath.test.mjs.
 */

/* ------------------------------------ palette (same colours as Manager Joint Days) ------------------------------------ */
export const CPAL = {
  navy: '#20293A', slate: '#39465C', white: '#FFFFFF',
  green: '#1B7A45', greenBody: '#EAF7EE',
  red: '#B81F27', redBody: '#FDEDED',
  teal: '#2C7E6E', tealBody: '#E9F6F2',
  totalBody: '#F4F6F8', grey: '#667085', zebra: '#F4F6F8', rowLine: '#D5D9DE', beige: '#D8D3C4',
  barFrom: '#7DC99B', barTo: '#1B7A45', topBody: '#FFF6D6', subBody: '#E7EBF0',
} as const

export const COVER_TITLE = 'MANAGER COVERAGE REPORT'
export const COVER_SUBTITLE = 'Does the manager visit the rep\'s real active list?  —  Coaching quality, by rep and speciality'
export const COVER_EMPTY_TITLE = 'No coverage data for this period'
export const COVER_EMPTY_TEXT = 'No coverage data for this period. Run refresh_manager_cover for these months.'
export const COVER_FOOTER =
  'Coverage % = list doctors visited by the manager with the rep ÷ the rep\'s active list doctors (a total is SUM covered ÷ SUM list, not an average of percentages). Repeat doctors = covered doctors the manager visited more than once. Off-list doctors = visited with the rep but not on the active list. Share % = the speciality\'s part of the doctors the manager covered with that rep.'

/* ------------------------------------ rows ------------------------------------ */
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const n0 = (v: unknown): number => numOrNull(v) ?? 0
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

export interface CoverRow {
  manager_id: number | null
  manager: string | null
  rep_id: number
  rep_name: string | null
  rep_code: string | null
  line: string | null
  box: string | null
  list_doctors: number
  covered_doctors: number
  /** 0..1; null when the rep has no active list. */
  coverage_pct: number | null
  repeat_doctors: number
  joint_visits: number
  offlist_doctors: number
  offlist_visits: number
}

export function toCoverRow(r: Record<string, unknown>): CoverRow {
  return {
    manager_id: numOrNull(r.manager_id), manager: s(r.manager),
    rep_id: n0(r.rep_id), rep_name: s(r.rep_name), rep_code: s(r.rep_code), line: s(r.line), box: s(r.box),
    list_doctors: n0(r.list_doctors), covered_doctors: n0(r.covered_doctors), coverage_pct: numOrNull(r.coverage_pct),
    repeat_doctors: n0(r.repeat_doctors), joint_visits: n0(r.joint_visits),
    offlist_doctors: n0(r.offlist_doctors), offlist_visits: n0(r.offlist_visits),
  }
}

export interface SpecRow {
  manager_id: number | null
  manager: string | null
  rep_id: number
  rep_name: string | null
  speciality: string
  list_doctors: number
  covered_doctors: number
  coverage_pct: number | null
  /** 0..1 */
  share_pct: number | null
  joint_visits: number
}

export function toSpecRow(r: Record<string, unknown>): SpecRow {
  return {
    manager_id: numOrNull(r.manager_id), manager: s(r.manager), rep_id: n0(r.rep_id), rep_name: s(r.rep_name),
    speciality: s(r.speciality) ?? '(no speciality)',
    list_doctors: n0(r.list_doctors), covered_doctors: n0(r.covered_doctors),
    coverage_pct: numOrNull(r.coverage_pct), share_pct: numOrNull(r.share_pct), joint_visits: n0(r.joint_visits),
  }
}

/** The functions document coverage_pct as 0..1; if share_pct ever arrives as 0..100 (any value above 1), bring it to 0..1. */
export function normalizeShares(rows: SpecRow[]): SpecRow[] {
  const max = rows.reduce((a, r) => Math.max(a, r.share_pct ?? 0), 0)
  return max > 1.0000001 ? rows.map((r) => ({ ...r, share_pct: r.share_pct === null ? null : r.share_pct / 100 })) : rows
}

export interface DocRow {
  doctor_id: number
  doctor_name: string
  account_name: string | null
  speciality: string | null
  class: string | null
  freq: number | null
  joint_visits: number
  covered: boolean
}

export function toDocRow(r: Record<string, unknown>): DocRow {
  const c = r.covered
  return {
    doctor_id: n0(r.doctor_id), doctor_name: String(r.doctor_name ?? ''), account_name: s(r.account_name), speciality: s(r.speciality),
    class: s(r.class), freq: numOrNull(r.freq), joint_visits: n0(r.joint_visits),
    covered: c === true || c === 1 || c === 't' || c === 'true' || c === 'TRUE',
  }
}

const cmpText = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

/** Not covered first, then class A / B / C (others last), then name. */
export function orderDoctors(rows: DocRow[]): DocRow[] {
  const rank = (c: string | null) => { const i = ['A', 'B', 'C'].indexOf((c ?? '').trim().toUpperCase()); return i < 0 ? 3 : i }
  return [...rows].sort((a, b) => Number(a.covered) - Number(b.covered) || rank(a.class) - rank(b.class) || cmpText(a.doctor_name, b.doctor_name))
}

export const pairKey = (r: { manager_id: number | null; rep_id: number }): string => `${r.manager_id ?? ''}|${r.rep_id}`

/* ------------------------------------ period ------------------------------------ */
export type PeriodMode = 'month' | 'quarter' | 'semester' | 'ytd'
export const PERIODS: { id: PeriodMode; label: string }[] = [
  { id: 'month', label: 'Month' }, { id: 'quarter', label: 'Quarter' }, { id: 'semester', label: 'Semester' }, { id: 'ytd', label: 'YTD' },
]
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `to` = first day of the picked month (YYYY-MM-01). Returns p_from / p_to as month-start ISO dates. */
export function periodRange(mode: PeriodMode, to: string): { from: string; to: string } {
  const [y, m] = to.split('-').map(Number)
  const first = mode === 'month' ? m : mode === 'quarter' ? Math.floor((m - 1) / 3) * 3 + 1 : mode === 'semester' ? (m <= 6 ? 1 : 7) : 1
  return { from: `${y}-${String(first).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-01` }
}

/** 'Sep 2026' for one month, 'Jul - Sep 2026' for a range. */
export function periodText(from: string, to: string): string {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  if (fy === ty && fm === tm) return `${MON[tm - 1]} ${ty}`
  return fy === ty ? `${MON[fm - 1]} - ${MON[tm - 1]} ${ty}` : `${MON[fm - 1]} ${fy} - ${MON[tm - 1]} ${ty}`
}

/* ------------------------------------ shift ------------------------------------ */
/** Passed to the database functions as p_shift. Pharmacies are excluded by the database in every case. */
export type CoverShift = 'ALL' | 'AM' | 'PM'
export const SHIFT_OPTIONS: { id: CoverShift; label: string }[] = [{ id: 'ALL', label: 'All' }, { id: 'AM', label: 'AM' }, { id: 'PM', label: 'PM' }]
export const shiftText = (s: CoverShift): string => (s === 'ALL' ? 'All shifts' : `${s} shift`)

/* ------------------------------------ filters ------------------------------------ */
export interface CoverFilters { line: string | null; manager: string; search: string }

export function filterCover(rows: CoverRow[], f: CoverFilters): CoverRow[] {
  const q = f.search.trim().toLowerCase()
  return rows.filter(
    (r) =>
      (f.line === null || r.line === f.line) &&
      (f.manager === '' || r.manager === f.manager) &&
      (q === '' || [r.rep_name, r.rep_code].some((v) => v !== null && v.toLowerCase().includes(q))),
  )
}

export function coverManagers(rows: CoverRow[], line: string | null): string[] {
  return [...new Set(rows.filter((r) => line === null || r.line === line).flatMap((r) => (r.manager ? [r.manager] : [])))].sort(cmpText)
}

/* ------------------------------------ totals / cards ------------------------------------ */
export interface CoverTotal {
  reps: number
  list_doctors: number
  covered_doctors: number
  /** SUM(covered) / SUM(list); null when the list sums to 0. */
  coverage_pct: number | null
  repeat_doctors: number
  joint_visits: number
  offlist_doctors: number
  offlist_visits: number
  zero_pairs: number
}

export function sumCover(rows: CoverRow[]): CoverTotal {
  const sum = (k: 'list_doctors' | 'covered_doctors' | 'repeat_doctors' | 'joint_visits' | 'offlist_doctors' | 'offlist_visits') => rows.reduce((a, r) => a + r[k], 0)
  const list = sum('list_doctors')
  const covered = sum('covered_doctors')
  return {
    reps: rows.length, list_doctors: list, covered_doctors: covered, coverage_pct: list > 0 ? covered / list : null,
    repeat_doctors: sum('repeat_doctors'), joint_visits: sum('joint_visits'),
    offlist_doctors: sum('offlist_doctors'), offlist_visits: sum('offlist_visits'),
    zero_pairs: rows.filter((r) => r.coverage_pct === 0).length,
  }
}

export const fmtPct = (v: number | null): string => (v === null ? '-' : `${(v * 100).toFixed(1)}%`)
export const fmtNum = (v: number): string => Math.round(v).toLocaleString('en-US')

export interface CoverCard { id: string; title: string; head: string; body: string; num: string; value: string; caption: string }

export function coverCards(t: CoverTotal): CoverCard[] {
  return [
    { id: 'avg', title: 'AVERAGE COVERAGE', head: CPAL.green, body: CPAL.greenBody, num: CPAL.green, value: fmtPct(t.coverage_pct), caption: `${fmtNum(t.covered_doctors)} of ${fmtNum(t.list_doctors)} list doctors covered` },
    { id: 'zero', title: 'PAIRS WITH 0% COVERAGE', head: CPAL.red, body: CPAL.redBody, num: CPAL.red, value: fmtNum(t.zero_pairs), caption: `of ${fmtNum(t.reps)} manager-rep pairs` },
    { id: 'joint', title: 'JOINT VISITS', head: CPAL.teal, body: CPAL.tealBody, num: CPAL.teal, value: fmtNum(t.joint_visits), caption: `${fmtNum(t.repeat_doctors)} doctors visited more than once` },
    { id: 'off', title: 'OFF-LIST DOCTORS VISITED', head: CPAL.navy, body: CPAL.totalBody, num: CPAL.navy, value: fmtNum(t.offlist_doctors), caption: `${fmtNum(t.offlist_visits)} visits to doctors outside the active list` },
  ]
}

/* ------------------------------------ speciality lookups ------------------------------------ */
/** Speciality rows of each manager x rep, share desc (then joint visits desc, then name). */
export function groupSpec(rows: SpecRow[]): Map<string, SpecRow[]> {
  const m = new Map<string, SpecRow[]>()
  for (const r of rows) {
    const k = pairKey(r)
    const a = m.get(k)
    if (a) a.push(r)
    else m.set(k, [r])
  }
  for (const a of m.values()) a.sort((x, y) => (y.share_pct ?? -1) - (x.share_pct ?? -1) || y.joint_visits - x.joint_visits || cmpText(x.speciality, y.speciality))
  return m
}

export interface TopSpec { speciality: string; share: number }
/** Top speciality of a pair = the one with the highest share among those the manager actually covered. */
export function topSpeciality(spec: SpecRow[] | undefined): TopSpec | null {
  const t = spec?.find((x) => x.covered_doctors > 0 && x.share_pct !== null)
  return t && t.share_pct !== null ? { speciality: t.speciality, share: t.share_pct } : null
}

/* ------------------------------------ columns / sort / grouping ------------------------------------ */
export type ColId = 'rep' | 'box' | 'list' | 'covered' | 'pct' | 'repeat' | 'joint' | 'offlist' | 'top'
export interface CoverColDef { id: ColId; header: string; numeric: boolean; tip?: string }
export const COVER_COLS: CoverColDef[] = [
  { id: 'rep', header: 'Rep', numeric: false },
  { id: 'box', header: 'Box', numeric: false },
  { id: 'list', header: 'List doctors', numeric: true, tip: 'Doctors on the rep\'s active list' },
  { id: 'covered', header: 'Covered', numeric: true, tip: 'List doctors the manager visited with the rep' },
  { id: 'pct', header: 'Coverage %', numeric: true, tip: 'Covered ÷ list doctors' },
  { id: 'repeat', header: 'Repeat doctors', numeric: true, tip: 'Covered doctors visited more than once by the manager' },
  { id: 'joint', header: 'Joint visits', numeric: true },
  { id: 'offlist', header: 'Off-list doctors', numeric: true, tip: 'Doctors visited with the rep that are not on the active list' },
  { id: 'top', header: 'Top speciality', numeric: true, tip: 'Speciality with the largest share of the doctors the manager covered with this rep' },
]

/** Header tooltip; under AM / PM the list size (denominator) stays the whole active list, so say what the % means. */
export function colTip(c: CoverColDef, shift: CoverShift): string | undefined {
  if (shift === 'ALL') return c.tip
  if (c.id === 'pct') return `% of the whole active list that the manager visited with the rep in the ${shift} shift. The list size does not change with the shift.`
  if (c.id === 'list') return 'Doctors on the rep\'s active list (the same under every shift)'
  if (c.id === 'covered') return `List doctors the manager visited with the rep in the ${shift} shift`
  return c.tip
}

export function colValue(id: ColId, r: CoverRow, top: TopSpec | null): string | number | null {
  switch (id) {
    case 'rep': return r.rep_name
    case 'box': return r.box
    case 'list': return r.list_doctors
    case 'covered': return r.covered_doctors
    case 'pct': return r.coverage_pct
    case 'repeat': return r.repeat_doctors
    case 'joint': return r.joint_visits
    case 'offlist': return r.offlist_doctors
    case 'top': return top ? top.share : null
  }
}

export interface SortState { id: ColId; desc: boolean }
const compare = (a: string | number | null, b: string | number | null, desc: boolean): number => {
  if (a === null && b === null) return 0
  if (a === null) return 1 // null always last
  if (b === null) return -1
  const c = typeof a === 'number' && typeof b === 'number' ? a - b : cmpText(String(a), String(b))
  return desc ? -c : c
}

export interface ManagerGroup { manager: string; reps: CoverRow[]; total: CoverTotal }
export interface LineGroup { line: string; managers: ManagerGroup[]; total: CoverTotal }

/** Line -> Manager -> reps (sorted by `sort` inside each manager; lines and managers A-Z), with weighted subtotals. */
export function groupCover(rows: CoverRow[], top: Map<string, TopSpec | null>, sort: SortState): LineGroup[] {
  const lines = new Map<string, Map<string, CoverRow[]>>()
  for (const r of rows) {
    const l = r.line ?? '(no line)'
    const m = r.manager ?? '(no manager)'
    if (!lines.has(l)) lines.set(l, new Map())
    const mm = lines.get(l)!
    if (!mm.has(m)) mm.set(m, [])
    mm.get(m)!.push(r)
  }
  return [...lines.keys()].sort(cmpText).map((line) => {
    const mm = lines.get(line)!
    const managers = [...mm.keys()].sort(cmpText).map((manager) => {
      const reps = [...mm.get(manager)!].sort(
        (a, b) => compare(colValue(sort.id, a, top.get(pairKey(a)) ?? null), colValue(sort.id, b, top.get(pairKey(b)) ?? null), sort.desc) || cmpText(a.rep_name, b.rep_name),
      )
      return { manager, reps, total: sumCover(reps) }
    })
    return { line, managers, total: sumCover(managers.flatMap((g) => g.reps)) }
  })
}

/** Flat list in screen order (for the Excel export). */
export const flattenGroups = (groups: LineGroup[]): CoverRow[] => groups.flatMap((l) => l.managers.flatMap((m) => m.reps))

/* ------------------------------------ Excel (same look as Manager Joint Days) ------------------------------------ */
export interface GridCell { v: string | number | null; s?: Record<string, unknown>; z?: string }
export interface Grid {
  name: string
  cells: GridCell[][]
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[]
  widths: number[]
  heights: (number | undefined)[]
}

const rgb = (hex: string) => hex.replace('#', '')
const style = (bg: string | null, color: string, x: { bold?: boolean; italic?: boolean; sz?: number; h?: 'left' | 'center' | 'right'; wrap?: boolean; border?: boolean } = {}) => ({
  ...(bg ? { fill: { patternType: 'solid', fgColor: { rgb: rgb(bg) } } } : {}),
  font: { name: 'Calibri', color: { rgb: rgb(color) }, bold: !!x.bold, italic: !!x.italic, sz: x.sz ?? 10 },
  alignment: { horizontal: x.h ?? 'center', vertical: 'center', wrapText: !!x.wrap },
  ...(x.border ? { border: { bottom: { style: 'thin', color: { rgb: rgb(CPAL.rowLine) } } } } : {}),
})

/** Title band, period band, KPI strip and a body builder shared by both sheets; returns the next free row. */
function bands(n: number, periodLine: string, cards: CoverCard[] | null) {
  const cells: GridCell[][] = []
  const merges: Grid['merges'] = []
  const heights: (number | undefined)[] = []
  const blank = (): GridCell[] => Array.from({ length: n }, () => ({ v: null }))
  const push = (parts: { c0: number; c1: number; v: string | number | null; st: Record<string, unknown> }[], h?: number) => {
    const row = blank()
    for (const p of parts) {
      row[p.c0] = { v: p.v, s: p.st }
      for (let c = p.c0 + 1; c <= p.c1; c++) row[c] = { v: null, s: p.st }
      if (p.c1 > p.c0) merges.push({ s: { r: cells.length, c: p.c0 }, e: { r: cells.length, c: p.c1 } })
    }
    cells.push(row)
    heights.push(h)
  }
  push([{ c0: 0, c1: n - 1, v: COVER_TITLE, st: style(CPAL.navy, CPAL.white, { bold: true, sz: 16 }) }], 30)
  push([{ c0: 0, c1: n - 1, v: COVER_SUBTITLE, st: style(null, CPAL.grey, { italic: true }) }], 18)
  push([{ c0: 0, c1: n - 1, v: periodLine, st: style(CPAL.green, CPAL.white, { bold: true }) }], 20)
  cells.push(blank()); heights.push(6)
  if (cards) {
    const base = Math.floor(n / 4)
    const rem = n % 4
    const spans: { c0: number; c1: number }[] = []
    let at = 0
    for (let i = 0; i < 4; i++) { const w = base + (i < rem ? 1 : 0); spans.push({ c0: at, c1: at + w - 1 }); at += w }
    push(cards.map((c, i) => ({ ...spans[i], v: c.title, st: style(c.head, CPAL.white, { bold: true }) })), 20)
    push(cards.map((c, i) => ({ ...spans[i], v: c.value, st: style(c.body, c.num, { bold: true, sz: 18 }) })), 32)
    push(cards.map((c, i) => ({ ...spans[i], v: c.caption, st: style(c.body, CPAL.grey, { italic: true, sz: 9 }) })), 16)
    push([{ c0: 0, c1: n - 1, v: null, st: style(CPAL.beige, CPAL.beige) }], 4)
  }
  return { cells, merges, heights, push, blank }
}

const HEAD = (h: string, wrap = true): GridCell => ({ v: h, s: style(CPAL.slate, CPAL.white, { bold: true, wrap }) })

/** Sheet 1: Line, Manager, Rep ... one row per rep, a bold subtotal row per manager, a navy Total row. */
export function buildCoverGrid(a: { groups: LineGroup[]; total: CoverTotal; periodLine: string; top: Map<string, TopSpec | null> }): Grid {
  const headers = ['Line', 'Manager', 'Rep', 'Rep code', 'Box', 'List doctors', 'Covered', 'Coverage %', 'Repeat doctors', 'Joint visits', 'Off-list doctors', 'Off-list visits', 'Top speciality', 'Top speciality share %']
  const n = headers.length
  const b = bands(n, a.periodLine, coverCards(a.total))
  b.cells.push(headers.map((h) => HEAD(h))); b.heights.push(34)
  let ri = 0
  const pct = (st: Record<string, unknown>, v: number | null): GridCell => (v === null ? { v: '-', s: st } : { v, s: st, z: '0.0%' })
  const nums = (st: Record<string, unknown>, t: { list_doctors: number; covered_doctors: number; coverage_pct: number | null; repeat_doctors: number; joint_visits: number; offlist_doctors: number; offlist_visits: number }): GridCell[] => [
    { v: t.list_doctors, s: st }, { v: t.covered_doctors, s: st }, pct(st, t.coverage_pct), { v: t.repeat_doctors, s: st }, { v: t.joint_visits, s: st },
    { v: t.offlist_doctors, s: st }, { v: t.offlist_visits, s: st },
  ]
  for (const l of a.groups) {
    for (const m of l.managers) {
      for (const r of m.reps) {
        const bg = ri++ % 2 === 1 ? CPAL.zebra : null
        const tx = style(bg, CPAL.navy, { h: 'left', border: true })
        const nm = style(bg, CPAL.navy, { bold: true, border: true })
        const top = a.top.get(pairKey(r)) ?? null
        b.cells.push([
          { v: l.line, s: tx }, { v: m.manager, s: tx }, { v: r.rep_name ?? '', s: tx }, { v: r.rep_code ?? '', s: tx }, { v: r.box ?? '', s: tx },
          ...nums(nm, r),
          { v: top ? top.speciality : '-', s: tx }, top ? { v: top.share, s: nm, z: '0.0%' } : { v: '-', s: nm },
        ])
        b.heights.push(20)
      }
      const sub = style(CPAL.subBody, CPAL.navy, { bold: true, h: 'left', border: true })
      const subn = style(CPAL.subBody, CPAL.navy, { bold: true, border: true })
      b.cells.push([
        { v: l.line, s: sub }, { v: m.manager, s: sub }, { v: `Subtotal  (${m.reps.length} ${m.reps.length === 1 ? 'rep' : 'reps'})`, s: sub }, { v: null, s: sub }, { v: null, s: sub },
        ...nums(subn, m.total), { v: null, s: sub }, { v: null, s: sub },
      ])
      b.heights.push(22)
    }
  }
  const tot = style(CPAL.navy, CPAL.white, { bold: true })
  b.cells.push([
    { v: 'TOTAL', s: { ...tot, alignment: { horizontal: 'left', vertical: 'center' } } }, { v: null, s: tot }, { v: `${a.total.reps} reps`, s: tot }, { v: null, s: tot }, { v: null, s: tot },
    ...nums(tot, a.total), { v: null, s: tot }, { v: null, s: tot },
  ])
  b.heights.push(24)
  b.cells.push(b.blank()); b.heights.push(6)
  b.push([{ c0: 0, c1: n - 1, v: COVER_FOOTER, st: style(null, CPAL.grey, { italic: true, sz: 9, h: 'left', wrap: true }) }], 40)
  return { name: 'Manager Coverage', cells: b.cells, merges: b.merges, heights: b.heights, widths: [14, 24, 26, 12, 18, 12, 11, 12, 12, 11, 12, 12, 24, 14] }
}

/** Sheet 2: one row per manager x rep x speciality for the reps on screen (share desc inside each pair). */
export function buildSpecGrid(a: { rows: CoverRow[]; spec: Map<string, SpecRow[]>; periodLine: string }): Grid {
  const headers = ['Line', 'Manager', 'Rep', 'Speciality', 'List doctors', 'Covered', 'Coverage %', 'Share %', 'Joint visits', 'Top speciality']
  const n = headers.length
  const b = bands(n, a.periodLine, null)
  b.cells.push(headers.map((h) => HEAD(h))); b.heights.push(34)
  let ri = 0
  for (const r of a.rows) {
    const list = a.spec.get(pairKey(r)) ?? []
    const top = topSpeciality(list)
    for (const x of list) {
      const isTop = top !== null && x.speciality === top.speciality
      const bg = isTop ? CPAL.topBody : ri % 2 === 1 ? CPAL.zebra : null
      ri++
      const tx = style(bg, CPAL.navy, { h: 'left', border: true })
      const nm = style(bg, CPAL.navy, { bold: true, border: true })
      b.cells.push([
        { v: r.line ?? '', s: tx }, { v: r.manager ?? '', s: tx }, { v: r.rep_name ?? '', s: tx }, { v: x.speciality, s: tx },
        { v: x.list_doctors, s: nm }, { v: x.covered_doctors, s: nm },
        x.coverage_pct === null ? { v: '-', s: nm } : { v: x.coverage_pct, s: nm, z: '0.0%' },
        x.share_pct === null ? { v: '-', s: nm } : { v: x.share_pct, s: nm, z: '0.0%' },
        { v: x.joint_visits, s: nm }, { v: isTop ? 'Yes' : '', s: nm },
      ])
      b.heights.push(20)
    }
  }
  return { name: 'Speciality detail', cells: b.cells, merges: b.merges, heights: b.heights, widths: [14, 24, 26, 26, 12, 11, 12, 11, 11, 13] }
}
