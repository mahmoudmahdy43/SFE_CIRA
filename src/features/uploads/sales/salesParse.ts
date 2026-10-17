/**
 * Sales files: three ".xls" exports per month (CIRA 1, 2, 3) that are really malformed HTML.
 * They are read as text and parsed with string/regex logic (never DOMParser). No imports: unit-tested.
 */
export interface SalesRow {
  line: string
  /** YYYY-MM */
  month: string
  territory: string
  /** Rep name as printed in the file (information only; the system value is used). */
  md: string
  product: string
  s_units: number | null
  t_units: number | null
  s_value: number | null
  t_value: number | null
}

export interface SalesCheck { line: string; month: string; s_value: number | null; t_value: number | null }

export interface SalesFile {
  name: string
  errors: string[]
  /** CIRA 1..3 (from the company row) */
  line: string | null
  /** YYYY-MM */
  month: string | null
  rows: SalesRow[]
  territories: number
  products: number
  check: SalesCheck | null
  sumValue: number
  sumTarget: number
}

export const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
export const LINE_COUNT = 3
/** File total vs parsed rows must agree within this many EGP. */
export const MATCH_TOLERANCE = 5

const strip = (s: string): string => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()

function cellNumber(s: string): number | null {
  const t = s.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, '').replace(/[,%\s]/g, '')
  if (t === '' || t === '-') return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

const ROW_HEAD = /^[^>]*>\s*<td[^>]*>([A-Za-z]?)<td[^>]*>(.*?)<th/s
const CELLS = /<t[hd][^>]*>(.*?)(?=<t[hd]|<\/tr>|$)/gs
const REP_NAME = /<td[^>]*>\s*(?:<nobr>)?([^<]*?)(?:<\/nobr>)?\s*<th[^>]*width=.5.>\|/gs

export function parseFileName(name: string): { month: number; line: number } | null {
  const m = /^(\d{1,2})_(\d)\.xls$/i.exec(name.trim())
  if (!m) return null
  const month = Number(m[1])
  const line = Number(m[2])
  return month >= 1 && month <= 12 && line >= 1 && line <= LINE_COUNT ? { month, line } : null
}

