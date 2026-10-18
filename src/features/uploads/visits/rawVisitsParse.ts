/**
 * Raw CRM visit files (c_L_M.xls): HTML saved as .xls — malformed, tables never closed, so NO DOMParser:
 * the text is cut with string / regex logic. Pure functions (no DOM, no Worker), unit-tested.
 */

export interface RawProduct { n: string; s: number }

/** The payload row sent to load_visits_raw_chunk. `shift` is always null: the database derives it from Acc. Type. */
export interface RawVisitRow {
  crm_id: number | string | null
  shift: null
  territory: string
  brick: string | null
  visit_type: string
  acc_type: string
  acc_name: string
  doctor_name: string
  visit_date: string
  visit_time: string | null
  owner: string
  members: string | null
  products: RawProduct[]
  notes: string | null
  visit_root: string | null
  source: string | null
}

export type ShiftGroup = 'AM' | 'PM' | 'Pharmacy'

/** What the database does with each Acc. Type: A, H, AM = AM; PC, C = PM; P = Pharmacy. Anything else is rejected there. */
const SHIFT_OF_TYPE: Record<string, ShiftGroup> = { A: 'AM', H: 'AM', AM: 'AM', PC: 'PM', C: 'PM', P: 'Pharmacy' }
export const shiftOfAccType = (t: string): ShiftGroup | null => SHIFT_OF_TYPE[t.trim().toUpperCase()] ?? null

export interface AccTypeCount { type: string; rows: number; shift: ShiftGroup | null }

export interface RawVisitsFile {
  name: string
  /** "From … To …" of the report title, when present. */
  titleRange: { from: string; to: string } | null
  rows: RawVisitRow[]
  /** rowNumbers[k] = 1-based position of rows[k] among the data rows of the file (for rejected-row reports). */
  rowNumbers: number[]
  /** Rows left out here (no valid visit date). */
  errors: { row: number; reason: string }[]
  /** Data rows found (before any exclusion). */
  totalRows: number
  /** Rows with fewer than 17 cells (ignored, like the spec says). */
  shortRows: number
  single: number
  double: number
  owners: number
  accTypes: AccTypeCount[]
}

const ENTITIES: [RegExp, string][] = [
  [/&nbsp;/gi, ' '], [/&lt;/gi, '<'], [/&gt;/gi, '>'], [/&quot;/gi, '"'], [/&#0*39;|&apos;/gi, "'"],
  [/&amp;/gi, '&'], // last, so "&amp;nbsp;" is not decoded twice
]

/** Remove tags, decode the few entities the export uses, collapse whitespace, trim. */
export function cleanText(s: string): string {
  let t = s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/<[^>]*$/, '')
  for (const [re, to] of ENTITIES) t = t.replace(re, to)
  return t.replace(/\s+/g, ' ').trim()
}

const BR = /<br\s*\/?>/i
const stripDash = (s: string) => s.replace(/^[\s-]+/, '').trim()
/** Text after the first '>' of a "<td …>" cell (the cell was cut at '<td', so its attributes come first). */
const inner = (cell: string) => {
  const i = cell.indexOf('>')
  return i < 0 ? '' : cell.slice(i + 1)
}
const orNull = (s: string) => (s === '' ? null : s)

function titleRangeOf(text: string): { from: string; to: string } | null {
  const cap = /<caption[^>]*>([\s\S]*?)(?:<\/caption>|$)/i.exec(text)
  const title = cleanText(cap ? cap[1] : text.slice(0, 5000))
  const m = /From\s+(\d{4}-\d\d-\d\d)\s+To\s+(\d{4}-\d\d-\d\d)/i.exec(title)
  return m ? { from: m[1], to: m[2] } : null
}

/** Cell 12 "Members": owner = the FIRST <nobr>NAME</nobr>; members = the other distinct names. */
export function splitMembers(cell: string): { owner: string; members: string | null } {
  const pieces = cell.split(BR).map((p) => stripDash(cleanText(p))).filter((p) => p !== '')
  const nobr = /<nobr[^>]*>([^<]*)/i.exec(cell)
  const owner = nobr ? stripDash(cleanText(nobr[1])) : ''
  const first = owner || pieces[0] || ''
  const others = [...new Set(pieces.filter((p) => p !== first))]
  return { owner: first, members: orNull(others.join(' | ')) }
}

/** Cells 10 + 11: product names and the sample counts, paired by position. */
export function splitProducts(productsCell: string, samplesCell: string): RawProduct[] {
  const names = productsCell.split(BR).map((p) => stripDash(cleanText(p)))
  const samples = samplesCell.split(BR).map((p) => {
    const m = /-?\d+(?:\.\d+)?/.exec(cleanText(p))
    return m ? Number(m[0]) : 0
  })
  const out: RawProduct[] = []
  names.forEach((n, i) => { if (n !== '') out.push({ n, s: samples[i] ?? 0 }) })
  return out
}

function splitNotes(cell: string): string | null {
  const lines = cell.split(BR).map(cleanText).filter((l) => l !== '' && !/^[-\s]+$/.test(l))
  return orNull(lines.join(' | '))
}

