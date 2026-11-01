/**
 * Daily Reporting maths. Pure (no imports): also run by scripts/dailyReporting.test.mjs.
 * Files come from the CRM "Daily Report" export (sheet1: header in row 2, data from row 3). Nothing here touches the database.
 */

/** A rep with fewer PM visits than this (and no vacation / office work / activity) needs a follow-up. */
export const FOLLOW_UP_BELOW = 6

export type Shift = 'PM' | 'PHARMA'
export type ReportingStatus = 'Reported Day' | 'Unreported Day' | 'Follow Up Required'
export const NOT_IN_SYSTEM = 'Not in system'
export const UNASSIGNED = 'Unassigned'

/** Mirror of src/lib/norm.ts normName (kept inline so this file has no imports). */
export function normName(t: string | null | undefined): string {
  return (t ?? '')
    .toLowerCase()
    .replace(/^\s*-\s*/, '')
    .replace(/\(\s*\)\s*$/, '')
    .replace(/[\s.\-_]+/g, ' ')
    .trim()
}

const numOf = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

/* ------------------------------ reading a CRM file ------------------------------ */
export interface FileRep { name: string; norm: string; visits: number; vacations: number; office: number; activities: number }
export interface ParsedFile {
  reps: FileRep[]
  /** Line from the last "A" row whose Territory Name is exactly CIRA 1 / 2 / 3. */
  lineFromRows: number | null
  /** Median Daily Visits Target of the T rows with a target above 0 (null when there is none). */
  medianTarget: number | null
}

const hdr = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
const NEEDED = ['employee', 'vacations', 'office work', 'activities', 'actual visits'] as const

const median = (v: number[]): number | null => {
  if (v.length === 0) return null
  const s = [...v].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Rows as arrays (row 1 = index 0; headers in row 2). Columns are found by header name (trimmed, lower case), never by letter.
 * Keeps only type "T" rows (reps); skips D / A rows and anything named "Test". A missing needed header throws an error naming the header and the file.
 */
export function parseReportRows(rows: unknown[][], fileName = 'the file'): ParsedFile {
  let h = rows.slice(0, 5).findIndex((r) => (r ?? []).some((c) => hdr(c) === 'employee'))
  if (h < 0) h = 1
  const col = new Map<string, number>()
  ;(rows[h] ?? []).forEach((c, i) => { const k = hdr(c); if (k !== '' && !col.has(k)) col.set(k, i) })
  for (const k of NEEDED) {
    if (!col.has(k)) throw new Error(`${fileName}: the column "${k}" was not found in the header row (row ${h + 1}). The CRM file layout may have changed.`)
  }
  const at = (k: string) => col.get(k) as number
  const iEmp = at('employee'), iVac = at('vacations'), iOff = at('office work'), iAct = at('activities'), iVis = at('actual visits')
  const iTerr = col.get('territory name'), iTarget = col.get('daily visits target')

  const byNorm = new Map<string, FileRep>()
  const targets: number[] = []
  let lineFromRows: number | null = null
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    const type = String(r[0] ?? '').trim().toUpperCase()
    if (type === 'A' && iTerr !== undefined) {
      const m = /^CIRA\s*([123])$/i.exec(String(r[iTerr] ?? '').trim())
      if (m) lineFromRows = Number(m[1]) // the last such row wins
    }
    if (type !== 'T') continue
    const name = String(r[iEmp] ?? '').replace(/\s+/g, ' ').trim()
    if (name === '' || /\btest\b/i.test(name)) continue
    const target = iTarget === undefined ? 0 : numOf(r[iTarget]) // empty target = 0
    if (target > 0) targets.push(target)
    const norm = normName(name)
    const prev = byNorm.get(norm)
    const rep = { name, norm, visits: numOf(r[iVis]), vacations: numOf(r[iVac]), office: numOf(r[iOff]), activities: numOf(r[iAct]) }
    if (prev) {
      prev.visits += rep.visits; prev.vacations += rep.vacations; prev.office += rep.office; prev.activities += rep.activities
    } else byNorm.set(norm, rep)
  }
  return { reps: [...byNorm.values()], lineFromRows, medianTarget: median(targets) }
}

