type Cell = string | number | Date | null

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
