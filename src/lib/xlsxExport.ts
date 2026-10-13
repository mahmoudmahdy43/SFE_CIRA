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
    ws['!cols'] = headers.map((h) => ({ wch: h === 'Dates' ? 60 : Math.max(h.length, 10) + 2 }))
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}
