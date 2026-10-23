/**
 * CRM "Actual Visits Report" with the Device Deviation column (the GPS file): HTML saved as .xls, malformed, so string / regex
 * parsing only. Only the Visits section is read. Pure functions, unit-tested.
 */
import { cleanText, sectionOf } from './rawVisitsParse.ts'

/** The payload row sent to load_visits_gps_chunk. */
export interface GpsRow {
  crm_id: string
  dev_lat: number
  dev_lng: number
  acc_lat: number
  acc_lng: number
  /** null when the CRM printed "nan m." (coordinates are still valid). */
  deviation_m: number | null
}

export interface GpsFile {
  name: string
  /** Set when the file is not a GPS report: shown as the error, the file is left out. */
  fatal: string | null
  titleRange: { from: string; to: string } | null
  /** Rows of the Visits section that have a visit ID. */
  visitRows: number
  rows: GpsRow[]
  /** Visit rows without readable coordinates, left out. */
  noCoords: number
  /** Rows with coordinates but no numeric deviation ("nan m."). */
  nanDeviation: number
  /** Visit IDs seen more than once (the first occurrence is kept). */
  duplicates: number
}

const ROW_SPLIT = /<tr\s+align=['"]center['"]\s+valign=['"]top['"]/i
const VISIT_ID = /user\.visit\.php\?action=view&(?:amp;)?id=(\d+)/i
/** "129.55 m. (lat--lng--lat--lng)": the `--` is a separator, not a minus sign. */
const DEVIATION = /(\S+)\s*m\.\s*\(([^)]*)\)/

/** The four coordinates of the part inside the brackets, or null. */
export function parseCoords(inside: string): [number, number, number, number] | null {
  const parts = inside.trim().split(/--(?=-?\d)/).map((p) => p.trim())
  if (parts.length !== 4 || parts.some((p) => !/^-?\d+(?:\.\d+)?$/.test(p))) return null
  return parts.map(Number) as [number, number, number, number]
}

export function parseGpsFile(name: string, text: string): GpsFile {
  const base = { name, titleRange: null, visitRows: 0, rows: [] as GpsRow[], noCoords: 0, nanDeviation: 0, duplicates: 0 }
  const cap = /<caption[^>]*>([\s\S]*?)(?:<\/caption>|$)/i.exec(text)
  const title = cleanText(cap ? cap[1] : text.slice(0, 5000))
  if (!/Actual\s+Visits\s+Report/i.test(title)) {
    return { ...base, fatal: `${name} is not a CRM Actual Visits Report (caption “Actual Visits Report …” expected).` }
  }
  const visits = sectionOf(text, 'Visits')
  if (!/Device\s+Deviation/i.test(visits)) {
    return { ...base, fatal: `${name} has no “Device Deviation” column in its Visits section: it is not a GPS report.` }
  }
  const r = /From\s+(\d{4}-\d\d-\d\d)\s+To\s+(\d{4}-\d\d-\d\d)/i.exec(title)
  const titleRange = r ? { from: r[1], to: r[2] } : null

  const rows: GpsRow[] = []
  const seen = new Set<string>()
  let visitRows = 0
  let noCoords = 0
  let nanDeviation = 0
  let duplicates = 0
  for (const piece of visits.split(ROW_SPLIT).slice(1)) {
    const id = VISIT_ID.exec(piece)?.[1]
    if (!id) continue
    visitRows++
    if (seen.has(id)) { duplicates++; continue }
    seen.add(id)
    // The cell is found by its text, not its position: a few rows have one cell more or less.
    const m = DEVIATION.exec(cleanText(piece))
    const c = m ? parseCoords(m[2]) : null
    if (!c) { noCoords++; continue }
    const raw = m![1].replace(/,/g, '') // "1,004.51 m."
    const finite = /^\d+(?:\.\d+)?$/.test(raw)
    const metres = Number(raw)
    if (!finite) nanDeviation++
    rows.push({ crm_id: id, dev_lat: c[0], dev_lng: c[1], acc_lat: c[2], acc_lng: c[3], deviation_m: finite ? metres : null })
  }
  return { ...base, fatal: visitRows === 0 ? `${name}: no visits found in the Visits section.` : null, titleRange, visitRows, rows, noCoords, nanDeviation, duplicates }
}
