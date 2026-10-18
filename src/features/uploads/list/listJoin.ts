/**
 * Target List upload, CRM exports: merge the dropped files and join each doctor's Speciality.
 * Pure functions (no DOM, no Worker) so they can be unit-tested.
 *
 *   combineListFiles  every file already parsed by the worker  -> one result, Month still open
 *   finalizeList      + the Month chosen in the wizard           -> de-duplicated, speciality joined, stats
 */
import { listKey, type ListRow } from './listParse.ts'
import type { CrmFileInfo, CrmInfo, CrmLineStat, CrmRaw, ParsedList, RowError, SpecEntry } from './listSheet.ts'

export interface NamedParse { name: string; parsed: ParsedList }

const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
const kindOf = (p: ParsedList) => p.fileKind ?? 'main'
const distinctLines = (rows: ListRow[]) => [...new Set(rows.map((r) => r.line))].sort(natural)

function fatal(message: string): ParsedList {
  return {
    rows: [], excelRows: [], errors: [], totalRows: 0, duplicates: 0, divisionDates: 0, ambiguousMonths: 0, monthSamples: [],
    headers: [], missing: [], fatal: message,
  }
}

/**
 * Merge what the worker returned for each dropped file. A single main-list file that has its own Month column
 * (the old format) is returned untouched, so that path behaves exactly as before.
 */
export function combineListFiles(files: NamedParse[]): ParsedList {
  const mains = files.filter((f) => kindOf(f.parsed) === 'main')
  const specFiles = files.filter((f) => kindOf(f.parsed) === 'speciality')
  if (files.length === 1 && mains.length === 1 && !mains[0].parsed.needsMonth) return mains[0].parsed

  const problems: string[] = []
  for (const f of files) {
    const p = f.parsed
    if (p.missing.length === 0) continue
    if (kindOf(p) === 'speciality') {
      problems.push(`${f.name}: Speciality file is missing column(s): ${p.missing.join(', ')}.`)
    } else {
      problems.push(`${f.name}: not recognised as a main list or a Speciality file — missing required column(s): ${p.missing.join(', ')}.\n  Found: ${p.headers.slice(0, 15).join(', ') || '(no headers)'}`)
    }
  }
  if (problems.length > 0) return fatal(problems.join('\n'))
  if (mains.length === 0) return fatal('Only Speciality file(s) were dropped. Drop the main list file(s) together with them.')

  const many = files.length > 1
  const sortedMains = [...mains].sort((a, b) => natural(distinctLines(a.parsed.rows)[0] ?? '', distinctLines(b.parsed.rows)[0] ?? '') || natural(a.name, b.name))
  const sortedSpecs = [...specFiles].sort((a, b) => natural(a.name, b.name))

  let rows: ListRow[] = []
  let excelRows: number[] = []
  const errors: RowError[] = []
  let totalRows = 0
  let duplicates = 0
  let divisionDates = 0
  let ambiguousMonths = 0
  let needsMonth = false
  const monthSamples: ParsedList['monthSamples'] = []
  for (const f of sortedMains) {
    const p = f.parsed
    rows = rows.concat(p.rows)
    excelRows = excelRows.concat(p.excelRows)
    for (const e of p.errors) errors.push(many ? { excelRow: e.excelRow, reason: `${f.name}: ${e.reason}` } : e)
    totalRows += p.totalRows
    duplicates += p.duplicates
    divisionDates += p.divisionDates
    ambiguousMonths += p.ambiguousMonths
    if (p.needsMonth) needsMonth = true
    for (const s of p.monthSamples) if (monthSamples.length < 3) monthSamples.push(s)
  }

  const crmRaw: CrmRaw = {
    mains: sortedMains.map((f) => ({ name: f.name, lines: distinctLines(f.parsed.rows), rows: f.parsed.totalRows, hasMonth: !f.parsed.needsMonth })),
    specs: sortedSpecs.map((f) => ({ name: f.name, entries: f.parsed.specs ?? [], skipped: f.parsed.specSkipped ?? 0 })),
  }
  return {
    rows, excelRows, errors, totalRows, duplicates, divisionDates, ambiguousMonths, monthSamples,
    headers: [], missing: [], fileKind: 'main', needsMonth, crmRaw,
  }
}

