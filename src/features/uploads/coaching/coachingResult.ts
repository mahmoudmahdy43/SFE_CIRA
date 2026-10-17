/** Tolerant reading of what finalize_coaching returns (names as strings or {name, count} objects; counts or lists). */
export interface NameCount { name: string; count: number | null }
export interface CoachingExtra {
  visits: number | null
  unmatchedReps: NameCount[]
  unmatchedEvaluators: NameCount[]
  incompleteCount: number
  incompleteList: string[]
}

const NAME_KEYS = ['name', 'emp_name', 'rep_name', 'evaluator', 'rep', 'visit_id', 'value']
const COUNT_KEYS = ['count', 'n', 'rows', 'visits']

function nameCounts(v: unknown): NameCount[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((x): NameCount[] => {
    if (x === null || x === undefined) return []
    if (typeof x === 'string' || typeof x === 'number') return [{ name: String(x), count: null }]
    if (typeof x === 'object') {
      const o = x as Record<string, unknown>
      const key = NAME_KEYS.find((k) => o[k] !== undefined && o[k] !== null)
      const ck = COUNT_KEYS.find((k) => typeof o[k] === 'number')
      return [{ name: key ? String(o[key]) : Object.values(o).map(String).join(' / '), count: ck ? (o[ck] as number) : null }]
    }
    return []
  })
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

/** finalize_coaching may answer for the whole call or once per month (array of objects): merge both shapes. */
export function readFinalize(raw: unknown): CoachingExtra {
  const parts: Record<string, unknown>[] = Array.isArray(raw) ? raw.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : raw && typeof raw === 'object' ? [raw as Record<string, unknown>] : []
  const out: CoachingExtra = { visits: null, unmatchedReps: [], unmatchedEvaluators: [], incompleteCount: 0, incompleteList: [] }
  const merge = (into: NameCount[], add: NameCount[]) => {
    for (const a of add) {
      const hit = into.find((x) => x.name === a.name)
      if (hit) hit.count = hit.count === null || a.count === null ? hit.count ?? a.count : hit.count + a.count
      else into.push({ ...a })
    }
  }
  for (const p of parts) {
    const v = num(p.visits ?? p.visits_loaded ?? p.loaded_visits)
    if (v !== null) out.visits = (out.visits ?? 0) + v
    merge(out.unmatchedReps, nameCounts(p.unmatched_reps))
    merge(out.unmatchedEvaluators, nameCounts(p.unmatched_evaluators))
    const inc = p.incomplete_visits
    if (Array.isArray(inc)) {
      const names = nameCounts(inc).map((x) => x.name)
      out.incompleteList.push(...names)
      out.incompleteCount += names.length
    } else {
      const c = num(inc)
      if (c !== null) out.incompleteCount += c
    }
  }
  return out
}

export const EXCLUDED_REASON = /excluded\s+evaluator/i
