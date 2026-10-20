import { CPAL, gridBands, gridHead, gridStyle, type Grid, type GridCell } from '../reports/coverageMath'
import { downloadXlsxGrids } from '../../lib/xlsxExport'
import type { RoiMonth, RoiRow, RoiTerritory } from '../../lib/api/roi'
import { roiTone, type RoiTone } from './roiMath'
import { monthShort } from '../dashboard/periodMath'

type V = string | number | null
type Kind = 'text' | 'int' | 'dec' | 'roi'
interface Col { h: string; w: number; kind: Kind }
const FMT: Record<Kind, string | undefined> = { text: undefined, int: '#,##0', dec: '0.00', roi: '0.0"x"' }
const TONE: Record<RoiTone, { bg: string | null; fg: string }> = {
  red: { bg: CPAL.redBody, fg: CPAL.red }, amber: { bg: CPAL.topBody, fg: '#8A5A00' }, green: { bg: CPAL.greenBody, fg: CPAL.green }, none: { bg: null, fg: CPAL.navy },
}
const TITLE = 'SPECIALITY ROI REPORT'
const SUBTITLE = 'Visits to the doctors of a speciality group  vs  sales of the group\'s products'

/** Title band, period band, header row and zebra body; the ROI column is coloured by the same thresholds as the screen. */
function table(name: string, periodLine: string, cols: Col[], rows: V[][]): Grid {
  const b = gridBands(cols.length, periodLine, null, TITLE, SUBTITLE)
  b.cells.push(cols.map((c) => gridHead(c.h))); b.heights.push(34)
  rows.forEach((r, i) => {
    const bg = i % 2 === 1 ? CPAL.zebra : null
    b.cells.push(r.map((v, j): GridCell => {
      const c = cols[j]
      if (c.kind === 'text') return { v: v === null ? '' : String(v), s: gridStyle(bg, CPAL.navy, { h: 'left', border: true }) }
      if (v === null || typeof v === 'string') return { v: '-', s: gridStyle(bg, CPAL.grey, { border: true }) }
      if (c.kind === 'roi') { const t = TONE[roiTone(v)]; return { v, z: FMT.roi, s: gridStyle(t.bg ?? bg, t.fg, { bold: true, border: true }) } }
      return { v, z: FMT[c.kind], s: gridStyle(bg, CPAL.navy, { border: true }) }
    }))
    b.heights.push(20)
  })
  return { name, cells: b.cells, merges: b.merges, heights: b.heights, widths: cols.map((c) => c.w) }
}

export function buildSummaryGrid(rows: RoiRow[], periodLine: string): Grid {
  const cols: Col[] = [
    { h: 'Line', w: 10, kind: 'text' }, { h: 'Group', w: 28, kind: 'text' }, { h: 'Specialities', w: 30, kind: 'text' }, { h: 'Products (priority)', w: 40, kind: 'text' },
    { h: 'Doctors in list', w: 12, kind: 'int' }, { h: 'Visits', w: 10, kind: 'int' }, { h: 'Visits / doctor', w: 12, kind: 'dec' }, { h: 'Sales (EGP)', w: 16, kind: 'int' },
    { h: 'Units', w: 12, kind: 'int' }, { h: 'Visit cost (EGP)', w: 16, kind: 'int' }, { h: 'Sales per visit', w: 14, kind: 'int' }, { h: 'ROI', w: 9, kind: 'roi' },
  ]
  return table('Summary', periodLine, cols, rows.map((r) => [r.line_name, r.group_name, r.specialities, r.products, r.list_doctors, r.visits, r.visits_per_doctor, r.s_value, r.s_units, r.cost, r.sales_per_visit, r.roi]))
}

export interface GroupTerritories { group: RoiRow; rows: RoiTerritory[] }
export function buildTerritoriesGrid(all: GroupTerritories[], periodLine: string): Grid {
  const cols: Col[] = [
    { h: 'Line', w: 10, kind: 'text' }, { h: 'Group', w: 28, kind: 'text' }, { h: 'Territory', w: 22, kind: 'text' }, { h: 'Rep', w: 24, kind: 'text' }, { h: 'Manager', w: 24, kind: 'text' },
    { h: 'Visits', w: 10, kind: 'int' }, { h: 'Sales (EGP)', w: 16, kind: 'int' }, { h: 'Visit cost (EGP)', w: 16, kind: 'int' }, { h: 'Sales per visit', w: 14, kind: 'int' }, { h: 'ROI', w: 9, kind: 'roi' },
  ]
  return table('Territories', periodLine, cols, all.flatMap(({ group: g, rows }) => rows.map((t) => [g.line_name, g.group_name, t.territory_name, t.rep_name, t.manager_name, t.visits, t.s_value, t.cost, t.sales_per_visit, t.roi])))
}

export interface GroupMonths { group: RoiRow; rows: RoiMonth[] }
export function buildMonthlyGrid(all: GroupMonths[], periodLine: string): Grid {
  const cols: Col[] = [
    { h: 'Line', w: 10, kind: 'text' }, { h: 'Group', w: 28, kind: 'text' }, { h: 'Month', w: 10, kind: 'text' }, { h: 'Visits', w: 10, kind: 'int' }, { h: 'Sales (EGP)', w: 16, kind: 'int' },
    { h: 'Units', w: 12, kind: 'int' }, { h: 'Visit cost (EGP)', w: 16, kind: 'int' }, { h: 'Sales per visit', w: 14, kind: 'int' }, { h: 'ROI', w: 9, kind: 'roi' },
  ]
  return table('Monthly', periodLine, cols, all.flatMap(({ group: g, rows }) => rows.map((m) => [g.line_name, g.group_name, monthShort(m.month.slice(0, 7)), m.visits, m.s_value, m.s_units, m.cost, m.sales_per_visit, m.roi])))
}

export const downloadRoiWorkbook = (filename: string, grids: Grid[]): Promise<void> => downloadXlsxGrids(filename, grids)
