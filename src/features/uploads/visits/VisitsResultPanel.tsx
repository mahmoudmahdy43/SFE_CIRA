import { Link } from 'react-router-dom'
import { Card } from '../../../components/ui/misc'
import type { ProcessResult } from '../../../lib/api/visits'
import { cn } from '../../../lib/utils'
import type { LoadOutcome } from '../types'

export type VisitsExtra = Record<string, ProcessResult | { error: string }>

interface Item { label: string; value: number; section?: string }

/** Per-month result cards from process_visits_month; non-zero warnings link to Data Quality. */
export default function VisitsResultPanel({ outcome }: { outcome: LoadOutcome; onViewChanges: (m: string) => void }) {
  const extra = (outcome.extra ?? {}) as VisitsExtra
  return (
    <div className="space-y-4">
      {outcome.months.map((m) => {
        const r = extra[m]
        if (!r) return null
        if ('error' in r) {
          return (
            <Card key={m} className="p-5">
              <h3 className="tnum text-sm font-semibold">{m.slice(0, 7)}</h3>
              <p role="alert" className="mt-2 text-sm text-danger">Matching failed: {r.error}. Use “Re-match” in Data Quality once the cause is fixed.</p>
            </Card>
          )
        }
        const facts: Item[] = [
          { label: 'Rows', value: r.rows },
          { label: 'Unique visits', value: r.unique_visits },
          { label: 'Rep rows', value: r.rep_rows },
          { label: 'Manager rows', value: r.manager_rows },
          { label: 'Matched', value: r.matched },
        ]
        const warns: Item[] = [
          { label: 'Not in list', value: r.not_in_list, section: 'unmatched' },
          { label: 'Unmatched', value: r.unmatched, section: 'unmatched' },
          { label: 'Without territory', value: r.no_territory, section: 'noterritory' },
        ]
        return (
          <Card key={m} className="p-5">
            <h3 className="tnum mb-3 text-sm font-semibold">{m.slice(0, 7)}</h3>
            <dl className="grid gap-3 sm:grid-cols-5">
              {facts.map((f) => (
                <div key={f.label}>
                  <dt className="text-xs text-muted-foreground">{f.label}</dt>
                  <dd className="tnum text-xl font-semibold">{f.value.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-1 text-xs text-muted-foreground">Unique visits is the company total: a Double visit (rep row + manager row) is counted once.</p>
            <div className="mt-4 grid gap-3 border-t pt-3 sm:grid-cols-3">
              {warns.map((w) => (
                <div key={w.label}>
                  <div className="text-xs text-muted-foreground">{w.label}</div>
                  <div className={cn('tnum text-lg font-semibold', w.value > 0 && 'text-warning')}>{w.value.toLocaleString()}</div>
                  {w.value > 0 && w.section && (
                    <Link to={`/data-quality?month=${m}&section=${w.section}`} className="text-xs font-medium text-accent-foreground underline underline-offset-2">Review in Data Quality</Link>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
