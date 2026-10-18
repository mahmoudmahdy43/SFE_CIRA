import { useMemo } from 'react'
import type { LoadOutcome } from './types'
import { groupRejectedByReason } from './rejected.ts'

/** Rejected rows grouped by reason: count per reason, first 20 rows of each group expandable. */
export default function RejectedGroups({ outcome }: { outcome: LoadOutcome }) {
  const groups = useMemo(() => groupRejectedByReason(outcome.rejected, 20), [outcome.rejected])
  const label = outcome.contextLabel ?? 'Month / rep / account / doctor'
  const listed = outcome.rejected.length
  return (
    <>
      <ul className="divide-y rounded-control border">
        {groups.map((g) => (
          <li key={g.reason}>
            <details className="group">
              <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted">
                <span className="min-w-0 break-words">{g.reason}</span>
                <span className="tnum shrink-0 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">{g.count.toLocaleString()}</span>
              </summary>
              <div className="max-h-64 overflow-auto border-t px-3 py-2">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 pr-4 font-medium">Excel row</th><th className="py-1.5 font-medium">{label}</th></tr></thead>
                  <tbody>
                    {g.rows.map((r, i) => (
                      <tr key={i} className="border-b last:border-0"><td className="tnum py-1.5 pr-4">{r.excelRow ?? '?'}</td><td className="tnum py-1.5 text-muted-foreground">{r.context}</td></tr>
                    ))}
                  </tbody>
                </table>
                {g.count > g.rows.length && <p className="mt-2 text-xs text-muted-foreground">Showing the first {g.rows.length} of {g.count.toLocaleString()} — download the CSV for all.</p>}
              </div>
            </details>
          </li>
        ))}
      </ul>
      {listed < outcome.rejectedCount && (
        <p className="mt-2 text-xs text-muted-foreground">The database lists at most the first 200 rejected rows per chunk, so these counts cover {listed.toLocaleString()} of the {outcome.rejectedCount.toLocaleString()} rejected rows.</p>
      )}
    </>
  )
}
