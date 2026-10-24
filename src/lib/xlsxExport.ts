type Cell = string | number | Date | null

export interface StyledSheet {
  name: string
  rows: Record<string, Cell>[]
  /** Cells to fill red, keyed `${dataRowIndex}|${header}` (dataRowIndex is 0-based, the header row excluded). */
  redCells?: Set<string>
}

/**
 * Like downloadXlsx, but several sheets with per-cell styling: header row bold + grey, flagged cells filled red.
 * Plain SheetJS cannot write cell styles, so this loads the `xlsx-js-style` fork (same API), on demand.
 */
export async function downloadXlsxStyled(filename: string, sheets: StyledSheet[]): Promise<void> {
  const used = sheets.filter((s) => s.rows.length > 0)
  if (used.length === 0) return
  const mod = await import('xlsx-js-style')
  const XLSX = mod.default ?? (mod as unknown as typeof mod.default)
  const wb = XLSX.utils.book_new()
  const RED = { fill: { patternType: 'solid', fgColor: { rgb: 'FECACA' } }, font: { color: { rgb: '991B1B' }, bold: true } }
  const HEAD = { fill: { patternType: 'solid', fgColor: { rgb: 'E5E7EB' } }, font: { bold: true } }
  const style = (ws: Record<string, unknown>, addr: string, s: object) => {
    const cell = ws[addr] as { s?: object } | undefined
    if (cell) cell.s = s
  }
  for (const sheet of used) {
    const headers = Object.keys(sheet.rows[0])
    const ws = XLSX.utils.json_to_sheet(sheet.rows, { header: headers }) as unknown as Record<string, unknown>
    headers.forEach((h, c) => {
      style(ws, XLSX.utils.encode_cell({ r: 0, c }), HEAD)
      sheet.rows.forEach((_, r) => {
        if (sheet.redCells?.has(`${r}|${h}`)) style(ws, XLSX.utils.encode_cell({ r: r + 1, c }), RED)
      })
    })
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length, 10) + 2 }))
    XLSX.utils.book_append_sheet(wb, ws as never, sheet.name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}

/** Download flat records as an .xlsx (xlsx is loaded on demand). Null cells stay empty; Date cells show as dd-mmm. Extra sheets are optional. */
export async function downloadXlsx(
  filename: string,
  sheet: string,
  rows: Record<string, Cell>[],
  extraSheets: { name: string; rows: Record<string, Cell>[] }[] = [],
): Promise<void> {
  if (rows.length === 0) return
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const s of [{ name: sheet, rows }, ...extraSheets]) {
    if (s.rows.length === 0) continue
    const headers = Object.keys(s.rows[0])
    const ws = XLSX.utils.json_to_sheet(s.rows, { header: headers, dateNF: 'dd-mmm' })
    // real dates: hire dates show as dd-mmm-yyyy, other dates as dd-mmm
    const hireCol = headers.indexOf('Hire Date')
    for (const addr of Object.keys(ws)) {
      if (addr[0] === '!') continue
      const c = ws[addr]
      if (c.t === 'd') c.z = XLSX.utils.decode_cell(addr).c === hireCol ? 'dd-mmm-yyyy' : 'dd-mmm'
    }
    ws['!cols'] = headers.map((h) => ({ wch: h.endsWith('Dates') ? 40 : Math.max(h.length, 10) + 2 }))
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}

export interface GridSheetCell { v: string | number | null; s?: Record<string, unknown>; z?: string }
export interface GridSheet {
  name: string
  cells: GridSheetCell[][]
  merges?: { s: { r: number; c: number }; e: { r: number; c: number } }[]
  widths?: number[]
  /** Row heights in points (undefined = default). */
  heights?: (number | undefined)[]
  /** Freeze panes: this many top rows and left columns stay in view. */
  freeze?: { rows: number; cols: number }
  /** AutoFilter on one header row (0-based `row`) over columns fromCol..toCol, down to `lastRow`. */
  autofilter?: { row: number; fromCol: number; toCol: number; lastRow: number }
}

type XlsxLib = Pick<typeof import('xlsx-js-style'), 'utils'>

function gridToWorksheet(XLSX: XlsxLib, sheet: GridSheet): Record<string, unknown> {
  const ws: Record<string, unknown> = {}
  let maxC = 0
  sheet.cells.forEach((row, r) => {
    row.forEach((cell, c) => {
      maxC = Math.max(maxC, c)
      if (cell.v === null && !cell.s) return
      const out: Record<string, unknown> =
        typeof cell.v === 'number' ? { t: 'n', v: cell.v } : { t: 's', v: cell.v ?? '' }
      if (cell.z) out.z = cell.z
      if (cell.s) out.s = cell.s
      ws[XLSX.utils.encode_cell({ r, c })] = out
    })
  })
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sheet.cells.length - 1, c: maxC } })
  if (sheet.merges?.length) ws['!merges'] = sheet.merges
  if (sheet.widths) ws['!cols'] = sheet.widths.map((wch) => ({ wch }))
  if (sheet.heights) ws['!rows'] = sheet.heights.map((h) => (h ? { hpt: h } : {}))
  if (sheet.autofilter) {
    const a = sheet.autofilter
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: a.row, c: a.fromCol }, e: { r: a.lastRow, c: a.toCol } }) }
  }
  if (sheet.freeze) {
    const { rows, cols } = sheet.freeze
    ws['!freeze'] = { xSplit: String(cols), ySplit: String(rows), topLeftCell: XLSX.utils.encode_cell({ r: rows, c: cols }), activePane: 'bottomRight', state: 'frozen' }
  }
  return ws
}


