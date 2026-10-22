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

// pt: banner 3 x 22.5 = 90 px, 16 px gap, cards 3 x 28 = 112 px, 16 px gap, then the table header
const HEIGHTS = [22.5, 22.5, 22.5, 12, 28, 28, 28, 12, 24]
const HEADER_ROW = 8

/** One CIRA sheet laid out like "MRs Reporting Status": banner, nine cards, then the table (banner and cards are drawn, see drawingXml). */
export function buildDailySheet(input: DailySheetInput) {
  const { rows, comments } = input
  const cells: Cell[][] = []
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = []
  const put = (r: number, c: number, cell: Cell) => {
    while (cells.length <= r) cells.push([])
    for (let i = cells[r].length; i < 10; i++) cells[r][i] = { v: null }
    cells[r][c] = cell
  }
  for (let r = 0; r < HEADER_ROW; r++) for (let c = 0; c < 10; c++) put(r, c, { v: null })

  // rows 4-8: light green strip; the banner (rows 1-3) and the nine cards (rows 5-7) are drawing shapes
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
  return { name: `CIRA ${input.line}`, cells, merges, widths: WIDTHS, heights }
}

/* ------------------------------ workbook + logo / print setup ------------------------------ */
const NS_DRAWING = 'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const RELS_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/* ------------------------------ drawing: banner, logo, date, nine cards ------------------------------ */
const PX = 9525 // EMU per pixel
/** Excel column width (the width attribute that SheetJS writes for a width in characters) as pixels. */
const colPx = (wch: number): number => Math.trunc(((256 * (wch + 0.83203125) + 18) / 256) * 7)
export const SHEET_PX = WIDTHS.reduce((a, w) => a + colPx(w), 0)
export const BANNER_PX = 90, CARD_GAP_PX = 10, CARD_H_PX = 112, CARD_TITLE_PX = 26, LOGO_PX = 70, LOGO_INSET_PX = 14

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
let shapeId = 10

interface Box { x: number; y: number; w: number; h: number }
const xfrm = (b: Box) => `<a:xfrm><a:off x="${Math.round(b.x * PX)}" y="${Math.round(b.y * PX)}"/><a:ext cx="${Math.round(b.w * PX)}" cy="${Math.round(b.h * PX)}"/></a:xfrm>`

/** One autoshape inside a group: optional fill / outline, optional centred text. */
function shape(name: string, prst: 'rect' | 'roundRect', b: Box, o: { fill?: string; line?: string; lineW?: number; adj?: number; text?: string; sz?: number; color?: string; bold?: boolean }): string {
  const geom = `<a:prstGeom prst="${prst}"><a:avLst>${prst === 'roundRect' ? `<a:gd name="adj" fmla="val ${o.adj ?? 12000}"/>` : ''}</a:avLst></a:prstGeom>`
  const fillX = o.fill ? `<a:solidFill><a:srgbClr val="${o.fill}"/></a:solidFill>` : '<a:noFill/>'
  const lineX = o.line ? `<a:ln w="${o.lineW ?? 12700}"><a:solidFill><a:srgbClr val="${o.line}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>'
  const run = o.text === undefined
    ? '<a:endParaRPr lang="en-US"/>'
    : `<a:r><a:rPr lang="en-US" sz="${o.sz ?? 1000}" b="${o.bold === false ? 0 : 1}"><a:solidFill><a:srgbClr val="${o.color ?? 'FFFFFF'}"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${esc(o.text)}</a:t></a:r>`
  return `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${shapeId++}" name="${esc(name)}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr>${xfrm(b)}${geom}${fillX}${lineX}</xdr:spPr><xdr:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>${run}</a:p></xdr:txBody></xdr:sp>`
}

/** A group stretched over whole cells (column A to the end of J, rows r0 to r1), so it always matches the table width; children use pixel offsets of a w x h design. */
function group(name: string, r0: number, r1: number, w: number, h: number, children: string): string {
  const ext = `<a:off x="0" y="0"/><a:ext cx="${w * PX}" cy="${h * PX}"/><a:chOff x="0" y="0"/><a:chExt cx="${w * PX}" cy="${h * PX}"/>`
  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r0}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="${shapeId++}" name="${name}"/><xdr:cNvGrpSpPr/></xdr:nvGrpSpPr><xdr:grpSpPr><a:xfrm>${ext}</a:xfrm></xdr:grpSpPr>${children}</xdr:grpSp><xdr:clientData/></xdr:twoCellAnchor>`
}

