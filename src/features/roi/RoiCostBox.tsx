import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/misc'
import { saveVisitCost } from '../../lib/api/roi'
import { isYM, monthShort } from '../dashboard/periodMath'
import { costFor, parseCost, type CostRow } from './roiMath'

/** Cost per visit: the value that applies to the last month of the period, a month to apply a new value from, and the history. */
export function RoiCostBox({ history, toYM, onSaved }: { history: CostRow[]; toYM: string; onSaved: () => void }) {
  const current = costFor(history, toYM)
  const [text, setText] = useState(String(current))
  const [from, setFrom] = useState(toYM)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setText(String(current)); setFrom(toYM) }, [current, toYM])

  const cost = parseCost(text)
  const canSave = cost !== null && isYM(from) && !busy
  const save = async () => {
    if (cost === null || !isYM(from)) return
    setBusy(true)
    try {
      await saveVisitCost(from, cost)
      toast.success(`Cost per visit: ${cost.toLocaleString('en-US')} EGP from ${monthShort(from)}`)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }
  const sorted = [...history].sort((a, b) => b.month_from.localeCompare(a.month_from))

  return (
    <Card className="w-full p-3 sm:w-72">
      <div className="space-y-2">
        <label className="block text-xs font-medium text-muted-foreground" htmlFor="roi-cost">Cost per visit (EGP)</label>
        <input id="roi-cost" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={cost === null}
          className="tnum h-8 w-full rounded-control border bg-card px-2 text-13 aria-[invalid=true]:border-danger" />
        <label className="block text-xs font-medium text-muted-foreground" htmlFor="roi-cost-from">Apply from</label>
        <div className="flex items-center gap-2">
          <input id="roi-cost-from" type="month" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 min-w-0 flex-1 rounded-control border bg-card px-2 text-13" />
          <Button size="sm" variant="primary" disabled={!canSave} onClick={() => void save()}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}Save
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Earlier months keep their old value.</p>
      </div>
      <details className="mt-2 border-t pt-2 text-xs">
        <summary className="cursor-pointer font-medium text-muted-foreground">Cost history ({sorted.length})</summary>
        <ul className="mt-1 space-y-0.5" aria-label="Cost history">
          {sorted.length === 0 && <li className="text-muted-foreground">No entries — default 600 EGP.</li>}
          {sorted.map((h) => (
            <li key={h.month_from} className="flex justify-between"><span>from {monthShort(h.month_from.slice(0, 7))}</span><span className="tnum font-medium">{h.cost.toLocaleString('en-US')}</span></li>
          ))}
        </ul>
      </details>
    </Card>
  )
}
