import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { AlertTriangle, Download, Loader2 } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Card, Progress } from '../../../components/ui/misc'
import { fetchRawSummary } from '../../../lib/api/visitsRaw'
import RejectedGroups from '../RejectedGroups'
import type { LoadOutcome } from '../types'
import VisitsResultPanel from './VisitsResultPanel'
import { normalizeSummary, splitOwnerRejections, type NameCount, type RawSummary } from './rawVisitsResult'

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

function NameList({ title, hint, items }: { title: string; hint: string; items: NameCount[] }) {
  if (items.length === 0) return null
  return (
    <Card className="p-5">
      <h3 className="mb-1 text-sm font-semibold">{title} ({items.length.toLocaleString()})</h3>
      <p className="mb-3 text-sm text-muted-foreground">{hint}</p>
      <ul className="max-h-56 space-y-1 overflow-auto text-sm">
        {items.map((x) => <li key={x.name} className="flex justify-between gap-3"><span>{x.name}</span>{x.count !== null && <span className="tnum text-muted-foreground">{x.count.toLocaleString()}</span>}</li>)}
      </ul>
    </Card>
  )
}

function exportUnlinked(s: RawSummary): void {
  const wb = XLSX.utils.book_new()
  const rows = s.unlinked.map((u) => ({ Type: u.type, Account: u.account, Doctor: u.doctor, Why: u.why, Visits: u.visits }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Unlinked samples')
  XLSX.writeFile(wb, 'unlinked-samples.xlsx')
}

/** Result screen of the raw CRM visits upload (after processing): per-month cards, rejected owners, link quality, unlinked samples. */
export default function RawVisitsResult({ outcome, onViewChanges }: { outcome: LoadOutcome; onViewChanges: (m: string) => void }) {
  const [summary, setSummary] = useState<RawSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setError(null)
    setSummary(null)
    fetchRawSummary(outcome.batch).then((r) => setSummary(normalizeSummary(r))).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the summary'))
  }, [outcome.batch])
  useEffect(() => { load() }, [load])

  const split = useMemo(() => splitOwnerRejections(outcome.rejected), [outcome.rejected])
  const otherOutcome = useMemo(() => ({ ...outcome, rejected: split.other }), [outcome, split.other])
  const linkTotal = summary ? summary.linkMethods.reduce((a, r) => a + r.count, 0) : 0

  return (
    <div className="space-y-4">
      <VisitsResultPanel outcome={outcome} onViewChanges={onViewChanges} />

      {split.owners.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Owners to add to the master data ({split.owners.length.toLocaleString()})</h3>
          <p className="mb-3 text-sm text-muted-foreground">These names were rejected as the owner of a visit. Add them as reps / managers (with a CODE), then upload the files again.</p>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Owner (name in the CRM)</th><th className="py-1.5 font-medium">Problem</th><th className="py-1.5 text-right font-medium">Rejected visits</th></tr></thead>
            <tbody>
              {split.owners.map((o) => (
                <tr key={`${o.kind}|${o.owner}`} className="border-b last:border-0"><td className="py-1.5">{o.owner}</td><td className="py-1.5 text-muted-foreground">{o.kind === 'unknown owner' ? 'Not found in reps / managers' : 'Found, but has no CODE'}</td><td className="tnum py-1.5 text-right">{o.count.toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {split.other.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-2 text-sm font-semibold">Other rejected rows</h3>
          <RejectedGroups outcome={otherOutcome} />
        </Card>
      )}

      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold">Link quality</h3>
        {error ? (
          <div role="alert" className="text-sm text-danger">Could not load the link summary: {error} <Button size="sm" className="ml-2" onClick={load}>Retry</Button></div>
        ) : !summary ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-busy="true"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…</p>
        ) : linkTotal === 0 ? (
          <p className="text-sm text-muted-foreground">No linked visits reported for this batch.</p>
        ) : (
          <ul className="space-y-2.5">
            {summary.linkMethods.map((r) => (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>{r.label} <span className="font-mono text-xs text-muted-foreground">{r.key}</span></span>
                  <span className="tnum"><b>{r.count.toLocaleString()}</b> <span className="text-muted-foreground">· {pct(r.pct)}</span></span>
                </div>
                <Progress label={r.label} value={r.pct} tone={r.good ? 'success' : 'warning'} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {summary && summary.unlinked.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b p-3">
            <h3 className="text-sm font-semibold">Unlinked samples ({summary.unlinked.length.toLocaleString()})</h3>
            <Button size="sm" onClick={() => exportUnlinked(summary)}><Download className="h-4 w-4" aria-hidden /> Excel</Button>
          </div>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted text-left text-xs text-muted-foreground">{['Type', 'Account', 'Doctor', 'Why', 'Visits'].map((h, i) => <th key={h} className={`sticky top-0 bg-muted px-3 py-2 font-medium ${i === 4 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {summary.unlinked.map((u, i) => (
                  <tr key={i} className="border-b last:border-0"><td className="px-3 py-1.5">{u.type}</td><td className="px-3 py-1.5">{u.account}</td><td className="px-3 py-1.5">{u.doctor}</td><td className="px-3 py-1.5 text-muted-foreground">{u.why}</td><td className="tnum px-3 py-1.5 text-right">{u.visits.toLocaleString()}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {summary && <NameList title="Unknown products" hint="Products in the CRM that are not in the product master data." items={summary.unknownProducts} />}
      {summary && <NameList title="Unknown territories" hint="Territories without a match: add an alias for each in the master data (Org → Aliases)." items={summary.unknownTerritories} />}
    </div>
  )
}
