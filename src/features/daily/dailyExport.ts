import { CARDS_GROUP } from './cardsTemplate'
import { STATUS_COLORS, computeCards, fmtAvg, type Cards, type DailyRow } from './dailyMath'

export interface DailySheetInput { line: number; rows: DailyRow[]; comments: Record<string, string> }

type Style = Record<string, unknown>
interface Cell { v: string | number | null; s?: Style; z?: string }

const WIDTHS = [29.8, 34, 17, 22.7, 15.2, 21.9, 15.7, 17.7, 14.7, 31.2]
const HEADERS = ['District Manager', 'Medical Rep', 'Status', 'Reporting Status', 'PM Visits', 'Pharmacy Visits', 'Vacations', 'Office Work', 'Activities', 'Comment']
const GREEN = '1B5E42'
const STRIP = 'C5E0B3'
const thin = { style: 'thin', color: { rgb: '000000' } }
const med = { style: 'medium', color: { rgb: '000000' } }
const fill = (rgb: string) => ({ patternType: 'solid', fgColor: { rgb } })
const font = (sz: number, o: { bold?: boolean; rgb?: string } = {}) => ({ name: 'Arial', sz, bold: o.bold ?? false, color: { rgb: o.rgb ?? '000000' } })

/** Excel serial number of an ISO day. */
export const excelSerial = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86400000 + 25569
}

// rows 1-3 title band, rows 4-8 light green strip under the floating cards, row 9 table header
const HEIGHTS = [24, 20, 20, 34.5, 14.4, 14.4, 14.4, 14.4, 24]
const HEADER_ROW = 8

/** One CIRA sheet laid out like "MRs Reporting Status": logo, title band, date box, nine cards, then the table. */
export function buildDailySheet(date: string, input: DailySheetInput) {
  const { line, rows, comments } = input
  const cells: Cell[][] = []
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = []
  const put = (r: number, c: number, cell: Cell) => {
    while (cells.length <= r) cells.push([])
    for (let i = cells[r].length; i < 10; i++) cells[r][i] = { v: null }
    cells[r][c] = cell
  }
  for (let r = 0; r < HEADER_ROW; r++) for (let c = 0; c < 10; c++) put(r, c, { v: null })

  // title band C1:H3 and logo cell A1:A3 (the picture is added to the file afterwards)
  const band = { fill: fill(GREEN), font: font(16, { bold: true, rgb: 'FFFFFF' }), alignment: { horizontal: 'center', vertical: 'center' } }
  const logoBox = { fill: fill('FFFFFF'), border: { top: thin, bottom: thin, left: thin, right: thin } }
  for (let r = 0; r < 3; r++) {
    put(r, 0, { v: null, s: logoBox })
    for (let c = 1; c <= 9; c++) put(r, c, { v: r === 0 && c === 1 ? `CIRA ${line} - MEDICAL REP DAILY PERFORMANCE` : null, s: band })
  }
  merges.push({ s: { r: 0, c: 1 }, e: { r: 2, c: 8 } }, { s: { r: 0, c: 0 }, e: { r: 2, c: 0 } })
  const box = { top: med, bottom: med, left: med, right: med }
  put(0, 9, { v: 'Date', s: { fill: fill(GREEN), font: font(10, { bold: true, rgb: 'FFFFFF' }), alignment: { horizontal: 'center', vertical: 'center' } } })
  put(1, 9, { v: excelSerial(date), z: 'dddd, mmmm d, yyyy', s: { fill: fill('FFFFFF'), font: font(11), alignment: { horizontal: 'center', vertical: 'center' }, border: box } })

  // light green strip (rows 4-8); the nine cards float over it as a drawing group
  const strip = { fill: fill(STRIP) }
  for (let r = 3; r <= 7; r++) for (let c = 0; c < 10; c++) put(r, c, { v: null, s: strip })

  // table header
  HEADERS.forEach((h, c) =>
    put(HEADER_ROW, c, { v: h, s: { fill: fill(GREEN), font: font(12, { rgb: 'FFFFFF' }), alignment: { horizontal: 'center', vertical: 'center' }, border: { top: med, bottom: thin, left: c === 0 ? med : thin, right: c === 9 ? med : thin } } }),
  )

  rows.forEach((row, i) => {
    const r = HEADER_ROW + 1 + i
    const firstOfGroup = i === 0 || rows[i - 1].districtManager !== row.districtManager
    const last = i === rows.length - 1
    const tint = row.reporting === 'Reported Day' ? null : STATUS_COLORS[row.reporting]
    const base = (c: number, align: 'left' | 'center', special?: { bg: string; fg: string }): Style => {
      const col = special ?? tint
      return {
        font: font(12, { rgb: col?.fg }),
        ...(col ? { fill: fill(col.bg) } : {}),
        alignment: { horizontal: align, vertical: 'center', wrapText: c === 9 },
        border: { top: firstOfGroup ? med : thin, bottom: last ? med : thin, left: c === 0 ? med : thin, right: c === 9 ? med : thin },
      }
    }
    put(r, 0, { v: row.districtManager, s: base(0, 'left') })
    put(r, 1, { v: row.rep, s: base(1, 'left') })
    put(r, 2, { v: row.inSystem ? `● ${row.status}` : `⚠ ${row.status}`, s: base(2, 'center') })
    put(r, 3, { v: row.reporting, s: base(3, 'center', STATUS_COLORS[row.reporting]) })
    ;[row.pm, row.pharmacy, row.vacations, row.office, row.activities].forEach((v, k) => put(r, 4 + k, { v, s: base(4 + k, 'center') }))
    put(r, 9, { v: comments[row.key] ?? '', s: base(9, 'left') })
  })

  const heights: (number | undefined)[] = [...HEIGHTS, ...rows.map(() => 18)]
  return { name: `CIRA ${line}`, cells, merges, widths: WIDTHS, heights }
}

