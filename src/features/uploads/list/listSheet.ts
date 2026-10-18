import * as XLSX from 'xlsx'
import {
  LIST_COLUMNS, isAmbiguousMonth, listKey, matchHeaders, normHeader, normId, normText, parseDate, parseFreq, parseMonth,
  type Cell, type ListRow,
} from './listParse.ts'

export interface RowError { excelRow: number; reason: string }

export interface MonthSample {
  excelRow: number
  /** Raw cell value (cell.v) as stored in the file. */
  raw: string
  /** Cell type: number (Excel serial) or text. */
  type: 'number' | 'text' | 'empty'
  /** Text Excel displays for the cell (for comparison only; never used for parsing). */
  shown: string
  parsed: string | null
}

/** One row of a Speciality file, already reduced to what the join needs. */
export interface SpecEntry { key: string; specialty: string | null }

/** What the merge step keeps from the dropped files until the Month is known (see listJoin.ts). */
export interface CrmRaw {
  /** Main-list files, in the order their rows were concatenated. */
  mains: { name: string; lines: string[]; rows: number; hasMonth: boolean }[]
  specs: { name: string; entries: SpecEntry[]; skipped: number }[]
}

export interface CrmFileInfo {
  name: string
  kind: 'main' | 'speciality'
  /** Main file: its line(s). Speciality file: the line of the main rows it matched (it has no Line column). */
  line: string | null
  rows: number
  /** Speciality file only: rows matching nothing in the main lists. */
  unmatched?: number
  /** Speciality file only: rows without Account ID / Doctor ID (ignored). */
  skipped?: number
}

export interface CrmLineStat {
  line: string
  rows: number
  /** Rows still without a Speciality after the join. */
  noSpeciality: number
  /** Rows with no match in any Speciality file. */
  noMatch: number
}

export interface CrmInfo {
  /** False when the drop was only old-format files: the wizard then shows nothing new. */
  show: boolean
  files: CrmFileInfo[]
  lines: CrmLineStat[]
  /** Rows without a Speciality after the join (for the "Download list" Excel). */
  noSpecRows: ListRow[]
  /** Speciality-file rows that match nothing in the main lists. */
  specNoMatch: number
  /** Main-list rows with no match in the Speciality files. */
  mainNoMatch: number
  /** Same doctor listed with two different specialities across Speciality files (the first one is used). */
  specConflicts: number
  specFiles: number
}

export interface ParsedList {
  rows: ListRow[]
  /** excelRows[k] = 1-based sheet row of rows[k] (after de-duplication). */
  excelRows: number[]
  errors: RowError[]
  totalRows: number
  duplicates: number
  divisionDates: number
  /** Month values like 3/4/2026 that could be read two ways (day-first was used). */
  ambiguousMonths: number
  /** Raw Month cell of the first data rows, so the owner can verify what was read. */
  monthSamples: MonthSample[]
  headers: string[]
  missing: string[]
  /** 'main' (old single-file format or CRM main list) or 'speciality'. Absent = 'main'. */
  fileKind?: 'main' | 'speciality'
  /** True when some rows have no Month column: the wizard asks for one Month for them. */
  needsMonth?: boolean
  /** Set by the merge step when the dropped files cannot be used; shown instead of a preview. */
  fatal?: string
  /** Speciality file only. */
  specs?: SpecEntry[]
  specSkipped?: number
  /** Merge step output (before the Month is chosen) and the finished join summary. */
  crmRaw?: CrmRaw
  crm?: CrmInfo
}

export type Sheet = XLSX.WorkSheet | Record<string, unknown>[][]

export function cellAt(ws: Sheet, r: number, c: number): XLSX.CellObject | undefined {
  // Dense worksheets are arrays of rows; sparse ones are keyed by A1 address.
  if (Array.isArray(ws)) return (ws as unknown as XLSX.CellObject[][])[r]?.[c]
  return (ws as XLSX.WorkSheet)[XLSX.utils.encode_cell({ r, c })]
}

export function plain(cell: XLSX.CellObject | undefined): Cell {
  if (!cell || cell.v === undefined || cell.v === null) return null
  if (typeof cell.v === 'number') return cell.v
  if (typeof cell.v === 'boolean') return cell.v ? '1' : '0'
  const s = String(cell.v).trim()
  return s === '' ? null : s
}

/** A Division cell that Excel turned into a date: use its displayed text instead. */
function divisionText(cell: XLSX.CellObject | undefined): { text: string | null; wasDate: boolean } {
  if (!cell || cell.v === undefined || cell.v === null) return { text: null, wasDate: false }
  const isDate = cell.t === 'd' || (cell.t === 'n' && typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z))
  if (isDate) {
    const w = (cell.w ?? '').trim()
    return { text: w === '' ? null : w, wasDate: true }
  }
  return { text: normText(plain(cell)), wasDate: false }
}