export function parseRawVisitsFile(name: string, text: string): RawVisitsFile {
  const pieces = text.split(/<tr\s+align=['"]center['"]\s+valign=['"]top['"]/i).slice(1) // piece 0 = header
  const rows: RawVisitRow[] = []
  const rowNumbers: number[] = []
  const errors: { row: number; reason: string }[] = []
  const owners = new Set<string>()
  const types = new Map<string, number>()
  let shortRows = 0
  let single = 0
  let double = 0
  pieces.forEach((piece, idx) => {
    const rowNo = idx + 1
    const cells = piece.split('<td').slice(1)
    if (cells.length < 17) { shortRows++; return }
    const id = /actual_(\d+)/.exec(cells[0])
    const terr = inner(cells[2]).split(BR)
    const brickRaw = terr.slice(1).join(' ')
    const brick = /<nobr[^>]*>([\s\S]*?)(?:<\/nobr>|$)/i.exec(brickRaw)
    const when = cleanText(inner(cells[9]))
    const date = /\d{4}-\d\d-\d\d/.exec(when)
    if (!date) { errors.push({ row: rowNo, reason: 'no valid visit date' }); return }
    const time = /\d\d:\d\d/.exec(when)
    const { owner, members } = splitMembers(inner(cells[12]))
    const visitType = cleanText(inner(cells[3])).toUpperCase()
    const accType = cleanText(inner(cells[4]))
    rows.push({
      crm_id: id ? (Number.isSafeInteger(Number(id[1])) ? Number(id[1]) : id[1]) : null,
      shift: null,
      territory: cleanText(terr[0] ?? ''),
      brick: orNull(cleanText(brick ? brick[1] : brickRaw)),
      visit_type: visitType,
      acc_type: accType,
      acc_name: cleanText(inner(cells[5])),
      doctor_name: cleanText(inner(cells[6])),
      visit_date: date[0],
      visit_time: time ? time[0] : null,
      owner,
      members,
      products: splitProducts(inner(cells[10]), inner(cells[11])),
      notes: splitNotes(inner(cells[13])),
      visit_root: orNull(cleanText(inner(cells[14]))),
      source: orNull(cleanText(inner(cells[16]))),
    })
    rowNumbers.push(rowNo)
    if (visitType === 'D') double++
    else single++
    if (owner) owners.add(owner)
    types.set(accType, (types.get(accType) ?? 0) + 1)
  })
  const accTypes = [...types].map(([type, n]) => ({ type, rows: n, shift: shiftOfAccType(type) })).sort((a, b) => b.rows - a.rows || a.type.localeCompare(b.type))
  return { name, titleRange: titleRangeOf(text), rows, rowNumbers, errors, totalRows: pieces.length, shortRows, single, double, owners: owners.size, accTypes }
}

/* ---------------------------------- planning ---------------------------------- */

/** First digit of "c_1_10.xls" / "p-2-3" = the line suggested for the dropdown (1..3), else null. */
export function guessLineNumber(fileName: string): number | null {
  const m = /[cp][_\s-]*(\d)[_\s-]*(\d{1,2})/i.exec(fileName)
  const n = m ? Number(m[1]) : NaN
  return n >= 1 && n <= 3 ? n : null
}

/** The dates a file covers: its title range, widened to any visit date outside it; null when it has neither. */
export function effectiveRange(f: RawVisitsFile): { from: string; to: string } | null {
  let from = f.titleRange?.from ?? null
  let to = f.titleRange?.to ?? null
  for (const r of f.rows) {
    if (from === null || r.visit_date < from) from = r.visit_date
    if (to === null || r.visit_date > to) to = r.visit_date
  }
  return from !== null && to !== null ? { from, to } : null
}

/** First-of-month dates from the month of `from` through the month of `to`. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let y = Number(from.slice(0, 4))
  let m = Number(from.slice(5, 7))
  const endY = Number(to.slice(0, 4))
  const endM = Number(to.slice(5, 7))
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`)
    if (++m > 12) { m = 1; y++ }
  }
  return out
}

export interface PlannedFile { file: RawVisitsFile; line: number | null }

export interface RawPlan {
  rows: number
  from: string | null
  to: string | null
  months: string[]
  /** Distinct chosen line ids. */
  lines: number[]
  /** Same line + overlapping dates: likely the same file twice. */
  overlaps: string[]
  /** Per distinct line: the dates (min/max over that line's files) to clear before loading. */
  perLine: { line: number; from: string; to: string }[]
}

export function planRawUpload(files: PlannedFile[]): RawPlan {
  let from: string | null = null
  let to: string | null = null
  let rows = 0
  const overlaps: string[] = []
  const ranges = files.map((f) => effectiveRange(f.file))
  files.forEach((f, i) => {
    rows += f.file.rows.length
    const r = ranges[i]
    if (r) {
      if (from === null || r.from < from) from = r.from
      if (to === null || r.to > to) to = r.to
    }
    for (let j = i + 1; j < files.length; j++) {
      const o = ranges[j]
      if (r && o && f.line !== null && f.line === files[j].line && r.from <= o.to && o.from <= r.to) {
        overlaps.push(`${f.file.name} and ${files[j].file.name} have the same line and overlapping dates (${r.from} → ${r.to} / ${o.from} → ${o.to}) — likely a duplicate.`)
      }
    }
  })
  const lines = [...new Set(files.flatMap((f) => (f.line === null ? [] : [f.line])))]
  const perLine: RawPlan['perLine'] = []
  for (const line of lines) {
    let lf: string | null = null
    let lt: string | null = null
    files.forEach((f, i) => {
      const r = ranges[i]
      if (f.line !== line || !r || f.file.rows.length === 0) return
      if (lf === null || r.from < lf) lf = r.from
      if (lt === null || r.to > lt) lt = r.to
    })
    if (lf !== null && lt !== null) perLine.push({ line, from: lf, to: lt })
  }
  return { rows, from, to, months: from && to ? monthsBetween(from, to) : [], lines, overlaps, perLine }
}