/* ------------------------------ workbook + logo / print setup ------------------------------ */
const NS_DRAWING = 'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const EMU = 12700 // per point
const LOGO_EMU = 62 * EMU
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const RELS_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** Card values by the placeholder names in cardsTemplate. */
export function cardValues(c: Cards): Record<string, string> {
  return { A6: String(c.active), C6: String(c.reported), C5: String(c.unreported), D5: String(c.followUp), B5: fmtAvg(c.avgPm), J5: fmtAvg(c.avgPharmacy), D6: String(c.vacations), F6: String(c.office), H6: String(c.activities) }
}

const CARDS_FROM_TO = '<xdr:from><xdr:col>0</xdr:col><xdr:colOff>77469</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>73659</xdr:rowOff></xdr:from><xdr:to><xdr:col>9</xdr:col><xdr:colOff>1933914</xdr:colOff><xdr:row>7</xdr:row><xdr:rowOff>65784</xdr:rowOff></xdr:to>'

const cardsAnchor = (c: Cards) => `<xdr:twoCellAnchor>${CARDS_FROM_TO}${CARDS_GROUP.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => cardValues(c)[k] ?? '')}</xdr:twoCellAnchor>`

const logoAnchor = () =>
  `<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>${4 * EMU}</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${3 * EMU}</xdr:rowOff></xdr:from><xdr:ext cx="${LOGO_EMU}" cy="${LOGO_EMU}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="CIRA logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${LOGO_EMU}" cy="${LOGO_EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`

/** Logo (when there is one) and the nine cards in the same drawing. */
const drawingXml = (c: Cards, withLogo: boolean) => `${XML_HEAD}<xdr:wsDr ${NS_DRAWING}>${withLogo ? logoAnchor() : ''}${cardsAnchor(c)}</xdr:wsDr>`

