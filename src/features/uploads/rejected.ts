/** Group the rows the database rejected by reason (pure, unit-tested). */
import type { RejectedRow } from './types.ts'

export interface RejectedGroup {
  reason: string
  count: number
  /** The first `limit` rows of the group, in the order reported. */
  rows: RejectedRow[]
}

/** Biggest group first; ties by reason text. */
export function groupRejectedByReason(rows: RejectedRow[], limit = 20): RejectedGroup[] {
  const by = new Map<string, RejectedGroup>()
  for (const r of rows) {
    const reason = r.reason.trim() || '(no reason given)'
    const g = by.get(reason) ?? { reason, count: 0, rows: [] }
    g.count++
    if (g.rows.length < limit) g.rows.push(r)
    by.set(reason, g)
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, 'en', { numeric: true }))
}
