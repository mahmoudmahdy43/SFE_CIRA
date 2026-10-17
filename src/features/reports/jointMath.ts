/**
 * Manager Joint Days report helpers. The views `v_manager_joint_days` (day x manager x rep) and
 * `v_manager_joint_month` (manager x rep) produce every per-row number, including the cover_* ratios. The browser
 * only maps, filters, orders and formats them, and builds the pinned Total row + the four KPI cards the way the
 * spec defines them: SUM(joint) / SUM(rep) over the filtered rows, never an average of percentages.
 * No imports: this file is also run directly by scripts/reportMath.test.mjs.
 */

/* ------------------------------------ palette (Field Trainer Coverage design) ------------------------------------ */
export const PAL = {
  navy: '#20293A', slate: '#39465C', white: '#FFFFFF',
  green: '#1B7A45', greenSub: '#229A57', greenBody: '#EAF7EE',
  red: '#B81F27', redSub: '#DB3A3F', redBody: '#FDEDED',
  teal: '#2C7E6E', tealSub: '#39A088', tealBody: '#E9F6F2',
  totalBody: '#F4F6F8', grey: '#667085', zebra: '#F4F6F8', rowLine: '#D5D9DE', beige: '#D8D3C4',
  barFrom: '#7DC99B', barTo: '#1B7A45',
} as const

export type Shift = 'am' | 'pm' | 'pharmacy'
export const SHIFTS: Shift[] = ['am', 'pm', 'pharmacy']
export type JointGroup = 'info' | 'am' | 'pm' | 'ph' | 'tot'
export const GROUPS: Record<JointGroup, { label: string; main: string; sub: string }> = {
  info: { label: 'REP / VISIT INFO', main: PAL.navy, sub: PAL.navy },
  am: { label: 'AM VISITS', main: PAL.green, sub: PAL.greenSub },
  pm: { label: 'PM VISITS', main: PAL.red, sub: PAL.redSub },
  ph: { label: 'PHARMACY VISITS', main: PAL.teal, sub: PAL.tealSub },
  tot: { label: 'DAY TOTALS', main: PAL.slate, sub: PAL.slate },
}
const GROUP_OF: Record<Shift, JointGroup> = { am: 'am', pm: 'pm', pharmacy: 'ph' }

export const HEADER_TITLE = 'MANAGER JOINT DAYS REPORT'
export const HEADER_SUBTITLE = 'Joint Field-Visit Coverage Analysis  —  AM  |  PM  |  Pharmacy'
export const FOOTER_NOTE =
  'A joint visit is a Double visit that has both the manager and the rep. Rep visits = all of the rep\'s visits that day (Single + Double). Pharmacy has its own shift and is not counted as AM or PM.'
export const EMPTY_TITLE = 'No joint days for this manager in this month'

