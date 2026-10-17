import { CPAL, gridBands, gridHead, gridStyle, type Grid, type GridCell } from './coverageMath'
import {
  SALES_SUBTITLE, SALES_TITLE, type ActionView, type GapView, type LineRow, type ProductTotal, type ProductView,
} from './salesMath'

type V = string | number | null
type Kind = 'text' | 'int' | 'pct' | 'signed' | 'price'
interface Col { h: string; w: number; kind: Kind }
const FMT: Record<Kind, string | undefined> = { text: undefined, int: '#,##0', pct: '0.0%', signed: '+#,##0;-#,##0;0', price: '#,##0.00' }

/** Title band, period band, header row, zebra body and an optional navy total row. */
function table(name: string, periodLine: string, cols: Col[], rows: V[][], total?: V[]): Grid {
  const b = gridBands(cols.length, periodLine, null, SALES_TITLE, SALES_SUBTITLE)
  b.cells.push(cols.map((c) => gridHead(c.h))); b.heights.push(34)
  const cell = (v: V, c: Col, st: Record<string, unknown>, redNeg: boolean): GridCell => {
    if (v === null || v === undefined || v === '') return { v: c.kind === 'text' ? '' : '-', s: st }
    if (typeof v === 'string' || c.kind === 'text') return { v: String(v), s: st }
    return { v, s: redNeg && v < 0 && (c.kind === 'signed' || c.kind === 'pct') ? { ...st, font: { ...(st.font as object), color: { rgb: CPAL.red.replace('#', '') } } } : st, z: FMT[c.kind] }
  }
  rows.forEach((r, i) => {
    const bg = i % 2 === 1 ? CPAL.zebra : null
    const tx = gridStyle(bg, CPAL.navy, { h: 'left', border: true })
    const nm = gridStyle(bg, CPAL.navy, { bold: true, border: true })
    b.cells.push(r.map((v, j) => cell(v, cols[j], cols[j].kind === 'text' ? tx : nm, true)))
    b.heights.push(20)
  })
  if (total) {
    const t = gridStyle(CPAL.navy, CPAL.white, { bold: true })
    const tl = { ...t, alignment: { horizontal: 'left', vertical: 'center' } }
    b.cells.push(total.map((v, j) => cell(v, cols[j], cols[j].kind === 'text' ? tl : t, false)))
    b.heights.push(24)
  }
  return { name, cells: b.cells, merges: b.merges, heights: b.heights, widths: cols.map((c) => c.w) }
}

export function buildLinesGrid(a: { rows: LineRow[]; periodLine: string; unit: string; hasCmp: boolean; showVacant: boolean }): Grid {
  const cols: Col[] = [
    { h: 'Line', w: 18, kind: 'text' }, { h: `Sales (${a.unit})`, w: 16, kind: 'int' }, { h: 'Target', w: 16, kind: 'int' }, { h: 'Ach %', w: 10, kind: 'pct' },
    { h: 'Gap', w: 14, kind: 'signed' }, { h: 'Comparison sales', w: 16, kind: 'int' }, { h: 'Growth %', w: 11, kind: 'pct' }, { h: 'Vacant sales (EGP)', w: 16, kind: 'int' },
  ]
  const rowOf = (r: LineRow): V[] => [r.name, r.kpi.sales, r.kpi.target, r.kpi.ach, r.kpi.gap, a.hasCmp ? r.kpi.cmp : null, a.hasCmp ? r.kpi.growth : null, a.showVacant ? r.kpi.vacant : null]
  const co = a.rows.find((r) => r.isCompany)
  return table('Lines', a.periodLine, cols, a.rows.filter((r) => !r.isCompany).map(rowOf), co ? rowOf(co) : undefined)
}

export function buildProductsGrid(a: { rows: ProductView[]; total: ProductTotal; periodLine: string; unit: string }): Grid {
  const cols: Col[] = [
    { h: 'Product', w: 30, kind: 'text' }, { h: 'Line', w: 12, kind: 'text' }, { h: `Sales (${a.unit})`, w: 16, kind: 'int' }, { h: 'Share %', w: 10, kind: 'pct' }, { h: 'Target', w: 16, kind: 'int' },
    { h: 'Ach %', w: 10, kind: 'pct' }, { h: 'Gap', w: 14, kind: 'signed' }, { h: 'Comparison', w: 16, kind: 'int' }, { h: 'Growth %', w: 11, kind: 'pct' },
    { h: 'Avg price (EGP)', w: 14, kind: 'price' }, { h: 'ABC', w: 7, kind: 'text' }, { h: 'Note', w: 12, kind: 'text' },
  ]
  const body = a.rows.map((p): V[] => [p.name, p.line ?? '', p.sales, p.share, p.target, p.ach, p.gap, p.cmp, p.growth, p.avgPrice, p.abc, p.noTarget ? 'No target' : ''])
  const t = a.total
  return table('Products', a.periodLine, cols, body, ['TOTAL', '', t.sales, 1, t.target, t.ach, t.gap, t.cmp, t.growth, t.avgPrice, '', ''])
}

export function buildGapGrid(a: { name: string; rows: GapView[]; periodLine: string }): Grid {
  const cols: Col[] = [
    { h: a.name, w: 30, kind: 'text' }, { h: 'Line', w: 16, kind: 'text' }, { h: 'Manager', w: 26, kind: 'text' }, { h: 'Sales (EGP)', w: 16, kind: 'int' }, { h: 'Target', w: 16, kind: 'int' },
    { h: 'Ach %', w: 10, kind: 'pct' }, { h: 'Gap', w: 14, kind: 'signed' }, { h: 'Vacant months', w: 12, kind: 'int' },
  ]
  return table(`Gap - ${a.name}`, a.periodLine, cols, a.rows.map((r): V[] => [r.key_name, r.line_names ?? '', r.manager_names ?? '', r.s_value, r.t_value, r.ach, r.gap, r.vacant_months]))
}

export function buildActionsGrid(a: { rows: ActionView[]; periodLine: string }): Grid {
  const cols: Col[] = [
    { h: 'Status', w: 10, kind: 'text' }, { h: 'Rep', w: 26, kind: 'text' }, { h: 'Line', w: 14, kind: 'text' }, { h: 'Manager', w: 24, kind: 'text' }, { h: 'Territories', w: 11, kind: 'int' },
    { h: 'Sales (EGP)', w: 15, kind: 'int' }, { h: 'Target', w: 15, kind: 'int' }, { h: 'Ach %', w: 10, kind: 'pct' }, { h: 'Gap', w: 14, kind: 'signed' }, { h: 'Last-month Ach %', w: 12, kind: 'pct' },
    { h: 'Declining months', w: 11, kind: 'int' }, { h: 'Top gap products', w: 50, kind: 'text' }, { h: 'Avg visits per month', w: 12, kind: 'price' }, { h: 'Sales per visit', w: 13, kind: 'int' },
    { h: 'Coaching avg', w: 11, kind: 'price' }, { h: 'Reason', w: 46, kind: 'text' },
  ]
  return table('Action list', a.periodLine, cols, a.rows.map((r): V[] => [
    r.status, r.rep_name, r.line_names ?? '', r.manager_name ?? '', r.territories, r.s_value, r.t_value, r.achF, r.gap, r.lastAchF, r.decline_run,
    r.top_gap_products.map((p) => `${p.product} (-${Math.round(p.shortfall).toLocaleString('en-US')})`).join('; '), r.avgVisits, r.perVisit, r.coachAvg, r.reason,
  ]))
}