/** Hide gridlines, landscape fit-to-width, and point the sheet at its drawing (the logo). */
export function patchSheetXml(xml: string, withDrawing: boolean): string {
  let out = xml
  if (/<sheetPr[ >/]/.test(out)) out = out.replace(/<sheetPr(\s[^>]*)?\/>/, '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>')
  else out = out.replace(/(<worksheet[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>')
  if (/<sheetView[ >]/.test(out)) out = out.replace(/<sheetView(\s|>)/, (_m, g: string) => `<sheetView showGridLines="0"${g === '>' ? '>' : ' '}`)
  else out = out.replace('<sheetData', '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetData')
  // schema order: ... mergeCells, pageMargins, pageSetup, ignoredErrors, drawing
  const setup = '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
  const margins = /<pageMargins[^>]*\/>/.test(out) ? '' : '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'
  if (/<pageMargins[^>]*\/>/.test(out)) out = out.replace(/(<pageMargins[^>]*\/>)/, `$1${setup}`)
  else if (out.includes('<ignoredErrors')) out = out.replace('<ignoredErrors', `${margins}${setup}<ignoredErrors`)
  else out = out.replace('</worksheet>', `${margins}${setup}</worksheet>`)
  if (withDrawing) out = out.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>')
  if (withDrawing && !/xmlns:r=/.test(out)) out = out.replace(/<worksheet /, `<worksheet xmlns:r="${REL}" `)
  return out
}

/** The .xlsx file as bytes; `logo` is the PNG for the top-left corner (null = no picture). */
export async function buildDailyWorkbook(date: string, sheets: DailySheetInput[], logo: ArrayBuffer | null): Promise<Uint8Array> {
  const [mod, fflate] = await Promise.all([import('xlsx-js-style'), import('fflate')])
  const { unzipSync, zipSync, strToU8, strFromU8 } = fflate
  const XLSX = mod.default ?? (mod as unknown as typeof mod.default)
  const wb = XLSX.utils.book_new()
  for (const input of sheets) {
    const g = buildDailySheet(date, input)
    const ws: Record<string, unknown> = {}
    g.cells.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (cell.v === null && !cell.s) return
        const out: Record<string, unknown> = typeof cell.v === 'number' ? { t: 'n', v: cell.v } : { t: 's', v: cell.v ?? '' }
        if (cell.z) out.z = cell.z
        if (cell.s) out.s = cell.s
        ws[XLSX.utils.encode_cell({ r, c })] = out
      }),
    )
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: g.cells.length - 1, c: 9 } })
    ws['!merges'] = g.merges
    ws['!cols'] = g.widths.map((wch) => ({ wch }))
    ws['!rows'] = g.heights.map((h) => (h ? { hpt: h } : {}))
    XLSX.utils.book_append_sheet(wb, ws as never, g.name)
  }
  const raw = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const files = unzipSync(new Uint8Array(raw))
  const withLogo = logo !== null
  let types = strFromU8(files['[Content_Types].xml'])
  if (withLogo) {
    files['xl/media/cira-logo.png'] = new Uint8Array(logo)
    if (!/Extension="png"/.test(types)) types = types.replace('<Override', '<Default Extension="png" ContentType="image/png"/><Override')
  }
  sheets.forEach((input, i) => {
    const n = i + 1
    const path = `xl/worksheets/sheet${n}.xml`
    files[path] = strToU8(patchSheetXml(strFromU8(files[path]), true))
    files[`xl/drawings/drawing${n}.xml`] = strToU8(drawingXml(computeCards(input.rows), withLogo))
    if (withLogo) files[`xl/drawings/_rels/drawing${n}.xml.rels`] = strToU8(`${XML_HEAD}<Relationships ${RELS_NS}><Relationship Id="rId1" Type="${REL}/image" Target="../media/cira-logo.png"/></Relationships>`)
    files[`xl/worksheets/_rels/sheet${n}.xml.rels`] = strToU8(`${XML_HEAD}<Relationships ${RELS_NS}><Relationship Id="rId1" Type="${REL}/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>`)
    types = types.replace('</Types>', `<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`)
  })
  files['[Content_Types].xml'] = strToU8(types)
  return zipSync(files)
}

export async function downloadDailyWorkbook(date: string, sheets: DailySheetInput[], logoUrl: string): Promise<void> {
  const logo = await fetch(logoUrl).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
  const bytes = await buildDailyWorkbook(date, sheets, logo)
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `Daily_Reporting_${date}.xlsx`
  a.click()
  URL.revokeObjectURL(a.href)
}
