/**
 * One CRM "Territory visits" report holds several sections (Visits, Pharmacies Visits, Office Work, Activities, Events), each with
 * the rep names (Members). This reads every section it recognises with the existing parsers and says why it skips the others.
 * Pure functions, unit-tested.
 */
import { parseRawActivitiesFile, type RawActivitiesFile } from '../absence/rawActivitiesParse.ts'
import { parseRawOfficeWorkFile, type RawOfficeWorkFile } from '../absence/rawOfficeWorkParse.ts'
import { cleanText, parseRawVisitsFile, sectionOf, type RawVisitsFile } from './rawVisitsParse.ts'
import { parseGpsFile, type GpsFile } from './gpsParse.ts'

const ROW_SPLIT = /<tr\s+align=['"]center['"]\s+valign=['"]top['"]/i

/** The header cells of a section (text of its <th>s, before the first data row). */
export function headersOf(section: string): string[] {
  const head = section.split(ROW_SPLIT)[0] ?? ''
  return head.split(/<th\b/i).slice(1).map((h) => cleanText(h.slice(h.indexOf('>') + 1)))
}
const has = (headers: string[], word: string) => headers.some((h) => h.toLowerCase() === word.toLowerCase())
const dataRows = (section: string) => Math.max(0, section.split(ROW_SPLIT).length - 1)

export interface TerritoryReport {
  name: string
  titleRange: { from: string; to: string } | null
  clinic: RawVisitsFile | null
  pharmacy: RawVisitsFile | null
  officeWork: RawOfficeWorkFile | null
  activities: RawActivitiesFile | null
  /** Sections present in the report but not loaded, each with the reason. */
  ignored: string[]
}

export type DroppedFile =
  | { kind: 'territory'; name: string; report: TerritoryReport }
  | { kind: 'gps'; name: string; gps: GpsFile }
  | { kind: 'unknown'; name: string; reason: string }

export function parseTerritoryReport(name: string, text: string): TerritoryReport {
  const cap = /<caption[^>]*>([\s\S]*?)(?:<\/caption>|$)/i.exec(text)
  const title = cleanText(cap ? cap[1] : text.slice(0, 5000))
  const r = /From\s+(\d{4}-\d\d-\d\d)\s+To\s+(\d{4}-\d\d-\d\d)/i.exec(title)
  const out: TerritoryReport = { name, titleRange: r ? { from: r[1], to: r[2] } : null, clinic: null, pharmacy: null, officeWork: null, activities: null, ignored: [] }

  const visits = sectionOf(text, 'Visits')
  if (visits !== '' && dataRows(visits) > 0) {
    if (has(headersOf(visits), 'Samples')) out.clinic = parseRawVisitsFile(name, text, 'Visits')
    else out.ignored.push('Visits: no Samples column, so it is not the Territory visits layout — ignored.')
  }
  const pharmacies = sectionOf(text, 'Pharmacies Visits')
  if (pharmacies !== '' && dataRows(pharmacies) > 0) out.pharmacy = parseRawVisitsFile(name, text, 'Pharmacies Visits')

  for (const [word, label] of [['Office Work', 'Office Work'], ['Activities', 'Activities']] as const) {
    const sec = sectionOf(text, word)
    if (sec === '' || dataRows(sec) === 0) continue
    if (!has(headersOf(sec), 'Members')) {
      out.ignored.push(`${label}: no Members column (a different report: the names are missing) — ignored.`)
      continue
    }
    if (word === 'Office Work') out.officeWork = parseRawOfficeWorkFile(name, text)
    else out.activities = parseRawActivitiesFile(name, text)
  }
  if (sectionOf(text, 'Events') !== '') out.ignored.push('Events: not needed — ignored.')
  return out
}

/** Tells a Territory visits report from the GPS report (Device Deviation column in Visits) and reads it accordingly. */
export function parseDroppedFile(name: string, text: string): DroppedFile {
  const cap = /<caption[^>]*>([\s\S]*?)(?:<\/caption>|$)/i.exec(text)
  const title = cleanText(cap ? cap[1] : text.slice(0, 5000))
  if (!/Actual\s+Visits\s+Report/i.test(title)) return { kind: 'unknown', name, reason: `${name} is not a CRM Actual Visits Report (caption “Actual Visits Report …” expected).` }
  if (/Device\s+Deviation/i.test(sectionOf(text, 'Visits'))) return { kind: 'gps', name, gps: parseGpsFile(name, text) }
  const report = parseTerritoryReport(name, text)
  if (!report.clinic && !report.pharmacy && !report.officeWork && !report.activities) {
    return { kind: 'unknown', name, reason: `${name}: no Visits, Pharmacies Visits, Office Work (with Members) or Activities rows found.` }
  }
  return { kind: 'territory', name, report }
}
