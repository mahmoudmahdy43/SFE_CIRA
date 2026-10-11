/** Download flat records as a single-sheet .xlsx (xlsx is loaded on demand). Null cells stay empty. */
export async function downloadXlsx(filename: string, sheet: string, rows: Record<string, string | number | null>[]): Promise<void> {
  if (rows.length === 0) return
  const XLSX = await import('xlsx')
  const headers = Object.keys(rows[0])
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers })
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length, 10) + 2 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31))
  XLSX.writeFile(wb, filename)
}
