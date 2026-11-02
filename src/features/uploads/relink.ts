/** One relink_strict(p_apply = true) result; the keys keep their "would_" names even when applied. */
export interface RelinkResult {
  visits_checked: number
  already_correct: number
  would_newly_link: number
  would_relink_to_other_doctor: number
  would_unlink_bad_links: number
  unlinked_stay_unlinked: number
}

export interface RelinkSummary { newlyLinked: number; relinked: number; unlinked: number; stillUnlinked: number }

export const RELINK_LINES = [1, 2, 3] as const

export function sumRelinks(rs: Partial<RelinkResult>[]): RelinkSummary {
  const add = (k: keyof RelinkResult) => rs.reduce((a, r) => a + (r[k] ?? 0), 0)
  return { newlyLinked: add('would_newly_link'), relinked: add('would_relink_to_other_doctor'), unlinked: add('would_unlink_bad_links'), stillUnlinked: add('unlinked_stay_unlinked') }
}
