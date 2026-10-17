import { normHeader, serialToIso, type Cell } from '../list/listParse'
import { idText, keepText, parseVisitDate } from '../visits/visitsParse'

/** A coaching row as load_coaching_chunk expects it, with `month` as 'YYYY-MM-01' for client-side grouping (sent as 'YYYY-MM'). */
export interface CoachingRow {
  month: string
  team_name: string | null
  emp_id: string | null
  emp_name: string
  skill_code: string
  skill_name: string | null
  visit_id: string
  /** ISO YYYY-MM-DD (the file has M/D/YYYY). */
  visit_date: string
  evaluator: string | null
  /** Kept as text, as the spec says. */
  score: string
}

/** The 10 columns of the file, in order; they are also the keys sent to the database (month as YYYY-MM). */
export const COACHING_COLUMNS: { key: Exclude<keyof CoachingRow, never>; required: boolean }[] = [
  { key: 'team_name', required: false },
  { key: 'emp_id', required: false },
  { key: 'emp_name', required: true },
  { key: 'month', required: true },
  { key: 'skill_code', required: true },
  { key: 'skill_name', required: false },
  { key: 'visit_id', required: true },
  { key: 'visit_date', required: true },
  { key: 'evaluator', required: false },
  { key: 'score', required: true },
]
export const COACHING_HEADERS = COACHING_COLUMNS.map((c) => c.key as string)
export const SKILLS_PER_VISIT = 15

export function matchCoachingHeaders(headers: string[]): { index: Partial<Record<string, number>>; missing: string[] } {
  const byNorm = new Map<string, number>()
  headers.forEach((h, i) => {
    const n = normHeader(h)
    if (n && !byNorm.has(n)) byNorm.set(n, i)
  })
  const index: Partial<Record<string, number>> = {}
  const missing: string[] = []
  for (const c of COACHING_COLUMNS) {
    const hit = byNorm.get(normHeader(c.key))
    if (hit !== undefined) index[c.key] = hit
    else if (c.required) missing.push(c.key)
  }
  return { index, missing }
}

/** 'YYYY-MM' (also 'YYYY-M', 'YYYY/MM', ISO dates, Excel serials) -> 'YYYY-MM-01'; anything else -> null. */
export function parseCoachingMonth(v: Cell): string | null {
  if (v === null) return null
  if (typeof v === 'number') { const iso = serialToIso(Math.floor(v)); return iso ? `${iso.slice(0, 7)}-01` : null }
  const m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?/.exec(v.trim())
  if (!m) return null
  const mo = Number(m[2])
  return mo >= 1 && mo <= 12 ? `${m[1]}-${String(mo).padStart(2, '0')}-01` : null
}

/** M/D/YYYY (month first) -> ISO; ISO and Excel serials are read as they are. */
export const parseCoachingDate = (v: Cell): string | null => parseVisitDate(v, 'mdy')

/** Score kept as text; must be a number to be accepted. */
export function scoreText(v: Cell): string | null {
  if (v === null) return null
  const t = typeof v === 'number' ? String(v) : v.trim()
  return t !== '' && Number.isFinite(Number(t)) ? t : null
}

export { idText, keepText }

/** Row as sent to the database: exactly the 10 file columns, month as 'YYYY-MM'. */
export function toPayload(r: CoachingRow): Record<string, string | null> {
  return {
    team_name: r.team_name, emp_id: r.emp_id, emp_name: r.emp_name, month: r.month.slice(0, 7), skill_code: r.skill_code,
    skill_name: r.skill_name, visit_id: r.visit_id, visit_date: r.visit_date, evaluator: r.evaluator, score: r.score,
  }
}

/** Visits with fewer than 15 distinct skills in the file. */
export function incompleteVisits(rows: CoachingRow[]): string[] {
  const m = new Map<string, Set<string>>()
  for (const r of rows) {
    const s = m.get(r.visit_id)
    if (s) s.add(r.skill_code)
    else m.set(r.visit_id, new Set([r.skill_code]))
  }
  return [...m].filter(([, s]) => s.size < SKILLS_PER_VISIT).map(([id]) => id)
}