const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`

/** Parses one file's text. Problems are reported in `errors`; the file must not be loaded when any exist. */
export function parseSalesFile(name: string, text: string): SalesFile {
  const out: SalesFile = { name, errors: [], line: null, month: null, rows: [], territories: 0, products: 0, check: null, sumValue: 0, sumTarget: 0 }
  const fromName = parseFileName(name)
  if (!fromName) out.errors.push('File name must be N_M.xls: N = month number (1-12), M = line number (1-3).')

  const yearM = /(\d{4})\s+Sales\s+Analysis\s+Report/i.exec(text)
  const year = yearM ? Number(yearM[1]) : null
  if (year === null) out.errors.push('Could not find the year: the caption "YYYY Sales Analysis Report" is missing.')

  const segs = text.split("<tr align='center'")
  const preamble = segs[0].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
  const label = MONTH_ABBR.find((a) => new RegExp(`\\b${a}\\b`, 'i').test(preamble))
  const labelMonth = label ? MONTH_ABBR.indexOf(label) + 1 : null
  if (labelMonth === null) out.errors.push('Could not find the month label (e.g. SEP) in the first header table.')

  let node: { type: string; name: string; rep: string } | null = null
  const territories = new Set<string>()
  const products = new Set<string>()
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i]
    const parts = seg.split('<table')
    const head = parts[0]
    const h = ROW_HEAD.exec(head)
    if (!h) continue
    const type = h[1].toUpperCase()
    const label2 = strip(h[2])
    if (type !== '') {
      let rep = ''
      if (type === 'T') {
        let last: RegExpExecArray | null = null
        for (const m of head.matchAll(REP_NAME)) last = m
        rep = last ? strip(last[1]) : ''
      }
      node = { type, name: label2, rep }
    }
    if (parts.length < 2) continue
    const table = parts[1].split('</table>')[0]
    const cells = [...table.matchAll(CELLS)].map((m) => cellNumber(m[1]))
    if (cells.length !== 6) continue
    const [sUnits, tUnits, , sValue, tValue] = cells
    if (type === 'C') {
      out.check = { line: label2, month: '', s_value: sValue, t_value: tValue }
      continue
    }
    if (type === '' && node && node.type === 'T' && label2 !== '') {
      territories.add(node.name)
      products.add(label2)
      out.rows.push({ line: '', month: '', territory: node.name, md: node.rep, product: label2, s_units: sUnits, t_units: tUnits, s_value: sValue, t_value: tValue })
    }
  }

  const lineName = out.check ? out.check.line : null
  const lineNum = lineName ? /(\d+)\s*$/.exec(lineName)?.[1] : undefined
  if (!out.check) out.errors.push('Could not find the company row (type C) with the line total.')
  else if (!lineNum) out.errors.push(`Company row "${lineName}" does not name a line (expected CIRA 1, 2 or 3).`)
  out.line = lineNum ? `CIRA ${Number(lineNum)}` : null

  if (fromName && labelMonth !== null && fromName.month !== labelMonth) {
    out.errors.push(`File name says month ${fromName.month} but the report says ${label}.`)
  }
  if (fromName && out.line && fromName.line !== Number(lineNum)) {
    out.errors.push(`File name says line ${fromName.line} but the report says ${out.line}.`)
  }
  if (year !== null && labelMonth !== null) out.month = ym(year, labelMonth)
  for (const r of out.rows) {
    r.line = out.line ?? ''
    r.month = out.month ?? ''
    out.sumValue += r.s_value ?? 0
    out.sumTarget += r.t_value ?? 0
  }
  if (out.check) { out.check.line = out.line ?? out.check.line; out.check.month = out.month ?? '' }
  out.territories = territories.size
  out.products = products.size
  if (out.errors.length === 0 && out.rows.length === 0) out.errors.push('No territory x product rows were found in this file.')
  return out
}

export const valueMatches = (file: SalesFile): boolean =>
  !!file.check && Math.abs((file.check.s_value ?? 0) - file.sumValue) <= MATCH_TOLERANCE

export const targetMatches = (file: SalesFile): boolean =>
  !!file.check && Math.abs((file.check.t_value ?? 0) - file.sumTarget) <= MATCH_TOLERANCE

export interface MonthGroup {
  /** YYYY-MM */
  month: string
  files: SalesFile[]
  /** Line numbers (1-3) that have no file. */
  missing: number[]
  rows: number
}

/** Groups valid files by month; the same month + line twice keeps the first and reports the rest. */
export function groupByMonth(files: SalesFile[]): { groups: MonthGroup[]; duplicates: string[] } {
  const by = new Map<string, Map<string, SalesFile>>()
  const duplicates: string[] = []
  for (const f of files) {
    if (f.errors.length > 0 || !f.month || !f.line) continue
    const m = by.get(f.month) ?? new Map<string, SalesFile>()
    if (m.has(f.line)) duplicates.push(`${f.name} repeats ${f.line} ${f.month} (${m.get(f.line)!.name}); it is ignored.`)
    else m.set(f.line, f)
    by.set(f.month, m)
  }
  const groups = [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([month, lines]) => {
    const list = [...lines.values()].sort((a, b) => (a.line ?? '').localeCompare(b.line ?? ''))
    const present = new Set(list.map((f) => Number((f.line ?? '').slice(-1))))
    return {
      month,
      files: list,
      missing: [1, 2, 3].filter((n) => !present.has(n)),
      rows: list.reduce((a, f) => a + f.rows.length, 0),
    }
  })
  return { groups, duplicates }
}

/** Splits rows into chunks. */
export function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}