/** "PHARMA" in the name = Pharmacy, "PM" = PM; the line digit sits just before the extension. Null = not recognised. */
export function detectFromName(fileName: string): { shift: Shift | null; line: number | null } {
  // drop the " (1)" a browser adds to a re-downloaded copy
  const base = (fileName.split(/[\\/]/).pop() ?? fileName).replace(/\s*\(\d+\)(?=\.[^.]*$)/, '')
  const up = base.toUpperCase()
  const shift: Shift | null = up.includes('PHARMA') ? 'PHARMA' : /(^|[^A-Z])PM([^A-Z]|$)/.test(up) ? 'PM' : null
  const m = /(?:^|[^0-9])([123])(?=[^0-9]*\.[^.]*$)/.exec(base)
  return { shift, line: m ? Number(m[1]) : null }
}

/** Median target >= 8 = PM (target 8 to 10), <= 6 = Pharmacy (mostly 5); in between, or no target at all: not decided. */
export function shiftFromMedian(med: number | null): Shift | null {
  if (med === null) return null
  return med >= 8 ? 'PM' : med <= 6 ? 'PHARMA' : null
}

export interface Detected { shift: Shift | null; line: number | null; /** the type could not be decided: the user must choose */ needsChoice: boolean }

/** File-name rule first (PM / PHARMA in the name), then the content. The line comes from the content, else from the name. */
export function detectFile(fileName: string, parsed: ParsedFile): Detected {
  const n = detectFromName(fileName)
  const shift = n.shift ?? shiftFromMedian(parsed.medianTarget)
  return { shift, line: parsed.lineFromRows ?? n.line, needsChoice: shift === null }
}

/**
 * Two automatically detected files with the same line and type are not guessed: both become "Needs a choice".
 * Files the user set by hand (auto = false) are never changed.
 */
export function flagConflicts<T extends { line: number | null; shift: Shift | null; auto: boolean; needsChoice: boolean }>(files: T[]): T[] {
  const key = (f: T) => `${f.line}|${f.shift}`
  const count = new Map<string, number>()
  for (const f of files) if (f.line !== null && f.shift !== null) count.set(key(f), (count.get(key(f)) ?? 0) + 1)
  return files.map((f) => (f.auto && f.line !== null && f.shift !== null && (count.get(key(f)) ?? 0) > 1 ? { ...f, shift: null, needsChoice: true } : f))
}


/* ------------------------------ system reps (daily_reporting_reps) ------------------------------ */
export interface SystemRep {
  line_id: number; line_name: string; rep_id: number | null; rep_name: string; rep_norm: string
  rep_code: string | null; status: string; district: string | null; district_manager: string | null; box_name: string | null
}

/** Rep in this line first; otherwise a rep with the same name that is unique across lines. */
export function matchSystemRep(sys: SystemRep[], line: number, norm: string): SystemRep | null {
  const same = sys.filter((s) => s.rep_norm === norm)
  return same.find((s) => s.line_id === line) ?? (same.length === 1 ? same[0] : null)
}

/* ------------------------------ status and rows ------------------------------ */
/** 1) any vacation / office work / activity -> Reported. 2) no PM visits -> Unreported. 3) under the threshold -> Follow Up. 4) Reported. */
export function reportingStatus(pm: number, vacations: number, office: number, activities: number, threshold = FOLLOW_UP_BELOW): ReportingStatus {
  if (vacations + office + activities > 0) return 'Reported Day'
  if (pm === 0) return 'Unreported Day'
  if (pm < threshold) return 'Follow Up Required'
  return 'Reported Day'
}

export interface DailyRow {
  key: string // line|norm, also the comment key
  rep: string; norm: string; districtManager: string; status: string; inSystem: boolean
  /** In the Prospection Phase list: always Reported Day, comment pre-filled. */
  prospection: boolean
  reporting: ReportingStatus; pm: number; /** null = the line has no Pharmacy file */ pharmacy: number | null; vacations: number; office: number; activities: number
}

export const PROSPECTION_COMMENT = 'Prospection Phase'