/* ------------------------------------ rows ------------------------------------ */
export interface JointRow {
  month: string
  /** ISO date (yyyy-mm-dd) in the day view; null in the month view. */
  day: string | null
  manager: string | null
  manager_id: number | null
  rep_name: string | null
  rep_code: string | null
  /** 0 is reserved for the pinned Total row. */
  rep_id: number
  line: string | null
  box: string | null
  /** Month view only. */
  joint_days: number | null
  rep_am: number; rep_pm: number; rep_pharmacy: number; rep_total: number
  joint_am: number; joint_pm: number; joint_pharmacy: number; joint_total: number
  /** Ratios (0.59 = 59%); null when the rep had no visits in that shift. */
  cover_am: number | null; cover_pm: number | null; cover_pharmacy: number | null; cover_total: number | null
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const n0 = (v: unknown): number => numOrNull(v) ?? 0
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

export function toJointRow(r: Record<string, unknown>): JointRow {
  return {
    month: String(r.month ?? ''),
    day: r.day === null || r.day === undefined ? null : String(r.day).slice(0, 10),
    manager: s(r.manager),
    manager_id: numOrNull(r.manager_id),
    rep_name: s(r.rep_name),
    rep_code: s(r.rep_code),
    rep_id: n0(r.rep_id),
    line: s(r.line),
    box: s(r.box),
    joint_days: numOrNull(r.joint_days),
    rep_am: n0(r.rep_am), rep_pm: n0(r.rep_pm), rep_pharmacy: n0(r.rep_pharmacy), rep_total: n0(r.rep_total),
    joint_am: n0(r.joint_am), joint_pm: n0(r.joint_pm), joint_pharmacy: n0(r.joint_pharmacy), joint_total: n0(r.joint_total),
    cover_am: numOrNull(r.cover_am), cover_pm: numOrNull(r.cover_pm), cover_pharmacy: numOrNull(r.cover_pharmacy), cover_total: numOrNull(r.cover_total),
  }
}

export const isJointTotal = (r: JointRow): boolean => r.rep_id === 0

/* ------------------------------------ filters / order ------------------------------------ */
export type JointMode = 'day' | 'month'
export interface JointFilters {
  /** Line name (the views carry the name, the shared filter carries the id); null = all lines. */
  line: string | null
  /** '' = all managers. */
  manager: string
  search: string
  /** ISO dates, '' = open; apply to the day view only. */
  from: string
  to: string
}

export function filterJoint(rows: JointRow[], f: JointFilters): JointRow[] {
  const q = f.search.trim().toLowerCase()
  return rows.filter(
    (r) =>
      (f.line === null || r.line === f.line) &&
      (f.manager === '' || r.manager === f.manager) &&
      (q === '' || [r.rep_name, r.rep_code].some((v) => v !== null && v.toLowerCase().includes(q))) &&
      (r.day === null || ((f.from === '' || r.day >= f.from) && (f.to === '' || r.day <= f.to))),
  )
}

const cmpText = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

/** Day view: Visit Date ascending, then Rep Name. Month view: Manager, then Rep Name. */
export function orderJoint(rows: JointRow[], mode: JointMode): JointRow[] {
  return [...rows].sort((a, b) =>
    mode === 'day'
      ? cmpText(a.day, b.day) || cmpText(a.rep_name, b.rep_name) || cmpText(a.manager, b.manager)
      : cmpText(a.manager, b.manager) || cmpText(a.rep_name, b.rep_name),
  )
}

export function jointManagers(rows: JointRow[]): string[] {
  return [...new Set(rows.flatMap((r) => (r.manager ? [r.manager] : [])))].sort(cmpText)
}

/** Default manager: the first (by name) that has joint days in the month; '' (all) when there is none. */
export function defaultManager(rows: JointRow[]): string {
  const withJoint = jointManagers(rows.filter((r) => r.joint_total > 0))
  return withJoint[0] ?? jointManagers(rows)[0] ?? ''
}

export const distinctDays = (rows: JointRow[]): number => new Set(rows.flatMap((r) => (r.day ? [r.day] : []))).size

/* ------------------------------------ totals / cards ------------------------------------ */
const ratio = (joint: number, rep: number): number | null => (rep > 0 ? joint / rep : null)

/** Pinned Total row: every numeric column summed, every coverage = SUM(joint) / SUM(rep) (never an average). */
export function totalJointRow(rows: JointRow[], nDays: number): JointRow {
  const sum = (k: 'rep_am' | 'rep_pm' | 'rep_pharmacy' | 'rep_total' | 'joint_am' | 'joint_pm' | 'joint_pharmacy' | 'joint_total') =>
    rows.reduce((a, r) => a + r[k], 0)
  const t = {
    rep_am: sum('rep_am'), rep_pm: sum('rep_pm'), rep_pharmacy: sum('rep_pharmacy'), rep_total: sum('rep_total'),
    joint_am: sum('joint_am'), joint_pm: sum('joint_pm'), joint_pharmacy: sum('joint_pharmacy'), joint_total: sum('joint_total'),
  }
  return {
    month: rows[0]?.month ?? '', day: null, manager: null, manager_id: null,
    rep_name: `TOTAL  (${nDays} ${nDays === 1 ? 'Day' : 'Days'})`, rep_code: null, rep_id: 0, line: null, box: null,
    joint_days: rows.some((r) => r.joint_days !== null) ? rows.reduce((a, r) => a + (r.joint_days ?? 0), 0) : null,
    ...t,
    cover_am: ratio(t.joint_am, t.rep_am), cover_pm: ratio(t.joint_pm, t.rep_pm), cover_pharmacy: ratio(t.joint_pharmacy, t.rep_pharmacy),
    cover_total: ratio(t.joint_total, t.rep_total),
  }
}

export const fmtCover = (v: number | null): string => (v === null ? '-' : `${(v * 100).toFixed(1)}%`)
export const fmtJointCount = (v: number): string => Math.round(v).toLocaleString('en-US')

export interface JointCard { id: 'am' | 'pm' | 'pharmacy' | 'total'; title: string; head: string; body: string; num: string; value: string; caption: string }
const CARD_META: { id: 'am' | 'pm' | 'pharmacy' | 'total'; title: string; head: string; body: string; num: string }[] = [
  { id: 'am', title: 'AM VISITS COVERAGE', head: PAL.green, body: PAL.greenBody, num: PAL.green },
  { id: 'pm', title: 'PM VISITS COVERAGE', head: PAL.red, body: PAL.redBody, num: PAL.red },
  { id: 'pharmacy', title: 'PHARMACY COVERAGE', head: PAL.teal, body: PAL.tealBody, num: PAL.teal },
  { id: 'total', title: 'TOTAL FIELD COVERAGE', head: PAL.navy, body: PAL.totalBody, num: PAL.navy },
]

/** The four KPI cards from the Total row ("17 of 32 visits joint-covered"). */
export function jointCards(total: JointRow): JointCard[] {
  return CARD_META.map((m) => {
    const joint = total[`joint_${m.id}` as const]
    const rep = total[`rep_${m.id}` as const]
    const cover = total[`cover_${m.id}` as const]
    return { ...m, value: cover === null ? '—' : fmtCover(cover), caption: `${fmtJointCount(joint)} of ${fmtJointCount(rep)} visits joint-covered` }
  })
}

/* ------------------------------------ dates ------------------------------------ */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_FULL = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']

/** '2026-09-01' -> '01-Sep-2026'; null / unparseable -> '-'. */
export function fmtDate(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  return m ? `${m[3]}-${MON[Number(m[2]) - 1] ?? '???'}-${m[1]}` : '-'
}

/** 'PERIOD: 1 SEPTEMBER 2026 – 30 SEPTEMBER 2026' for a first-of-month ISO date. */
export function periodLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `PERIOD: 1 ${MONTH_FULL[m - 1]} ${y} – ${last} ${MONTH_FULL[m - 1]} ${y}`
}
/** First and last day of the month as ISO dates (for the date-range inputs). */
export function monthBounds(month: string): { first: string; last: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { first: `${y}-${mm}-01`, last: `${y}-${mm}-${String(last).padStart(2, '0')}` }
}