interface Bounds { rowS: number; rowE: number; colS: number; colE: number }

function boundsOf(ws: Sheet): Bounds {
  if (Array.isArray(ws)) {
    // Dense sheets keep absolute row numbers, so a blank first row is a hole in the array: never spread
    // the rows into Math.max (a hole would become undefined -> NaN).
    const widths = Array.from({ length: Math.min(12, ws.length) }, (_, i) => (ws[i] ? ws[i].length : 0))
    return { rowS: 0, rowE: ws.length - 1, colS: 0, colE: Math.max(0, ...widths) - 1 }
  }
  const ref = (ws as XLSX.WorkSheet)['!ref']
  if (!ref) return { rowS: 0, rowE: -1, colS: 0, colE: -1 }
  const range = XLSX.utils.decode_range(ref)
  return { rowS: range.s.r, rowE: range.e.r, colS: range.s.c, colE: range.e.c }
}

/** The CRM exports start with an empty row (or a title): the header is the first row, within the first 10, that has one of these cells. */
const HEADER_SCAN_ROWS = 10

function normRow(ws: Sheet, b: Bounds, r: number): string[] {
  const out: string[] = []
  for (let c = b.colS; c <= b.colE; c++) out.push(normHeader(plain(cellAt(ws, r, c))))
  return out
}

function findHeaderRow(ws: Sheet, b: Bounds, wanted: string): number {
  const last = Math.min(b.rowE, b.rowS + HEADER_SCAN_ROWS - 1)
  for (let r = b.rowS; r <= last; r++) {
    if (normRow(ws, b, r).includes(wanted)) return r
  }
  return -1
}

function headerLabels(ws: Sheet, b: Bounds, r: number): string[] {
  const out: string[] = []
  for (let c = b.colS; c <= b.colE; c++) out.push(String(plain(cellAt(ws, r, c)) ?? ''))
  return out
}

function emptyParsed(headers: string[], missing: string[]): ParsedList {
  return {
    rows: [], excelRows: [], errors: [], totalRows: 0, duplicates: 0, divisionDates: 0, ambiguousMonths: 0, monthSamples: [],
    headers: headers.filter((h) => h.trim() !== ''), missing,
  }
}

/**
 * Parse one worksheet. The type is read from the headers, never from the file name:
 *  - a row with `Acc.ID` (and no `Account ID` row) = Speciality file;
 *  - otherwise a main list (row with `Account ID`; the old single-file format has a Month column, the CRM export has none).
 */
export function parseListSheet(ws: Sheet, onProgress?: (done: number, total: number) => void): ParsedList {
  const b = boundsOf(ws)
  const rAcc = findHeaderRow(ws, b, 'accountid')
  const rSpec = findHeaderRow(ws, b, 'accid')
  if (rSpec >= 0 && rAcc < 0) return parseSpecialitySheet(ws, b, rSpec, onProgress)
  // No "Account ID" cell found: fall back to the first row so the usual "missing columns" message appears.
  return parseMainSheet(ws, b, rAcc >= 0 ? rAcc : b.rowS, onProgress)
}