/** The logo: a rounded white square and the picture inside it, anchored by pixels from A1 so they keep their 1:1 shape. */
function logoAnchors(withLogo: boolean): string {
  const top = (BANNER_PX - LOGO_PX) / 2
  const at = (x: number, y: number, w: number, h: number, body: string) =>
    `<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>${Math.round(x * PX)}</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${Math.round(y * PX)}</xdr:rowOff></xdr:from><xdr:ext cx="${w * PX}" cy="${h * PX}"/>${body}<xdr:clientData/></xdr:oneCellAnchor>`
  const box = shape('Logo box', 'roundRect', { x: 0, y: 0, w: LOGO_PX, h: LOGO_PX }, { fill: 'FFFFFF', adj: 10000 })
  const pic = `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${shapeId++}" name="CIRA logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr>${xfrm({ x: 0, y: 0, w: LOGO_PX - 10, h: LOGO_PX - 10 })}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`
  return at(LOGO_INSET_PX, top, LOGO_PX, LOGO_PX, box) + (withLogo ? at(LOGO_INSET_PX + 5, top + 5, LOGO_PX - 10, LOGO_PX - 10, pic) : '')
}

/** Banner: rounded green bar with the title and the date box on the right (the logo is drawn on top, see logoAnchors). */
function bannerGroup(line: number, date: string): string {
  const W = SHEET_PX, H = BANNER_PX
  const dateText = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  const dw = 210, dx = W - LOGO_INSET_PX - dw
  return group('Banner', 0, 3, W, H,
    shape('Banner bar', 'roundRect', { x: 0, y: 0, w: W, h: H }, { fill: GREEN, adj: 14000, text: `CIRA ${line} - MEDICAL REP DAILY PERFORMANCE`, sz: 1800 }) +
    shape('Date label', 'rect', { x: dx, y: 12, w: dw, h: 20 }, { text: 'Date', sz: 1000 }) +
    shape('Date box', 'rect', { x: dx, y: 34, w: dw, h: 30 }, { fill: 'FFFFFF', line: '000000', lineW: 19050, text: dateText, sz: 1100, color: '000000', bold: false }))
}

const CARD_DEFS: { label: string; color: string; value: (c: Cards) => string; sz?: number }[] = [
  { label: 'ACTIVE REPS', color: '2E8B57', value: (c) => String(c.active) },
  { label: 'REPORTED DAY', color: '2E8B57', value: (c) => String(c.reported) },
  { label: 'UNREPORTED DAY', color: 'C00000', value: (c) => String(c.unreported) },
  { label: 'FOLLOW UP REQ.', color: 'ED7D31', value: (c) => String(c.followUp) },
  { label: 'AVG. PM CALL RATE', color: '4A90A4', value: (c) => fmtAvg(c.avgPm) },
  { label: 'AVG. PHARMACIES C. RATE', color: '339933', value: (c) => fmtAvg(c.avgPharmacy), sz: 750 },
  { label: 'TOTAL VACATIONS', color: 'C0392B', value: (c) => String(c.vacations) },
  { label: 'TOTAL OFFICE WORK', color: '339933', value: (c) => String(c.office) },
  { label: 'TOTAL ACTIVITIES', color: '4A90A4', value: (c) => String(c.activities) },
]

/** Nine equal cards across the full sheet width: coloured title bar, white rounded box with the number, grey shadow. */
function cardsGroup(c: Cards): string {
  const n = CARD_DEFS.length
  const cw = (SHEET_PX - (n - 1) * CARD_GAP_PX) / n
  const shadow = 3, title = CARD_TITLE_PX
  const parts = CARD_DEFS.map((k, i) => {
    const x = i * (cw + CARD_GAP_PX)
    const w = cw - shadow
    return (
      shape(`${k.label} shadow`, 'roundRect', { x: x + shadow, y: title + 3 + shadow, w, h: CARD_H_PX - title - 3 - shadow }, { fill: 'B0B0B0', adj: 12000 }) +
      shape(`${k.label} value`, 'roundRect', { x, y: title + 3, w, h: CARD_H_PX - title - 3 - shadow }, { fill: 'FFFFFF', line: 'DDDDDD', adj: 12000, text: k.value(c), sz: 2400, color: '000000' }) +
      shape(`${k.label} title`, 'rect', { x, y: 0, w, h: title }, { fill: k.color, text: k.label, sz: k.sz ?? 850 })
    )
  })
  return group('KPI cards', 4, 7, SHEET_PX, CARD_H_PX, parts.join(''))
}

/** Banner and cards in one drawing (the logo picture is inside the banner group). */
const drawingXml = (line: number, date: string, c: Cards, withLogo: boolean) => {
  shapeId = 10
  return `${XML_HEAD}<xdr:wsDr ${NS_DRAWING}>${bannerGroup(line, date)}${logoAnchors(withLogo)}${cardsGroup(c)}</xdr:wsDr>`
}

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
    const g = buildDailySheet(input)
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
    files[`xl/drawings/drawing${n}.xml`] = strToU8(drawingXml(input.line, date, computeCards(input.rows), withLogo))
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