/* ------------------------------------ columns ------------------------------------ */
export type ColKind = 'text' | 'date' | 'days' | 'rep' | 'with' | 'total_rep' | 'total_with' | 'cover'
export interface JointColDef {
  id: string
  /** Two-line labels use "\n". */
  header: string
  group: JointGroup
  kind: ColKind
  shift?: Shift
  field?: 'manager' | 'rep_name' | 'line' | 'box'
}

/** Table columns in the spec's order. "All managers" adds a first Manager column; Summary swaps Visit Date for Joint days. */
export function jointColumns(mode: JointMode, showManager: boolean): JointColDef[] {
  const cols: JointColDef[] = []
  if (showManager) cols.push({ id: 'manager', header: 'Manager', group: 'info', kind: 'text', field: 'manager' })
  cols.push(
    { id: 'rep', header: 'Rep Name', group: 'info', kind: 'text', field: 'rep_name' },
    { id: 'line', header: 'Line', group: 'info', kind: 'text', field: 'line' },
    { id: 'box', header: 'Territory\n(Box)', group: 'info', kind: 'text', field: 'box' },
    mode === 'day' ? { id: 'day', header: 'Visit\nDate', group: 'info', kind: 'date' } : { id: 'days', header: 'Joint\nDays', group: 'info', kind: 'days' },
  )
  for (const sh of SHIFTS) {
    cols.push(
      { id: `rep_${sh}`, header: 'Rep\nTotal', group: GROUP_OF[sh], kind: 'rep', shift: sh },
      { id: `with_${sh}`, header: 'With\nManager', group: GROUP_OF[sh], kind: 'with', shift: sh },
    )
  }
  cols.push(
    { id: 'total_rep', header: 'Total\n(Rep)', group: 'tot', kind: 'total_rep' },
    { id: 'total_with', header: 'Total\n(With Manager)', group: 'tot', kind: 'total_with' },
    { id: 'cover', header: 'Coverage\n%', group: 'tot', kind: 'cover' },
  )
  return cols
}

export const isNumericKind = (k: ColKind): boolean => k !== 'text' && k !== 'date'

/** Raw value of a cell (sort key / export). Rep + With Manager cells are null when the shift's cover is null ("-"). */
export function jointValue(c: JointColDef, r: JointRow): string | number | null {
  switch (c.kind) {
    case 'text': return c.field ? r[c.field] : null
    case 'date': return r.day
    case 'days': return r.joint_days
    case 'rep': return c.shift && r[`cover_${c.shift}` as const] !== null ? r[`rep_${c.shift}` as const] : null
    case 'with': return c.shift && r[`cover_${c.shift}` as const] !== null ? r[`joint_${c.shift}` as const] : null
    case 'total_rep': return r.rep_total
    case 'total_with': return r.joint_total
    case 'cover': return r.cover_total
  }
}