/** Main list (old format or CRM export). Only the columns we use are read. */
function parseMainSheet(ws: Sheet, b: Bounds, headerRow: number, onProgress?: (done: number, total: number) => void): ParsedList {
  const { colS, rowE } = b
  const headers = headerLabels(ws, b, headerRow)
  const { index, missing } = matchHeaders(headers)
  const empty = emptyParsed(headers, missing)
  empty.fileKind = 'main'
  if (missing.length) return empty
  const hasMonth = index.month !== undefined

  const col = (key: keyof ListRow) => (index[key] === undefined ? undefined : colS + (index[key] as number))
  const get = (r: number, key: keyof ListRow): Cell => {
    const c = col(key)
    return c === undefined ? null : plain(cellAt(ws, r, c))
  }

  const rows: ListRow[] = []
  const excelRows: number[] = []
  const errors: RowError[] = []
  const seen = new Map<string, number>()
  let duplicates = 0
  let divisionDates = 0
  let ambiguousMonths = 0
  const monthSamples: MonthSample[] = []
  let totalRows = 0
  const total = rowE - headerRow

  for (let r = headerRow + 1; r <= rowE; r++) {
    const excelRow = r + 1
    // Skip fully blank rows.
    let any = false
    for (const c of LIST_COLUMNS) {
      if (get(r, c.key) !== null) { any = true; break }
    }
    if (!any) continue
    totalRows++

    // The RAW cell value (cell.v) is parsed; the displayed text (cell.w) is only shown for comparison.
    // Without a Month column the month stays '' here; the wizard's Month picker fills it in.
    const rawMonth = hasMonth ? get(r, 'month') : null
    const month = hasMonth ? parseMonth(rawMonth) : ''
    if (hasMonth) {
      if (isAmbiguousMonth(rawMonth)) ambiguousMonths++
      if (monthSamples.length < 3) {
        const mc = col('month')
        const mcell = mc === undefined ? undefined : cellAt(ws, r, mc)
        monthSamples.push({
          excelRow,
          raw: rawMonth === null ? '' : String(rawMonth),
          type: rawMonth === null ? 'empty' : typeof rawMonth === 'number' ? 'number' : 'text',
          shown: mcell?.w ?? '',
          parsed: month,
        })
      }
    }
    const line = normText(get(r, 'line'))
    const empCode = normId(get(r, 'emp_code'))
    const accountId = normId(get(r, 'account_id'))
    const doctorId = normId(get(r, 'doctor_id'))
    const doctorName = normText(get(r, 'doctor_name'))
    const freq = parseFreq(get(r, 'freq'))

    const problems: string[] = []
    if (hasMonth && !month) problems.push(rawMonth === null ? 'Month is blank' : 'Month is not a valid date')
    if (!line) problems.push('Line is blank')
    if (!accountId) problems.push('Account ID is blank')
    if (!doctorId) problems.push('Doctor Id is blank')
    if (!doctorName) problems.push('Doctor Name is blank')
    if (!freq.ok) problems.push('Freq. is not a whole number ≥ 0')
    if (problems.length) {
      errors.push({ excelRow, reason: problems.join('; ') })
      continue
    }

    const divCol = col('division')
    let division: string | null = null
    if (divCol !== undefined) {
      const d = divisionText(cellAt(ws, r, divCol))
      division = d.text
      if (d.wasDate) divisionDates++
    }

    const row: ListRow = {
      month: month as string,
      line: line as string,
      emp_code: empCode ?? '',
      account_id: accountId as string,
      doctor_id: doctorId as string,
      account_name: normText(get(r, 'account_name')),
      doctor_name: doctorName as string,
      account_type: normText(get(r, 'account_type')),
      speciality: normText(get(r, 'speciality')),
      class: normText(get(r, 'class')),
      brick: normText(get(r, 'brick')),
      division,
      freq: freq.ok ? freq.value : 0,
      active_from: parseDate(get(r, 'active_from')),
    }
    const key = `${row.month}|${row.account_id}|${row.doctor_id}`
    const prev = seen.get(key)
    if (prev !== undefined) {
      // Same doctor twice in the same month: the last occurrence wins.
      rows[prev] = row
      excelRows[prev] = excelRow
      duplicates++
    } else {
      seen.set(key, rows.length)
      rows.push(row)
      excelRows.push(excelRow)
    }
    if (onProgress && (r - headerRow) % 5000 === 0) onProgress(r - headerRow, total)
  }
  onProgress?.(total, total)
  return {
    rows, excelRows, errors, totalRows, duplicates, divisionDates, ambiguousMonths, monthSamples,
    headers: empty.headers, missing: [], fileKind: 'main', needsMonth: !hasMonth,
  }
}

/** Speciality file: only Type, Acc.ID, Doctor ID and Specialty are read; everything else is ignored. */
function parseSpecialitySheet(ws: Sheet, b: Bounds, headerRow: number, onProgress?: (done: number, total: number) => void): ParsedList {
  const { colS, rowE } = b
  const headers = headerLabels(ws, b, headerRow)
  const byNorm = new Map<string, number>()
  headers.forEach((h, i) => {
    const n = normHeader(h)
    if (n && !byNorm.has(n)) byNorm.set(n, i)
  })
  const iType = byNorm.get('type')
  const iAcc = byNorm.get('accid')
  const iDoc = byNorm.get('doctorid')
  const iSpec = byNorm.get('specialty') ?? byNorm.get('speciality')
  const missing: string[] = []
  if (iType === undefined) missing.push('Type')
  if (iAcc === undefined) missing.push('Acc.ID')
  if (iDoc === undefined) missing.push('Doctor ID')
  if (iSpec === undefined) missing.push('Specialty')
  const out = emptyParsed(headers, missing)
  out.fileKind = 'speciality'
  if (missing.length) return out

  const get = (r: number, i: number | undefined): Cell => (i === undefined ? null : plain(cellAt(ws, r, colS + i)))
  const specs: SpecEntry[] = []
  let skipped = 0
  let totalRows = 0
  const total = rowE - headerRow
  for (let r = headerRow + 1; r <= rowE; r++) {
    const type = normText(get(r, iType))
    const acc = normId(get(r, iAcc))
    const doc = normId(get(r, iDoc))
    const specialty = normText(get(r, iSpec))
    if (type === null && acc === null && doc === null && specialty === null) continue // blank row
    totalRows++
    if (acc === null || doc === null) { skipped++; continue }
    specs.push({ key: listKey(type, acc, doc), specialty })
    if (onProgress && (r - headerRow) % 5000 === 0) onProgress(r - headerRow, total)
  }
  onProgress?.(total, total)
  return { ...out, totalRows, specs, specSkipped: skipped, missing: [] }
}
