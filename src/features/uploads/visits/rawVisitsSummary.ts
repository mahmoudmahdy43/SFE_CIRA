/**
 * Result screen of the raw CRM visits upload: link quality, owner rejections, unlinked samples.
 * Pure functions, unit-tested. visits_raw_summary's JSON is read tolerantly (object map or array rows,
 * a few key spellings) because the exact shape is defined in the database, not here.
 */
import type { RejectedRow } from '../types.ts'

/** Spec order. The first four are healthy (green); everything else is amber. */
export const LINK_METHODS: { key: string; label: string; good: boolean }[] = [
  { key: 'name', label: 'Matched by name (unique)', good: true },
  { key: 'name+rep', label: 'Several candidates — resolved by rep', good: true },
  { key: 'name+territory', label: 'Several candidates — resolved by territory', good: true },
  { key: 'name_outside_list', label: 'Known doctor, not in that month’s list', good: true },
  { key: 'ambiguous', label: 'Ambiguous', good: false },
  { key: 'not_found', label: 'Not found', good: false },
  { key: 'no_name', label: 'No name in the CRM', good: false },
]

export interface LinkRow { key: string; label: string; good: boolean; count: number; pct: number }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const pick = (o: Obj, keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]
  return undefined
}
const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v))

/** link_methods as {method: n} or [{method, n|count|rows|visits}] -> rows in spec order with counts and %. */
export function normalizeLinkMethods(v: unknown): LinkRow[] {
  const counts = new Map<string, number>()
  if (Array.isArray(v)) {
    for (const e of v) {
      if (!isObj(e)) continue
      const k = text(pick(e, ['method', 'link_method', 'name', 'key', 'how'])).trim()
      if (k) counts.set(k, (counts.get(k) ?? 0) + num(pick(e, ['n', 'count', 'rows', 'visits', 'total'])))
    }
  } else if (isObj(v)) {
    for (const [k, c] of Object.entries(v)) counts.set(k, num(c))
  }
  const known = new Set(LINK_METHODS.map((m) => m.key))
  const defs = [...LINK_METHODS, ...[...counts.keys()].filter((k) => !known.has(k)).map((k) => ({ key: k, label: k, good: false }))]
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  return defs
    .map((d) => ({ ...d, count: counts.get(d.key) ?? 0, pct: total > 0 ? (counts.get(d.key) ?? 0) / total : 0 }))
    .filter((r) => r.count > 0 || LINK_METHODS.some((m) => m.key === r.key))
}

export interface UnlinkedSample { type: string; account: string; doctor: string; why: string; visits: number }

export function normalizeUnlinked(v: unknown): UnlinkedSample[] {
  if (!Array.isArray(v)) return []
  return v.filter(isObj).map((o) => ({
    type: text(pick(o, ['acc_type', 'account_type', 'type'])),
    account: text(pick(o, ['acc_name', 'account', 'account_name'])),
    doctor: text(pick(o, ['doctor_name', 'doctor'])),
    why: text(pick(o, ['why', 'reason', 'link_method', 'method'])),
    visits: num(pick(o, ['visits', 'n', 'count', 'rows'])),
  }))
}

export interface NameCount { name: string; count: number | null }

/** unknown_products / unknown_territories: ["x"] or [{name|product|territory, n|count|visits}]. */
export function normalizeNameCounts(v: unknown): NameCount[] {
  if (!Array.isArray(v)) return []
  return v.map((e): NameCount => {
    if (isObj(e)) {
      const c = pick(e, ['n', 'count', 'visits', 'rows'])
      return { name: text(pick(e, ['name', 'product', 'territory', 'value'])), count: c === undefined ? null : num(c) }
    }
    return { name: text(e), count: null }
  }).filter((x) => x.name !== '')
}

export interface RawSummary {
  linkMethods: LinkRow[]
  unlinked: UnlinkedSample[]
  unknownProducts: NameCount[]
  unknownTerritories: NameCount[]
}

export function normalizeSummary(raw: unknown): RawSummary {
  let o: unknown = raw
  if (typeof o === 'string') { try { o = JSON.parse(o) } catch { o = null } }
  if (Array.isArray(o) && o.length === 1) o = o[0] // a function returning a one-row table
  const s: Obj = isObj(o) ? o : {}
  return {
    linkMethods: normalizeLinkMethods(s.link_methods),
    unlinked: normalizeUnlinked(s.unlinked_samples),
    unknownProducts: normalizeNameCounts(s.unknown_products),
    unknownTerritories: normalizeNameCounts(s.unknown_territories),
  }
}

export interface OwnerRejection { owner: string; kind: 'unknown owner' | 'owner has no CODE'; count: number }

/**
 * Split the rejected rows: `unknown owner X` / `owner has no CODE: X` become one line per distinct owner name
 * (they must be added to the master data); everything else stays as rows for the by-reason list.
 */
export function splitOwnerRejections(rejected: RejectedRow[]): { owners: OwnerRejection[]; other: RejectedRow[] } {
  const by = new Map<string, OwnerRejection>()
  const other: RejectedRow[] = []
  for (const r of rejected) {
    const reason = r.reason.trim()
    const m = /^(unknown owner|owner has no code)\s*:?\s*(.+)$/i.exec(reason)
    if (!m) { other.push(r); continue }
    const kind = m[1].toLowerCase() === 'unknown owner' ? 'unknown owner' : 'owner has no CODE'
    const owner = m[2].trim()
    const key = `${kind}|${owner}`
    const g = by.get(key) ?? { owner, kind, count: 0 }
    g.count++
    by.set(key, g)
  }
  return { owners: [...by.values()].sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner)), other }
}
