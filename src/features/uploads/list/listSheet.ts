import * as XLSX from 'xlsx'
import {
  LIST_COLUMNS, isAmbiguousMonth, matchHeaders, normId, normText, parseDate, parseFreq, parseMonth,
  type Cell, type ListRow,
} from './listParse'

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
}

type Sheet = XLSX.WorkSheet | Record<string, unknown>[][]

function cellAt(ws: Sheet, r: number, c: number): XLSX.CellObject | undefined {
  // Dense worksheets are arrays of rows; sparse ones are keyed by A1 address.
  if (Array.isArray(ws)) return (ws as unknown as XLSX.CellObject[][])[r]?.[c]
  return (ws as XLSX.WorkSheet)[XLSX.utils.encode_cell({ r, c })]
}

function plain(cell: XLSX.CellObject | undefined): Cell {
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

/** Parse one worksheet into cleaned rows. Only the columns we use are read. */
export function parseListSheet(ws: Sheet, onProgress?: (done: number, total: number) => void): ParsedList {
  const ref = Array.isArray(ws) ? undefined : (ws as XLSX.WorkSheet)['!ref']
  let rangeS = 0, rangeE = -1, colS = 0, colE = -1
  if (Array.isArray(ws)) {
    rangeE = ws.length - 1
    colE = Math.max(...ws.slice(0, 5).map((r) => (r ? r.length : 0))) - 1
  } else if (ref) {
    const range = XLSX.utils.decode_range(ref)
    rangeS = range.s.r; rangeE = range.e.r; colS = range.s.c; colE = range.e.c
  }
  const headers: string[] = []
  for (let c = colS; c <= colE; c++) headers.push(String(plain(cellAt(ws, rangeS, c)) ?? ''))
  const { index, missing } = matchHeaders(headers)
  const empty: ParsedList = {
    rows: [], excelRows: [], errors: [], totalRows: 0, duplicates: 0, divisionDates: 0, ambiguousMonths: 0, monthSamples: [],
    headers: headers.filter((h) => h.trim() !== ''), missing,
  }
  if (missing.length) return empty

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
  const total = rangeE - rangeS

  for (let r = rangeS + 1; r <= rangeE; r++) {
    const excelRow = r + 1
    // Skip fully blank rows.
    let any = false
    for (const c of LIST_COLUMNS) {
      if (get(r, c.key) !== null) { any = true; break }
    }
    if (!any) continue
    totalRows++

    // The RAW cell value (cell.v) is parsed; the displayed text (cell.w) is only shown for comparison.
    const rawMonth = get(r, 'month')
    const month = parseMonth(rawMonth)
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
    const line = normText(get(r, 'line'))
    const empCode = normId(get(r, 'emp_code'))
    const accountId = normId(get(r, 'account_id'))
    const doctorId = normId(get(r, 'doctor_id'))
    const doctorName = normText(get(r, 'doctor_name'))
    const freq = parseFreq(get(r, 'freq'))

    const problems: string[] = []
    if (!month) problems.push(get(r, 'month') === null ? 'Month is blank' : 'Month is not a valid date')
    if (!line) problems.push('Line is blank')
    if (!empCode) problems.push('Emp. Code is blank')
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
      emp_code: empCode as string,
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
    if (onProgress && (r - rangeS) % 5000 === 0) onProgress(r - rangeS, total)
  }
  onProgress?.(total, total)
  return { rows, excelRows, errors, totalRows, duplicates, divisionDates, ambiguousMonths, monthSamples, headers: empty.headers, missing: [] }
}
