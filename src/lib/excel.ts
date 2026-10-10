import * as XLSX from 'xlsx'

export type Cell = string | number | null

export interface SheetRead {
  /** Wanted column name -> value, one object per data row. Only wanted columns are ever read. */
  rows: Record<string, Cell>[]
  /** Wanted columns that were not found in the header row. */
  missing: string[]
}

export function openWorkbook(buf: ArrayBuffer): XLSX.WorkBook {
  // cellDates stays false: dates arrive as serial numbers or text, never timezone-shifted Date objects.
  return XLSX.read(buf, { type: 'array' })
}

const key = (s: unknown) => String(s ?? '').trim().toLowerCase()

/**
 * Read ONLY the requested columns of a sheet. The header row is scanned to locate the columns;
 * cells of every other column (e.g. a "Password" column) are never read.
 * `wanted` maps output name -> accepted header spellings.
 */
export function readColumns(ws: XLSX.WorkSheet | undefined, wanted: Record<string, string[]>): SheetRead {
  if (!ws || !ws['!ref']) return { rows: [], missing: Object.keys(wanted) }
  const range = XLSX.utils.decode_range(ws['!ref'])
  const colOf = new Map<string, number>()
  for (let c = range.s.c; c <= range.e.c; c++) {
    const h = ws[XLSX.utils.encode_cell({ r: range.s.r, c })]
    if (h) colOf.set(key(h.v), c)
  }
  const index: Record<string, number> = {}
  const missing: string[] = []
  for (const [out, names] of Object.entries(wanted)) {
    const hit = names.map(key).find((n) => colOf.has(n))
    if (hit === undefined) missing.push(out)
    else index[out] = colOf.get(hit) as number
  }
  const rows: Record<string, Cell>[] = []
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const row: Record<string, Cell> = {}
    let any = false
    for (const [out, c] of Object.entries(index)) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      let v: Cell = null
      if (cell && cell.v !== undefined && cell.v !== null && cell.v !== '') {
        v = typeof cell.v === 'number' ? cell.v : String(cell.v).trim()
        if (v === '') v = null
      }
      if (v !== null) any = true
      row[out] = v
    }
    if (any) rows.push(row)
  }
  return { rows, missing }
}

export function text(v: Cell): string | null {
  if (v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * Excel serial number or ISO-like string -> 'YYYY-MM-DD' (calendar date only; any time-of-day
 * artifact such as 03:00 is dropped, no timezone shifting).
 */
export function toIsoDate(v: Cell): string | null {
  if (v === null) return null
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 1) return null
    const ms = Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000
    return new Date(ms).toISOString().slice(0, 10)
  }
  const s = v.trim()
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  if (/^\d+(\.\d+)?$/.test(s)) return toIsoDate(Number(s))
  return null
}
