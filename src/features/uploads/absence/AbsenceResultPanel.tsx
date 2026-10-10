import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Skeleton } from '../../../components/ui/misc'
import { ABSENCE_VIEW, fetchAbsenceMonths, type AbsenceMonth } from '../../../lib/api/absence'
import type { LoadOutcome } from '../types'
import type { AbsenceKind } from './absenceParse'

/** Per-month cards (from the v_*_months view) for the months this upload touched. */
export function makeAbsenceResultPanel(kind: AbsenceKind) {
  return function AbsenceResultPanel({ outcome }: { outcome: LoadOutcome; onViewChanges: (m: string) => void }) {
    const [rows, setRows] = useState<AbsenceMonth[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    useEffect(() => {
      let cancelled = false
      fetchAbsenceMonths(kind)
        .then((r) => !cancelled && setRows(r.filter((m) => outcome.months.includes(m.month))))
        .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load month summary'))
      return () => { cancelled = true }
    }, [outcome.months])

    return (
      <div className="space-y-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold">{ABSENCE_VIEW[kind].label} by month</h3>
          <p className="mt-1 text-sm text-muted-foreground">KPIs refreshed for {outcome.months.length} month(s): {outcome.months.map((m) => m.slice(0, 7)).join(', ')}.</p>
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
          {!rows && !error && <Skeleton className="mt-3 h-20" />}
          {rows && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((m) => (
                <div key={m.month} className="rounded-control border p-3">
                  <div className="tnum text-sm font-semibold">{m.month.slice(0, 7)}</div>
                  <dl className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    <div className="flex justify-between"><dt>Rows stored</dt><dd className="tnum text-foreground">{m.rows.toLocaleString()}</dd></div>
                    {m.approved !== undefined && <div className="flex justify-between"><dt>Approved / not</dt><dd className="tnum text-foreground">{m.approved} / {m.not_approved}</dd></div>}
                    <div className="flex justify-between"><dt>Reps</dt><dd className="tnum text-foreground">{m.reps.toLocaleString()}</dd></div>
                    {m.days !== undefined && <div className="flex justify-between"><dt>Days</dt><dd className="tnum text-foreground">{m.days}</dd></div>}
                    <div className="flex justify-between"><dt>First – last</dt><dd className="tnum text-foreground">{m.first_day.slice(5)} – {m.last_day.slice(5)}</dd></div>
                  </dl>
                </div>
              ))}
            </div>
          )}
          <Link to={`/data-quality?month=${outcome.months[0]}&section=missing`} className="mt-4 inline-block text-sm font-medium text-accent-foreground underline underline-offset-2">Review Missing days in Data Quality</Link>
        </Card>
      </div>
    )
  }
}