/** One line: PM file (+ Pharmacy file) joined by normalised name, matched to the system, sorted by manager then rep. `prospection` = normalised names of the Prospection Phase list. */
export function buildLineRows(line: number, pm: FileRep[], pharmacy: FileRep[] | null, sys: SystemRep[], prospection: ReadonlySet<string> = new Set()): DailyRow[] {
  const ph = new Map((pharmacy ?? []).map((r) => [r.norm, r]))
  const seen = new Set<string>()
  const rows: DailyRow[] = []
  const add = (name: string, norm: string, p: FileRep | undefined, h: FileRep | undefined) => {
    seen.add(norm)
    const s = matchSystemRep(sys, line, norm)
    const pros = prospection.has(norm)
    const vac = p?.vacations ?? 0, off = p?.office ?? 0, act = p?.activities ?? 0, visits = p?.visits ?? 0
    rows.push({
      key: `${line}|${norm}`, rep: name, norm,
      districtManager: s ? (s.district_manager?.trim() || UNASSIGNED) : UNASSIGNED,
      status: s ? s.status : NOT_IN_SYSTEM, inSystem: s !== null,
      prospection: pros, reporting: pros ? 'Reported Day' : reportingStatus(visits, vac, off, act), pm: visits, pharmacy: pharmacy === null ? null : (h?.visits ?? 0), vacations: vac, office: off, activities: act,
    })
  }
  for (const p of pm) add(p.name, p.norm, p, ph.get(p.norm))
  for (const h of pharmacy ?? []) if (!seen.has(h.norm)) add(h.name, h.norm, undefined, h) // Pharmacy-only rep: no PM row -> PM 0
  return rows.sort((a, b) => a.districtManager.localeCompare(b.districtManager) || a.rep.localeCompare(b.rep))
}

/* ------------------------------ cards ------------------------------ */
export interface Cards {
  active: number; reported: number; unreported: number; followUp: number
  avgPm: number | null; avgPharmacy: number | null
  /** The line has no Pharmacy file: show "No pharmacy file" instead of a number. */
  noPharmacy: boolean
  vacations: number; office: number; activities: number
  working: number // W: reps who actually worked in the field
}

export function computeCards(rows: DailyRow[]): Cards {
  const nRep = rows.filter((r) => r.reporting === 'Reported Day').length
  const nUn = rows.filter((r) => r.reporting === 'Unreported Day').length
  const nFol = rows.filter((r) => r.reporting === 'Follow Up Required').length
  const sum = (f: (r: DailyRow) => number) => rows.reduce((a, r) => a + f(r), 0)
  const V = sum((r) => r.vacations), O = sum((r) => r.office), A = sum((r) => r.activities)
  const W = nRep - V - O - A + nUn + nFol
  return {
    active: nRep + nUn + nFol, reported: nRep + nFol, unreported: nUn, followUp: nFol,
    avgPm: W > 0 ? sum((r) => r.pm) / W : null, avgPharmacy: W > 0 ? sum((r) => r.pharmacy ?? 0) / W : null, noPharmacy: rows.length > 0 && rows.every((r) => r.pharmacy === null),
    vacations: V, office: O, activities: A, working: W,
  }
}

/** One decimal, or an em dash when there is no working rep. */
export const fmtAvg = (v: number | null): string => (v === null ? '—' : v.toFixed(1))
/** Visits can be half days (0.5): show them as they are. */
export const NO_PHARMACY = 'No pharmacy file'
export const fmtNum = (v: number): string => String(Math.round(v * 100) / 100)

export const STATUS_COLORS: Record<ReportingStatus, { bg: string; fg: string }> = {
  'Reported Day': { bg: 'C6EFCE', fg: '006100' },
  'Unreported Day': { bg: 'FFC7CE', fg: '9C0006' },
  'Follow Up Required': { bg: 'FFEB9C', fg: '9C6500' },
}

/** Comment shown for a row: what was typed (even empty), else "Prospection Phase" for a prospection rep. */
export const defaultComment = (r: Pick<DailyRow, 'prospection'>): string => (r.prospection ? PROSPECTION_COMMENT : '')

/** Names in the Prospection list that appear in none of the rows. */
export function unseenProspection(list: string[], rows: Pick<DailyRow, 'norm'>[]): string[] {
  const seen = new Set(rows.map((r) => r.norm))
  return list.filter((n) => !seen.has(normName(n)))
}

export const commentKey = (date: string, line: number, norm: string): string => `daily-reporting:${date}:${line}:${norm}`

/** Yesterday as YYYY-MM-DD from a local date. */
export function yesterdayIso(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