/**
 * Apply the chosen Month to rows that have none, drop duplicates across files (same Month + Account ID + Doctor Id,
 * the last occurrence wins — as inside one file) and fill `speciality` from the Speciality files.
 * The input is never modified, so it can be called again when the Month changes.
 */
export function finalizeList(p: ParsedList, month: string | null): ParsedList {
  const raw = p.crmRaw
  if (!raw) return p
  const m = month ?? ''

  const rows: ListRow[] = []
  const excelRows: number[] = []
  const seen = new Map<string, number>()
  let duplicates = p.duplicates
  for (let i = 0; i < p.rows.length; i++) {
    const src = p.rows[i]
    const row: ListRow = { ...src, month: src.month === '' ? m : src.month }
    const key = `${row.month}|${row.account_id}|${row.doctor_id}`
    const prev = seen.get(key)
    if (prev !== undefined) {
      rows[prev] = row
      excelRows[prev] = p.excelRows[i]
      duplicates++
    } else {
      seen.set(key, rows.length)
      rows.push(row)
      excelRows.push(p.excelRows[i])
    }
  }

  // Speciality by key; the first non-empty value wins, a different one later is counted as a conflict.
  const specMap = new Map<string, string | null>()
  let specConflicts = 0
  for (const sf of raw.specs) {
    for (const e of sf.entries) {
      const prev = specMap.get(e.key)
      if (prev === undefined || prev === null) specMap.set(e.key, e.specialty)
      else if (e.specialty !== null && e.specialty !== prev) specConflicts++
    }
  }

  const hasSpecFiles = raw.specs.length > 0
  const rowKeys = rows.map((r) => listKey(r.account_type, r.account_id, r.doctor_id))
  const mainKeys = new Set(rowKeys)
  const byLine = new Map<string, CrmLineStat>()
  const noSpecRows: ListRow[] = []
  let mainNoMatch = 0
  rows.forEach((row, i) => {
    const matched = specMap.has(rowKeys[i])
    // A's own speciality (old format) is kept; only blanks are filled from the Speciality file.
    if (row.speciality === null && matched) row.speciality = specMap.get(rowKeys[i]) ?? null
    const st = byLine.get(row.line) ?? { line: row.line, rows: 0, noSpeciality: 0, noMatch: 0 }
    st.rows++
    if (hasSpecFiles && !matched) { st.noMatch++; mainNoMatch++ }
    if (row.speciality === null) { st.noSpeciality++; noSpecRows.push(row) }
    byLine.set(row.line, st)
  })

  const files: CrmFileInfo[] = raw.mains.map((f) => ({ name: f.name, kind: 'main', line: f.lines.join(' + ') || null, rows: f.rows }))
  let specNoMatch = 0
  for (const sf of raw.specs) {
    const keys = new Set(sf.entries.map((e: SpecEntry) => e.key))
    const unmatched = sf.entries.filter((e: SpecEntry) => !mainKeys.has(e.key)).length
    specNoMatch += unmatched
    const counts = new Map<string, number>()
    rows.forEach((row, i) => { if (keys.has(rowKeys[i])) counts.set(row.line, (counts.get(row.line) ?? 0) + 1) })
    const top = [...counts].sort((a, b) => b[1] - a[1] || natural(a[0], b[0]))[0]
    files.push({ name: sf.name, kind: 'speciality', line: top ? top[0] : null, rows: sf.entries.length + sf.skipped, unmatched, skipped: sf.skipped })
  }

  const crm: CrmInfo = {
    show: hasSpecFiles || raw.mains.some((f) => !f.hasMonth),
    files,
    lines: [...byLine.values()].sort((a, b) => natural(a.line, b.line)),
    noSpecRows,
    specNoMatch,
    mainNoMatch,
    specConflicts,
    specFiles: raw.specs.length,
  }
  return { ...p, rows, excelRows, duplicates, crm }
}

/** The rows of the "Download list" Excel: doctors that still have no Speciality after the join. */
export function noSpecialityExport(rows: ListRow[]): Record<string, string>[] {
  return rows.map((r) => ({
    Month: r.month,
    Line: r.line,
    'Emp. Code': r.emp_code,
    'Account Type': r.account_type ?? '',
    'Account ID': r.account_id,
    'Account Name': r.account_name ?? '',
    'Doctor Id': r.doctor_id,
    'Doctor Name': r.doctor_name,
    Class: r.class ?? '',
    Brick: r.brick ?? '',
  }))
}