/** Display text of a body cell: "-" only where the cover is null; a 0 stays 0. */
export function jointText(c: JointColDef, r: JointRow): string {
  const v = jointValue(c, r)
  if (c.kind === 'text') return v === null ? '' : String(v)
  if (c.kind === 'date') return fmtDate(r.day)
  if (c.kind === 'cover') return fmtCover(r.cover_total)
  return v === null ? '-' : fmtJointCount(Number(v))
}

/** Footer (Total row) text: the label in the first column, sums elsewhere. */
export function jointFootText(cols: JointColDef[], c: JointColDef, total: JointRow): string {
  if (cols[0] === c) return total.rep_name ?? ''
  if (c.kind === 'text' || c.kind === 'date') return ''
  return jointText(c, total)
}

/* ------------------------------------ flat export (CSV) ------------------------------------ */
export type FlatRow = Record<string, string | number | null>
const round1 = (v: number) => Math.round(v * 10) / 10

/** Table rows + Total as flat records (CSV). Coverage as a percentage number, "-" cells left empty. */
export function jointFlatRows(cols: JointColDef[], rows: JointRow[], total: JointRow): FlatRow[] {
  const one = (r: JointRow, isTotal: boolean): FlatRow => {
    const o: FlatRow = {}
    for (const c of cols) {
      const key = c.header.replace('\n', ' ')
      if (isTotal && (c === cols[0] || c.kind === 'text' || c.kind === 'date')) o[key] = c === cols[0] ? total.rep_name : null
      else if (c.kind === 'date') o[key] = fmtDate(r.day)
      else if (c.kind === 'cover') o[key] = r.cover_total === null ? null : round1(r.cover_total * 100)
      else o[key] = jointValue(c, r)
    }
    return o
  }
  return [...rows.map((r) => one(r, false)), one(total, true)]
}

/* ------------------------------------ Excel grid (same colours as the screen) ------------------------------------ */
export interface GridCell { v: string | number | null; s?: Record<string, unknown>; z?: string }
export interface Grid {
  cells: GridCell[][]
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[]
  widths: number[]
  /** Row heights in points (undefined = default). */
  heights: (number | undefined)[]
}

const rgb = (hex: string) => hex.replace('#', '')
const fill = (hex: string) => ({ patternType: 'solid', fgColor: { rgb: rgb(hex) } })
const thinBottom = { bottom: { style: 'thin', color: { rgb: rgb(PAL.rowLine) } } }
const style = (bg: string | null, color: string, extra: { bold?: boolean; italic?: boolean; sz?: number; h?: 'left' | 'center' | 'right'; wrap?: boolean; border?: boolean } = {}) => ({
  ...(bg ? { fill: fill(bg) } : {}),
  font: { name: 'Calibri', color: { rgb: rgb(color) }, bold: !!extra.bold, italic: !!extra.italic, sz: extra.sz ?? 10 },
  alignment: { horizontal: extra.h ?? 'center', vertical: 'center', wrapText: !!extra.wrap },
  ...(extra.border ? { border: thinBottom } : {}),
})

/**
 * Title band, KPI strip, grouped header, body (zebra), Total row and footer note as one grid with merges, so the
 * Excel file reads like the screen. Cover cells are real numbers with a 0.0% format.
 */
