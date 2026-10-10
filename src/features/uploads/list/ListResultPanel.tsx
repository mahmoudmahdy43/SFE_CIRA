import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../../components/ui/button'
import { Badge, Card } from '../../../components/ui/misc'
import {
  CHANGE_LABEL, CHANGE_TYPES, DQ_ISSUES, DQ_LABEL, fetchChangeCounts, fetchDqCounts,
  type ChangeType, type DqIssue,
} from '../../../lib/api/lists'
import type { LoadOutcome } from '../types'

const monthLabel = (m: string) => m.slice(0, 7)

/** Target List specific part of the result screen: list changes + Active From warnings. */
export default function ListResultPanel({ outcome, onViewChanges }: { outcome: LoadOutcome; onViewChanges: (m: string) => void }) {
  const [counts, setCounts] = useState<Record<string, Record<ChangeType, number> | 'error'>>({})
  const [dq, setDq] = useState<Record<DqIssue, number> | null | 'error'>(null)

  useEffect(() => {
    let cancelled = false
    for (const m of outcome.months) {
      fetchChangeCounts(m)
        .then((c) => !cancelled && setCounts((p) => ({ ...p, [m]: c })))
        .catch(() => !cancelled && setCounts((p) => ({ ...p, [m]: 'error' })))
    }
    fetchDqCounts(outcome.months).then((c) => !cancelled && setDq(c)).catch(() => !cancelled && setDq('error'))
    return () => { cancelled = true }
  }, [outcome.months])

  return (
    <>
      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold">List changes vs previous month</h3>
        <ul className="divide-y">
          {outcome.months.map((m) => {
            const c = counts[m]
            return (
              <li key={m} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span className="tnum text-sm font-medium">{monthLabel(m)}</span>
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  {!c ? <span className="text-muted-foreground">Loading…</span> : c === 'error' ? <span className="text-danger">Could not load changes</span> : CHANGE_TYPES.map((t) => <Badge key={t} tone={t === 'removed' ? 'danger' : t === 'added' ? 'success' : 'info'}>{CHANGE_LABEL[t]} <span className="tnum">{c[t].toLocaleString()}</span></Badge>)}
                  <Button size="sm" variant="ghost" onClick={() => onViewChanges(m)}>View details</Button>
                </span>
              </li>
            )
          })}
        </ul>
      </Card>

      <Card className="p-5">
        <h3 className="mb-1 text-sm font-semibold">Active From checks (warnings)</h3>
        <p className="mb-3 text-sm text-muted-foreground">Active From is for review only — the month is determined by the snapshot. These checks never block an upload.</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {!dq ? <span className="text-muted-foreground">Checking…</span> : dq === 'error' ? <span className="text-danger">Could not load the checks</span> : DQ_ISSUES.map((i) => <Badge key={i} tone={dq[i] > 0 ? 'warning' : 'success'}>{DQ_LABEL[i]} <span className="tnum">{dq[i].toLocaleString()}</span></Badge>)}
          <Link to={`/data-quality?month=${outcome.months[0]}`} className="ml-2 text-sm font-medium text-accent-foreground underline underline-offset-2">Open Data Quality</Link>
        </div>
      </Card>
    </>
  )
}
