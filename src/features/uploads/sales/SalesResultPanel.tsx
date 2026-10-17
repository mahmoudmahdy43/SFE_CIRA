import { Download } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Card } from '../../../components/ui/misc'
import { downloadCsv } from '../../../lib/csv'
import { cn } from '../../../lib/utils'
import type { LoadOutcome } from '../types'
import type { SalesExtra } from './salesLoad'
import { cellText, columnsOf, headerOf, type Obj } from './salesResult'

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' | 'warn' }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('tnum text-xl font-semibold', tone === 'bad' && 'text-danger', tone === 'warn' && 'text-warning')}>{value}</dd>
    </div>
  )
}

function ObjTable({ rows, preferred, csv, limit = 200 }: { rows: Obj[]; preferred?: string[]; csv: string; limit?: number }) {
  const cols = columnsOf(rows, preferred)
  return (
    <>
      <div className="mt-2 max-h-72 overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead><tr className="bg-muted text-left text-xs text-muted-foreground">{cols.map((c) => <th key={c} className="sticky top-0 whitespace-nowrap bg-muted px-3 py-1.5 font-medium">{headerOf(c)}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, limit).map((r, i) => (
              <tr key={i} className="border-t">{cols.map((c) => <td key={c} className={cn('whitespace-nowrap px-3 py-1.5', typeof r[c] === 'number' && 'tnum text-right')}>{cellText(r[c])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{rows.length > limit ? `Showing the first ${limit} of ${rows.length.toLocaleString()}.` : `${rows.length.toLocaleString()} row(s).`}</span>
        <Button size="sm" onClick={() => downloadCsv(csv, rows.map((r) => Object.fromEntries(cols.map((c) => [headerOf(c), r[c] as never]))))}><Download className="h-4 w-4" aria-hidden /> CSV</Button>
      </div>
    </>
  )
}

/** Result screen of the Sales wizard. */
export default function SalesResultPanel({ outcome }: { outcome: LoadOutcome; onViewChanges: (m: string) => void }) {
  const x = outcome.extra as SalesExtra | undefined
  if (!x) return null
  const f = x.fin
  const notFoundRows = x.notFound.reduce((a, n) => a + n.count, 0)
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Rows loaded" value={(f?.rows ?? outcome.loaded).toLocaleString()} />
          <Stat label="Skipped (all zero)" value={f?.skippedZero === null || !f ? '—' : f.skippedZero.toLocaleString()} />
          <Stat label="Rejected rows" value={outcome.rejectedCount.toLocaleString()} tone={outcome.rejectedCount > 0 ? 'bad' : undefined} />
          <Stat label="Total mismatches" value={f ? f.mismatch.length.toLocaleString() : '—'} tone={f && f.mismatch.length > 0 ? 'bad' : undefined} />
          <Stat label="Rows without org" value={f ? f.rowsWithoutOrg.count.toLocaleString() : '—'} tone={f && f.rowsWithoutOrg.count > 0 ? 'warn' : undefined} />
          <Stat label="Territories without sales" value={f ? f.territoriesWithoutSales.count.toLocaleString() : '—'} />
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">All-zero rows are skipped on purpose. Totals are compared with the company row of each file.</p>
      </Card>

      {f && f.mismatch.length > 0 && (
        <Card className="border-danger/50 p-5">
          <h3 className="text-sm font-semibold text-danger">Total mismatch — file vs loaded ({f.mismatch.length})</h3>
          <p className="mt-1 text-xs text-muted-foreground">This must be empty. Check the listed line / month before using the report.</p>
          <ObjTable rows={f.mismatch} preferred={['month', 'line']} csv="sales-total-mismatch.csv" />
        </Card>
      )}

      {x.notFound.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold">Territories not found <span className="tnum ml-1 text-danger">({x.notFound.length}, {notFoundRows.toLocaleString()} rows)</span></h3>
          <p className="mt-1 text-xs text-muted-foreground">These names need a territory alias in master data. Add it, then upload the affected months again.</p>
          <ul className="mt-2 flex max-h-48 flex-wrap gap-1.5 overflow-auto">
            {x.notFound.map((n) => <li key={n.name} className="rounded-full border bg-danger-soft px-2.5 py-0.5 text-xs text-danger">{n.name} ({n.count.toLocaleString()})</li>)}
          </ul>
        </Card>
      )}

      {x.otherRejected.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold">Other rejected rows ({x.otherRejected.length.toLocaleString()})</h3>
          <ul className="mt-2 max-h-48 list-disc space-y-0.5 overflow-auto pl-5 text-sm">{x.otherRejected.slice(0, 100).map((t, i) => <li key={i}>{t}</li>)}</ul>
        </Card>
      )}

      {f && f.rowsWithoutOrg.list.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold">Sales rows whose territory has no org record that month ({f.rowsWithoutOrg.count.toLocaleString()})</h3>
          <ObjTable rows={f.rowsWithoutOrg.list} csv="sales-rows-without-org.csv" />
        </Card>
      )}

      {f && f.territoriesWithoutSales.list.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold">Territories without sales ({f.territoriesWithoutSales.count.toLocaleString()})</h3>
          <ObjTable rows={f.territoriesWithoutSales.list} csv="sales-territories-without-sales.csv" />
        </Card>
      )}

      {f && f.repDiffers.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold">Review — rep name differs from the system ({f.repDiffers.length.toLocaleString()})</h3>
          <p className="mt-1 text-xs text-muted-foreground">The system value is used.</p>
          <ObjTable rows={f.repDiffers} preferred={['month', 'line', 'territory']} csv="sales-rep-name-differs.csv" />
        </Card>
      )}

      {x.refreshWarnings.length > 0 && (
        <div role="alert" className="rounded-card border border-warning/50 bg-warning-soft px-4 py-3 text-sm text-warning">
          <p className="font-medium">Field activity could not be refreshed for some months (the sales are loaded):</p>
          <ul className="mt-1 list-disc pl-5">{x.refreshWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
    </div>
  )
}