export function buildJointGrid(a: {
  cols: JointColDef[]
  rows: JointRow[]
  total: JointRow
  month: string
  managerLabel: string
}): Grid {
  const { cols, rows, total } = a
  const n = cols.length
  const cells: GridCell[][] = []
  const merges: Grid['merges'] = []
  const heights: (number | undefined)[] = []
  const blank = (): GridCell[] => Array.from({ length: n }, () => ({ v: null }))
  const pushBands = (parts: { c0: number; c1: number; v: string | number | null; st: Record<string, unknown>; z?: string }[], h?: number) => {
    const row = blank()
    for (const p of parts) {
      row[p.c0] = { v: p.v, s: p.st, z: p.z }
      for (let c = p.c0 + 1; c <= p.c1; c++) row[c] = { v: null, s: p.st }
      if (p.c1 > p.c0) merges.push({ s: { r: cells.length, c: p.c0 }, e: { r: cells.length, c: p.c1 } })
    }
    cells.push(row)
    heights.push(h)
  }

  // header band
  pushBands([{ c0: 0, c1: n - 1, v: HEADER_TITLE, st: style(PAL.navy, PAL.white, { bold: true, sz: 16 }) }], 30)
  pushBands([{ c0: 0, c1: n - 1, v: HEADER_SUBTITLE, st: style(null, PAL.grey, { italic: true, sz: 10 }) }], 18)
  pushBands([{ c0: 0, c1: n - 1, v: `${periodLabel(a.month)}   |   MANAGER: ${a.managerLabel.toUpperCase()}`, st: style(PAL.green, PAL.white, { bold: true, sz: 10 }) }], 20)
  cells.push(blank()); heights.push(6)

  // KPI strip: four blocks of (almost) equal width
  const cards = jointCards(total)
  const base = Math.floor(n / 4)
  const rem = n % 4
  const spans: { c0: number; c1: number }[] = []
  let at = 0
  for (let i = 0; i < 4; i++) {
    const w = base + (i < rem ? 1 : 0)
    spans.push({ c0: at, c1: at + w - 1 })
    at += w
  }
  pushBands(cards.map((c, i) => ({ ...spans[i], v: c.title, st: style(c.head, PAL.white, { bold: true, sz: 10 }) })), 20)
  pushBands(
    cards.map((c, i) => {
      const cover = total[`cover_${c.id}` as const]
      return { ...spans[i], v: cover === null ? '—' : cover, z: '0.0%', st: style(c.body, c.num, { bold: true, sz: 18 }) }
    }),
    32,
  )
  pushBands(cards.map((c, i) => ({ ...spans[i], v: c.caption, st: style(c.body, PAL.grey, { italic: true, sz: 9 }) })), 16)
  pushBands([{ c0: 0, c1: n - 1, v: null, st: style(PAL.beige, PAL.beige) }], 4)

  // grouped header
  const groupRow = blank()
  const headRow = blank()
  let c = 0
  while (c < n) {
    let e = c
    while (e + 1 < n && cols[e + 1].group === cols[c].group) e++
    const g = GROUPS[cols[c].group]
    const st = style(g.main, PAL.white, { bold: true, sz: 10 })
    groupRow[c] = { v: g.label, s: st }
    for (let k = c + 1; k <= e; k++) groupRow[k] = { v: null, s: st }
    if (e > c) merges.push({ s: { r: cells.length, c }, e: { r: cells.length, c: e } })
    c = e + 1
  }
  cols.forEach((col, i) => { headRow[i] = { v: col.header, s: style(GROUPS[col.group].sub, PAL.white, { bold: true, sz: 10, wrap: true }) } })
  cells.push(groupRow); heights.push(22)
  cells.push(headRow); heights.push(34)

  // body
  rows.forEach((r, ri) => {
    const bg = ri % 2 === 1 ? PAL.zebra : null
    cells.push(
      cols.map((col): GridCell => {
        const text = isNumericKind(col.kind) ? 'num' : 'text'
        const st = style(bg, PAL.navy, { bold: text === 'num', h: text === 'num' ? 'center' : 'left', border: true })
        if (col.kind === 'cover') return r.cover_total === null ? { v: '-', s: st } : { v: r.cover_total, s: st, z: '0.0%' }
        if (col.kind === 'date') return { v: fmtDate(r.day), s: st }
        const v = jointValue(col, r)
        if (text === 'num') return { v: v === null ? '-' : Number(v), s: st }
        return { v: v === null ? '' : String(v), s: st }
      }),
    )
    heights.push(20)
  })

  // Total row, in the group colours
  cells.push(
    cols.map((col, i): GridCell => {
      const st = style(GROUPS[col.group].main, PAL.white, { bold: true, h: i === 0 ? 'left' : 'center', sz: 10 })
      if (i === 0) return { v: total.rep_name ?? '', s: st }
      if (col.kind === 'text' || col.kind === 'date') return { v: null, s: st }
      if (col.kind === 'cover') return total.cover_total === null ? { v: '-', s: st } : { v: total.cover_total, s: st, z: '0.0%' }
      const v = jointValue(col, total)
      return { v: v === null ? '-' : Number(v), s: st }
    }),
  )
  heights.push(24)

  // footer note
  cells.push(blank()); heights.push(6)
  pushBands([{ c0: 0, c1: n - 1, v: FOOTER_NOTE, st: style(null, PAL.grey, { italic: true, sz: 9, h: 'left', wrap: true }) }], 28)

  const widths = cols.map((col) => (col.kind === 'text' ? (col.id === 'rep' || col.id === 'manager' ? 24 : col.id === 'box' ? 18 : 12) : col.kind === 'date' ? 14 : col.kind === 'cover' ? 14 : 12))
  return { cells, merges, widths, heights }
}
