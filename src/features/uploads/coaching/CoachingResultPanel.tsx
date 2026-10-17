import { Card } from '../../../components/ui/misc'
import { cn } from '../../../lib/utils'
import type { LoadOutcome } from '../types'
import { EXCLUDED_REASON, type CoachingExtra, type NameCount } from './coachingResult'

export interface CoachingOutcomeExtra extends CoachingExtra {
  /** Rejected rows whose reason is "excluded evaluator" (expected). */
  excludedRows: number
  /** False when the database reported fewer rejected rows than it rejected (it lists at most 200 per chunk). */
  excludedExact: boolean
}

function Names({ title, hint, items }: { title: string; hint: string; items: NameCount[] }) {
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold">{title} <span className={cn('tnum ml-1', items.length > 0 ? 'text-warning' : 'text-muted-foreground')}>({items.length})</span></h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">None.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          <ul className="mt-2 flex max-h-48 flex-wrap gap-1.5 overflow-auto">
            {items.map((x) => (
              <li key={x.name} className="rounded-full border bg-warning-soft px-2.5 py-0.5 text-xs text-warning">{x.name}{x.count !== null ? ` (${x.count.toLocaleString()})` : ''}</li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

/** Result screen of the Coaching wizard: visits loaded, excluded evaluators, unmatched names, incomplete visits. */
export default function CoachingResultPanel({ outcome }: { outcome: LoadOutcome; onViewChanges: (m: string) => void }) {
  const x = outcome.extra as CoachingOutcomeExtra | undefined
  if (!x) return null
  const other = x.excludedExact ? Math.max(0, outcome.rejectedCount - x.excludedRows) : null
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <dl className="grid gap-3 sm:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Visits loaded</dt><dd className="tnum text-xl font-semibold">{x.visits === null ? '—' : x.visits.toLocaleString()}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Excluded evaluators (rows)</dt><dd className="tnum text-xl font-semibold">{x.excludedExact ? '' : '≥ '}{x.excludedRows.toLocaleString()}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Other rejected rows</dt><dd className={cn('tnum text-xl font-semibold', other !== null && other > 0 && 'text-danger')}>{other === null ? '—' : other.toLocaleString()}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Incomplete visits (&lt; 15 skills)</dt><dd className={cn('tnum text-xl font-semibold', x.incompleteCount > 0 && 'text-warning')}>{x.incompleteCount.toLocaleString()}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">Rows of excluded evaluators are expected to be rejected: they are not part of the coaching report.</p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Names title="Unmatched reps" hint="These names are not in the master data: fix them there, then upload the months again." items={x.unmatchedReps} />
        <Names title="Unmatched evaluators" hint="These evaluators are not in the master data: fix them there, then upload the months again." items={x.unmatchedEvaluators} />
      </div>
      {x.incompleteList.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold">Incomplete visit IDs</h3>
          <p className="tnum mt-2 max-h-32 overflow-auto text-xs text-muted-foreground">{x.incompleteList.join(', ')}</p>
        </Card>
      )}
    </div>
  )
}

export { EXCLUDED_REASON }
