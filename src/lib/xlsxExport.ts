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
export async function downloadXlsxGrids(filename: string, sheets: GridSheet[]): Promise<void> {
  const used = sheets.filter((s) => s.cells.length > 0)
  if (used.length === 0) return
  const mod = await import('xlsx-js-style')
  const XLSX = mod.default ?? (mod as unknown as typeof mod.default)
  const wb = XLSX.utils.book_new()
  for (const sheet of used) XLSX.utils.book_append_sheet(wb, gridToWorksheet(XLSX, sheet) as never, sheet.name.slice(0, 31))
  XLSX.writeFile(wb, filename)
}
