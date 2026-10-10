/**
 * Pure normalisation helpers for the Target List upload (no DOM, no Worker) so they can be unit-tested.
 * Dates are handled with UTC arithmetic only — never local-time Date conversion.
 */

export type Cell = string | number | null

export interface ListRow {
  month: string
  line: string
  emp_code: string
  account_id: string
  doctor_id: string
  account_name: string | null
  doctor_name: string
  account_type: string | null
  speciality: string | null
  class: string | null
  brick: string | null
  division: string | null
  freq: number
  active_from: string | null
}

export interface ColumnSpec {
  key: keyof ListRow
  /** Header shown in the template / error messages. */
  label: string
  required: boolean
  /** Extra accepted spellings (compared after header normalisation). */
  aliases?: string[]
}

export const LIST_COLUMNS: ColumnSpec[] = [
  { key: 'month', label: 'Month', required: true },
  { key: 'line', label: 'Line', required: true },
  { key: 'emp_code', label: 'Emp. Code', required: true },
  { key: 'account_id', label: 'Account ID', required: true },
  { key: 'doctor_id', label: 'Doctor Id', required: true },
  { key: 'doctor_name', label: 'Doctor Name', required: true },
  { key: 'freq', label: 'Freq.', required: true },
  { key: 'account_name', label: 'Account Name', required: false },
  { key: 'account_type', label: 'Account Type', required: false },
  { key: 'speciality', label: 'Speciality', required: false, aliases: ['specialty'] },
  { key: 'class', label: 'Class', required: false },
  { key: 'brick', label: 'Brick', required: false },
  { key: 'division', label: 'Division', required: false },
  { key: 'active_from', label: 'Active From', required: false },
]

/** Columns that exist in the company export but are deliberately never read. */
export const IGNORED_HEADERS = ['USERNAME', 'District', 'DM', 'Emp. Name', 'No of Visits']

/** "Freq." / " freq " / "Emp. Code" / "emp_code" -> "freq" / "empcode". */
export function normHeader(h: unknown): string {
  return String(h ?? '')
    .toLowerCase()
    .replace(/[\s._-]+/g, '')
}

export function matchHeaders(headers: string[]): { index: Partial<Record<keyof ListRow, number>>; missing: string[] } {
  const byNorm = new Map<string, number>()
  headers.forEach((h, i) => {
    const n = normHeader(h)
    if (n && !byNorm.has(n)) byNorm.set(n, i)
  })
  const index: Partial<Record<keyof ListRow, number>> = {}
  const missing: string[] = []
  for (const c of LIST_COLUMNS) {
    const names = [c.label, ...(c.aliases ?? [])].map(normHeader)
    const hit = names.find((n) => byNorm.has(n))
    if (hit !== undefined) index[c.key] = byNorm.get(hit)
    else if (c.required) missing.push(c.label)
  }
  return { index, missing }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Excel serial (1900 system) -> 'YYYY-MM-DD' using UTC parts only; time fraction is dropped. */
export function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Any supported month spelling -> first day of that month as 'YYYY-MM-01', or null. */
export function parseMonth(v: Cell): string | null {
  if (v === null) return null
  if (typeof v === 'number') {
    const iso = serialToIso(v)
    return iso ? `${iso.slice(0, 7)}-01` : null
  }
  const s = v.trim()
  if (s === '') return null
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?:[T\s].*)?$/.exec(s)
  if (m) {
    const mo = Number(m[2])
    return mo >= 1 && mo <= 12 ? `${m[1]}-${pad2(mo)}-01` : null
  }
  m = /^([a-zA-Z]{3,9})[\s\-/.,]+(\d{4})$/.exec(s) // Oct-2026, October 2026
  if (m) {
    const idx = MONTH_NAMES.indexOf(m[1].slice(0, 3).toLowerCase())
    return idx >= 0 ? `${m[2]}-${pad2(idx + 1)}-01` : null
  }
  m = /^(\d{4})[\s\-/.,]+([a-zA-Z]{3,9})$/.exec(s) // 2026 Oct
  if (m) {
    const idx = MONTH_NAMES.indexOf(m[2].slice(0, 3).toLowerCase())
    return idx >= 0 ? `${m[1]}-${pad2(idx + 1)}-01` : null
  }
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(s) // 10/2026
  if (m) {
    const mo = Number(m[1])
    return mo >= 1 && mo <= 12 ? `${m[2]}-${pad2(mo)}-01` : null
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s) // dd/mm/yyyy
  if (m) {
    const mo = Number(m[2])
    return mo >= 1 && mo <= 12 ? `${m[3]}-${pad2(mo)}-01` : null
  }
  if (/^\d+(\.\d+)?$/.test(s)) return parseMonth(Number(s))
  return null
}

/** Date cell -> 'YYYY-MM-DD' or null (empty / unparseable). */
export function parseDate(v: Cell): string | null {
  if (v === null) return null
  if (typeof v === 'number') return serialToIso(v)
  const s = v.trim()
  if (s === '') return null
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s)
  if (m) return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s)
  if (m) return `${m[3]}-${pad2(Number(m[2]))}-${pad2(Number(m[1]))}`
  if (/^\d+(\.\d+)?$/.test(s)) return serialToIso(Number(s))
  return null
}

/** IDs: numbers become plain digit strings (no ".0", no exponent); text is trimmed, leading zeros kept. */
export function normId(v: Cell): string | null {
  if (v === null) return null
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    if (Number.isInteger(v)) return v.toLocaleString('fullwide', { useGrouping: false })
    return String(v)
  }
  const s = v.trim()
  if (s === '') return null
  return /^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, '') : s
}

export function normText(v: Cell): string | null {
  if (v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

export type FreqResult = { ok: true; value: number } | { ok: false }
export function parseFreq(v: Cell): FreqResult {
  if (v === null) return { ok: true, value: 0 }
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/,/g, ''))
  if (typeof v === 'string' && v.trim() === '') return { ok: true, value: 0 }
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return { ok: false }
  return { ok: true, value: n }
}

export function chunkRows<T>(rows: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

/** Excel row number of a server-rejected row: index inside the chunk -> original sheet row. */
export function excelRowOf(excelRows: number[], chunkIndex: number, chunkSize: number, i: number): number | undefined {
  return excelRows[chunkIndex * chunkSize + i]
}