/**
 * One sheet laid out cell by cell (bands, merged groups, per-cell fill / font / number format), for reports whose
 * Excel file should look like the screen. Uses the `xlsx-js-style` fork (plain SheetJS cannot write cell styles).
 */
export async function downloadXlsxGrid(filename: string, sheet: GridSheet): Promise<void> {
  await downloadXlsxGrids(filename, [sheet])
}

/** Several cell-by-cell sheets in one workbook (same styling as downloadXlsxGrid). Empty sheets are skipped. */
export async function downloadXlsxGrids(filename: string, sheets: GridSheet[], flatSheets: { name: string; rows: Record<string, Cell>[] }[] = []): Promise<void> {
  const used = sheets.filter((s) => s.cells.length > 0)
  if (used.length === 0) return
  const mod = await import('xlsx-js-style')
  const XLSX = mod.default ?? (mod as unknown as typeof mod.default)
  const wb = XLSX.utils.book_new()
  for (const sheet of used) XLSX.utils.book_append_sheet(wb, gridToWorksheet(XLSX, sheet) as never, sheet.name.slice(0, 31))
  // plain record sheets (e.g. a detail list) after the grids; Date cells show as dd-mmm
  for (const f of flatSheets) {
    if (f.rows.length === 0) continue
    const ws = XLSX.utils.json_to_sheet(f.rows, { header: Object.keys(f.rows[0]), dateNF: 'dd-mmm' })
    for (const addr of Object.keys(ws)) if (addr[0] !== '!' && ws[addr].t === 'd') ws[addr].z = 'dd-mmm'
    ws['!cols'] = Object.keys(f.rows[0]).map((h) => ({ wch: Math.max(h.length, 10) + 2 }))
    XLSX.utils.book_append_sheet(wb, ws, f.name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}

/**
 * Plain tables, one sheet each, with a bold grey header, a filter on the header row and the header frozen.
 * Column widths follow the content (capped); a column named "...dates" is wide.
 */
export async function downloadXlsxTables(filename: string, sheets: { name: string; rows: Record<string, Cell>[] }[]): Promise<void> {
  const used = sheets.filter((s) => s.rows.length > 0)
  if (used.length === 0) return
  const [mod, fflate] = await Promise.all([import('xlsx-js-style'), import('fflate')])
  const XLSX = mod.default ?? (mod as unknown as typeof mod.default)
  const wb = XLSX.utils.book_new()
  const HEAD = { fill: { patternType: 'solid', fgColor: { rgb: 'E5E7EB' } }, font: { bold: true }, alignment: { vertical: 'center', wrapText: true } }
  for (const sheet of used) {
    const headers = Object.keys(sheet.rows[0])
    const ws = XLSX.utils.json_to_sheet(sheet.rows, { header: headers }) as unknown as Record<string, unknown>
    headers.forEach((_, c) => { const cell = ws[XLSX.utils.encode_cell({ r: 0, c })] as { s?: object } | undefined; if (cell) cell.s = HEAD })
    ws['!cols'] = headers.map((h) => {
      const longest = sheet.rows.reduce((a, r) => Math.max(a, String(r[h] ?? '').length), h.length)
      return { wch: /dates$/i.test(h) ? 70 : Math.min(48, Math.max(10, longest + 2)) }
    })
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sheet.rows.length, c: headers.length - 1 } }) }
    XLSX.utils.book_append_sheet(wb, ws as never, sheet.name.slice(0, 31))
  }
  // freeze the header row: SheetJS has no option for it, so the sheet views are patched in the file
  const raw = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const files = fflate.unzipSync(new Uint8Array(raw))
  for (const name of Object.keys(files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue
    let xml = fflate.strFromU8(files[name])
    const pane = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
    if (/<sheetView[^>]*\/>/.test(xml)) xml = xml.replace(/<sheetView([^>]*)\/>/, `<sheetView$1>${pane}</sheetView>`)
    else if (!/<sheetViews>/.test(xml)) xml = xml.replace('<sheetData', `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetData`)
    files[name] = fflate.strToU8(xml)
  }
  const blob = new Blob([fflate.zipSync(files) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
