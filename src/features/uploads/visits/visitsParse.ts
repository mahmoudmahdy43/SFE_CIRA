import { normHeader, serialToIso, type Cell } from '../list/listParse'

/** A visits row as the RPC expects it (plus `month`, used only client-side for grouping). */
export interface VisitRow {
  month: string
  territory: string | null
  acc_type: string | null
  account_id: string | null
  doctor_id: string | null
  code: string
  shift: 'AM' | 'PM'
  visit_type: 'S' | 'D'
  acc_name: string | null
  doctor_name: string
  visit_date: string
  members: string | null
  notes: string | null
  visit_root: string | null
  source: string | null
}

export interface VisitColumn {
  key: keyof VisitRow | 'territory'
  label: string
  required: boolean
}

export const VISIT_COLUMNS: VisitColumn[] = [
  { key: 'territory', label: 'Territory', required: true },
  { key: 'code', label: 'CODE', required: true },
  { key: 'shift', label: 'SHIFT', required: true },
  { key: 'visit_date', label: 'Date', required: true },
  { key: 'doctor_name', label: 'Doctor Name', required: true },
  { key: 'acc_name', label: 'Acc. Name', required: true },
  { key: 'visit_type', label: 'Visit Type', required: true },
  { key: 'visit_root', label: 'Visit Root', required: true },
  { key: 'acc_type', label: 'Acc. Type', required: false },
  { key: 'account_id', label: 'Account ID', required: false },
  { key: 'doctor_id', label: 'Doctor ID', required: false },
  { key: 'members', label: 'Members', required: false },
  { key: 'notes', label: 'Notes', required: false },
  { key: 'source', label: 'Source', required: false },
]

/** Present in the company export but deliberately never read. */
export const VISIT_IGNORED = ['Link status', 'Time', 'Spec.', 'Class', 'No. of Docs', 'Visit ID', 'Brick', 'Owner Name']

export function matchVisitHeaders(headers: string[]): { index: Partial<Record<VisitColumn['key'], number>>; missing: string[] } {
  const byNorm = new Map<string, number>()
  headers.forEach((h, i) => {
    const n = normHeader(h)
    if (n && !byNorm.has(n)) byNorm.set(n, i)
  })
  const index: Partial<Record<VisitColumn['key'], number>> = {}
  const missing: string[] = []
  for (const c of VISIT_COLUMNS) {
    const hit = byNorm.get(normHeader(c.label))
    if (hit !== undefined) index[c.key] = hit
    else if (c.required) missing.push(c.label)
  }
  return { index, missing }
}

export type DateOrder = 'dmy' | 'mdy'

const pad2 = (n: number) => String(n).padStart(2, '0')
const SLASH = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/

/**
 * Text dates like 07/10/2026 are ambiguous. Look at the whole column once: a first part > 12 proves
 * day-first, a second part > 12 proves month-first; otherwise day-first (company exports) is assumed.
 */
export function inferDateOrder(texts: string[]): { order: DateOrder; undecided: boolean } {
  let dmy = 0
  let mdy = 0
  for (const t of texts) {
    const m = SLASH.exec(t.trim())
    if (!m) continue
    if (Number(m[1]) > 12) dmy++
    else if (Number(m[2]) > 12) mdy++
  }
  if (mdy > 0 && dmy === 0) return { order: 'mdy', undecided: false }
  if (dmy > 0 && mdy === 0) return { order: 'dmy', undecided: false }
  return { order: 'dmy', undecided: dmy === 0 && mdy === 0 }
}

/**
 * Visit date -> 'YYYY-MM-DD' (calendar date only). Serials use the integer part; the time-of-day
 * fraction (e.g. the 03:00:09 artifact) is dropped; nothing goes through a local-time Date.
 */
export function parseVisitDate(v: Cell, order: DateOrder = 'dmy'): string | null {
  if (v === null) return null
  if (typeof v === 'number') return serialToIso(Math.floor(v))
  const s = v.trim()
  if (s === '') return null
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s)
  if (m) return validDay(Number(m[1]), Number(m[2]), Number(m[3]))
  m = SLASH.exec(s)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    return order === 'dmy' ? validDay(Number(m[3]), b, a) : validDay(Number(m[3]), a, b)
  }
  if (/^\d+(\.\d+)?$/.test(s)) return serialToIso(Math.floor(Number(s)))
  return null
}

function validDay(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  // Reject impossible dates (31 Feb) using UTC parts only.
  const t = new Date(Date.UTC(y, mo - 1, d))
  if (t.getUTCMonth() !== mo - 1) return null
  return `${y}-${pad2(mo)}-${pad2(d)}`
}

export function parseShift(v: Cell): 'AM' | 'PM' | null {
  if (v === null) return null
  const s = String(v).trim().toUpperCase()
  return s === 'AM' || s === 'PM' ? s : null
}

export function parseVisitType(v: Cell): 'S' | 'D' | null {
  if (v === null) return null
  const s = String(v).trim().toLowerCase()
  if (s === 's' || s === 'single') return 'S'
  if (s === 'd' || s === 'double') return 'D'
  return null
}

/** Planned / Direct are normalised; any other value is kept as written (and counted by the caller). */
export function parseVisitRoot(v: Cell): { value: string | null; known: boolean } {
  if (v === null) return { value: null, known: true }
  const s = String(v).trim()
  if (s === '') return { value: null, known: true }
  const l = s.toLowerCase()
  if (l === 'planned') return { value: 'Planned', known: true }
  if (l === 'direct') return { value: 'Direct', known: true }
  return { value: s, known: false }
}

/** Text kept exactly as written (only surrounding whitespace removed; Arabic and inner spacing untouched). */
export function keepText(v: Cell): string | null {
  if (v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** An ID cell as a plain integer string: 1350, "1350.0" and 1.35E3 all become "1350"; blank -> null. */
export function idText(v: Cell): string | null {
  if (v === null) return null
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('fullwide', { useGrouping: false }) : String(v)
  const s = v.trim()
  if (s === '') return null
  if (/^\d+$/.test(s)) return s
  if (/^\d+\.0*$/.test(s)) return s.replace(/\.0*$/, '')
  const n = Number(s)
  if (Number.isFinite(n) && Number.isInteger(n)) return n.toLocaleString('fullwide', { useGrouping: false })
  return s
}

export function codeText(v: Cell): string | null {
  if (v === null) return null
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('fullwide', { useGrouping: false }) : String(v)
  const s = v.trim()
  return s === '' ? null : s
}

/** First and last visit date per month in the file: the exact range a "Replace" may clear. */
export function dateRangeByMonth(rows: { month: string; visit_date: string }[]): Map<string, { first: string; last: string }> {
  const out = new Map<string, { first: string; last: string }>()
  for (const r of rows) {
    const cur = out.get(r.month)
    if (!cur) out.set(r.month, { first: r.visit_date, last: r.visit_date })
    else {
      if (r.visit_date < cur.first) cur.first = r.visit_date
      if (r.visit_date > cur.last) cur.last = r.visit_date
    }
  }
  return out
}
