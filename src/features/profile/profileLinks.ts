/**
 * Pure helpers of the 360° view: the profile link builder and the grouping of profile_search results.
 * No DOM, no React: unit-tested with Node's native TypeScript support (explicit .ts imports only).
 */

export type ProfileKind = 'rep' | 'manager' | 'staff' | 'box'

export const PROFILE_KINDS: { kind: ProfileKind; label: string }[] = [
  { kind: 'rep', label: 'Reps' },
  { kind: 'manager', label: 'Managers' },
  { kind: 'staff', label: 'Staff' },
  { kind: 'box', label: 'Boxes' },
]

export const isProfileKind = (v: unknown): v is ProfileKind => v === 'rep' || v === 'manager' || v === 'staff' || v === 'box'

/** Router path of a profile: `/360?type=rep&id=12`. Empty / missing ids give the search page (`/360`). */
export function profileHref(type: ProfileKind, id: number | string | null | undefined): string {
  if (id === null || id === undefined || id === '') return '/360'
  return `/360?type=${type}&id=${encodeURIComponent(String(id))}`
}

/** Reads `type` / `id` from the query string; null when either is missing or the type is unknown. */
export function parseProfileParams(search: string): { type: ProfileKind; id: number } | null {
  const p = new URLSearchParams(search)
  const type = p.get('type')
  const id = Number(p.get('id'))
  if (!isProfileKind(type) || !Number.isInteger(id) || id <= 0) return null
  return { type, id }
}

export interface SearchHit {
  kind: ProfileKind
  id: number
  name: string
  code: string | null
  line: string | null
  extra: string | null
}

const text = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())

/** Normalises profile_search rows; rows with an unknown kind or without an id are dropped. */
export function toSearchHits(rows: unknown): SearchHit[] {
  if (!Array.isArray(rows)) return []
  const out: SearchHit[] = []
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    const kind = text(o.kind)?.toLowerCase()
    const id = Number(o.id)
    if (!isProfileKind(kind) || !Number.isInteger(id)) continue
    out.push({ kind, id, name: text(o.name) ?? `#${id}`, code: text(o.code), line: text(o.line), extra: text(o.extra) })
  }
  return out
}

export interface SearchGroup { kind: ProfileKind; label: string; hits: SearchHit[] }

/** Groups hits by kind in the fixed order Reps, Managers, Staff, Boxes; empty groups are omitted; order inside a group is kept. */
export function groupSearchHits(hits: SearchHit[]): SearchGroup[] {
  return PROFILE_KINDS.map(({ kind, label }) => ({ kind, label, hits: hits.filter((h) => h.kind === kind) })).filter((g) => g.hits.length > 0)
}
