import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable } from '../../components/app/DataTable'
import { PagedTable, type PagedColumn } from '../../components/app/PagedTable'
import { ErrorState } from '../../components/app/states'
import { Button } from '../../components/ui/button'
import { Combobox } from '../../components/ui/combobox'
import { Badge, Card, Input, Skeleton } from '../../components/ui/misc'
import { Dialog, DialogContent } from '../../components/ui/overlay'
import {
  fetchNoTerritory, fetchNonWorkAll, fetchNonWorkPage, fetchPairingAll,
  fetchPairingPage, fetchUnlinkedAll, fetchUnlinkedCounts, fetchUnlinkedPage, rematchMonth, UNLINKED_REASONS,
  type GenericRow, type NoTerritoryGroup, type NonWorkRow, type UnlinkedReason, type UnlinkedRow,
} from '../../lib/api/dqVisits'
import type { ProcessResult } from '../../lib/api/visits'
import { useOrg } from '../../lib/api/org'
import { AddAlias } from '../org/AliasesTab'
import { cn } from '../../lib/utils'

export function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={`dq-${id}`} aria-labelledby={`dq-h-${id}`} className="mb-10 scroll-mt-20">
      <h2 id={`dq-h-${id}`} className="text-base font-semibold">{title}</h2>
      {description && <p className="mb-4 mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      {children}
    </section>
  )
}

function Stat({ label, value, tone }: { label: string; value: number | null; tone?: 'warning' }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {value === null ? <Skeleton className="mt-2 h-8 w-16" /> : <div className={cn('tnum mt-1 text-2xl font-semibold', tone === 'warning' && value > 0 && 'text-warning')}>{value.toLocaleString()}</div>}
    </Card>
  )
}

/* =============================== Visits not linked =============================== */
export function UnlinkedSection({ month }: { month: string }) {
  const [reason, setReason] = useState<UnlinkedReason | null>(null)
  const [text, setText] = useState('')
  const [textInput, setTextInput] = useState('')
  const [counts, setCounts] = useState<Record<UnlinkedReason, number> | null>(null)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ProcessResult | null>(null)

  useEffect(() => {
    setCounts(null)
    fetchUnlinkedCounts(month).then(setCounts).catch(() => setCounts({ 'no Doctor ID': 0, 'ID not found in list tables': 0 }))
  }, [month, version])

  const rematch = async () => {
    setBusy(true)
    try {
      setResult(await rematchMonth(month))
      toast.success('Visits re-matched', { description: `KPIs refreshed for ${month.slice(0, 7)}.` })
      setVersion((v) => v + 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Re-match failed')
    } finally {
      setBusy(false)
    }
  }

  const columns: PagedColumn<UnlinkedRow>[] = [
    { header: 'Date', cell: (r) => <span className="tnum whitespace-nowrap">{r.visit_date}</span> },
    { header: 'Shift', cell: (r) => r.shift },
    { header: 'CODE', cell: (r) => <span className="tnum">{r.owner_code}</span> },
    { header: 'Owner', cell: (r) => r.owner_name ?? '—' },
    { header: 'Territory', cell: (r) => r.territory_raw ?? '—' },
    { header: 'Acc. Type', cell: (r) => r.acc_type_code ?? '—' },
    { header: 'Account', cell: (r) => r.account_raw ?? '—' },
    { header: 'Doctor', cell: (r) => r.doctor_raw ?? '—' },
    { header: 'Account ID', cell: (r) => <span className="tnum">{r.account_ext_id ?? '—'}</span> },
    { header: 'Doctor ID', cell: (r) => <span className="tnum">{r.doctor_ext_id ?? '—'}</span> },
    { header: 'Reason', cell: (r) => <Badge tone={r.reason === 'no Doctor ID' ? 'warning' : 'danger'}>{r.reason}</Badge> },
  ]

  return (
    <Section id="unlinked" title="Visits not linked" description="These visits are counted in Total Visits and Call Rate but not in Coverage / PCF.">
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="No Doctor ID" value={counts?.['no Doctor ID'] ?? null} tone="warning" />
        <Stat label="ID not found in list tables" value={counts?.['ID not found in list tables'] ?? null} tone="warning" />
        <Card className="flex flex-col justify-between p-4">
          <div className="text-xs font-medium text-muted-foreground">Re-match this month</div>
          <Button className="mt-2" disabled={busy} onClick={() => void rematch()}>
            <RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} aria-hidden /> {busy ? 'Matching…' : `Re-match ${month.slice(0, 7)}`}
          </Button>
        </Card>
      </div>
      {result && (
        <Card className="mb-4 p-4 text-sm" role="status">
          <b>Re-match result:</b>{' '}
          <span className="tnum">{result.rows.toLocaleString()} rows · {result.unique_visits.toLocaleString()} unique visits · matched {result.matched.toLocaleString()} · not linked {(result.unlinked ?? result.not_in_list).toLocaleString()} · no territory {result.no_territory.toLocaleString()}</span>
        </Card>
      )}
      <PagedTable
        key={`${month}-${reason}-${text}`}
        refreshKey={version}
        columns={columns}
        csvName={`visits-not-linked-${month.slice(0, 7)}`}
        emptyTitle="No unlinked visits"
        emptyDescription="Every visit of this month is linked to a doctor in the list."
        load={(p, s) => fetchUnlinkedPage(month, reason, text, p, s)}
        exportAll={async () => (await fetchUnlinkedAll(month, reason, text)).map((r) => ({ date: r.visit_date, shift: r.shift, code: r.owner_code, owner: r.owner_name ?? '', territory: r.territory_raw ?? '', acc_type: r.acc_type_code ?? '', account: r.account_raw ?? '', doctor: r.doctor_raw ?? '', account_id: r.account_ext_id ?? '', doctor_id: r.doctor_ext_id ?? '', reason: r.reason }))}
        toolbar={
          <>
            <Combobox label="Reason" placeholder="All reasons" className="h-8" options={UNLINKED_REASONS.map((r) => ({ value: r, label: r }))} value={reason} onChange={(v) => setReason(v as UnlinkedReason | null)} />
            <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); setText(textInput) }}>
              <Input aria-label="Search visits" placeholder="Search code, owner, doctor, ID…" value={textInput} onChange={(e) => setTextInput(e.target.value)} className="h-8 w-56" />
              <Button size="sm" type="submit">Search</Button>
            </form>
          </>
        }
      />
    </Section>
  )
}

/* ============================ Visits on non-working slots ============================ */
export function NonWorkSection({ month }: { month: string }) {
  const columns: PagedColumn<NonWorkRow>[] = [
    { header: 'Day', cell: (r) => <span className="tnum whitespace-nowrap">{r.day}</span> },
    { header: 'Shift', cell: (r) => r.shift },
    { header: 'CODE', cell: (r) => <span className="tnum">{r.code}</span> },
    { header: 'Rep', cell: (r) => r.name },
    { header: 'Visits', cell: (r) => <span className="tnum">{r.visits}</span> },
    { header: 'Slot marked as', cell: (r) => <Badge tone="info">{r.status.replace('_', ' ')}</Badge> },
  ]
  return (
    <Section id="nonwork" title="Visits on non-working slots" description="Visits recorded on a day/shift that is marked leave, office work or activity.">
      <PagedTable
        key={month}
        columns={columns}
        csvName={`visits-on-nonwork-${month.slice(0, 7)}`}
        emptyTitle="No conflicts"
        emptyDescription="No visits were recorded on leave, office-work or activity slots."
        load={(p, s) => fetchNonWorkPage(month, p, s)}
        exportAll={async () => (await fetchNonWorkAll(month)).map((r) => ({ day: r.day, shift: r.shift, code: r.code, rep: r.name, visits: r.visits, status: r.status }))}
      />
    </Section>
  )
}

/* ============================== Double-visit pairing ============================== */
export function PairingSection({ month }: { month: string }) {
  const [keys, setKeys] = useState<string[]>([])
  const [scoped, setScoped] = useState(true)
  const columns: PagedColumn<GenericRow>[] = (keys.length ? keys : ['…']).map((k) => ({
    header: k.replace(/_/g, ' '),
    cell: (r) => <span className={typeof r[k] === 'number' ? 'tnum' : undefined}>{r[k] === null || r[k] === undefined ? '—' : String(r[k])}</span>,
  }))
  return (
    <Section id="double" title="Double-visit pairing problems" description="A Double visit must appear as exactly one rep row plus one manager row. Keys that do not pair 1 + 1 are listed here.">
      {!scoped && <p className="mb-2 text-xs text-muted-foreground">This check is not month-scoped; all problems are shown.</p>}
      <PagedTable
        key={month}
        columns={columns}
        csvName={`double-pairing-${month.slice(0, 7)}`}
        emptyTitle="All Double visits pair correctly"
        load={async (p, s) => {
          const r = await fetchPairingPage(month, p, s)
          setKeys(r.keys)
          setScoped(r.scoped)
          return { rows: r.rows, total: r.total }
        }}
        exportAll={async () => (await fetchPairingAll(month)) as Record<string, unknown>[]}
      />
    </Section>
  )
}

/* ================================= No territory ================================= */
export function NoTerritorySection({ month }: { month: string }) {
  const [rows, setRows] = useState<NoTerritoryGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [alias, setAlias] = useState<string | null>(null)
  const load = useCallback(async () => {
    setError(null)
    setRows(null)
    try {
      setRows(await fetchNoTerritory(month))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    }
  }, [month])
  useEffect(() => {
    void load()
  }, [load])

  const columns = useMemo<ColumnDef<NoTerritoryGroup, unknown>[]>(
    () => [
      { accessorKey: 'territory', header: 'Territory (as in the file)', enableHiding: false },
      { accessorKey: 'visits', header: 'Visits' },
      { accessorKey: 'codes', header: 'CODEs' },
      {
        id: 'alias', header: '', enableSorting: false, enableHiding: false,
        cell: (c) => <Button size="sm" onClick={() => setAlias(c.row.original.territory === '(blank)' ? '' : c.row.original.territory)}>Create alias</Button>,
      },
    ],
    [],
  )
  return (
    <Section id="noterritory" title="Visits with unresolved territory" description="The territory text in these visits does not match any territory or alias. Create an alias, then Re-match the month.">
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : (
        <DataTable data={rows ?? []} columns={columns} numericColumns={['visits']} loading={!rows} csvName={`visits-no-territory-${month.slice(0, 7)}`} pageSize={10} emptyTitle="All territories resolved" emptyDescription="Every visit of this month has a territory." />
      )}
      {alias !== null && <AliasDialog initialText={alias} onClose={() => setAlias(null)} />}
    </Section>
  )
}

function AliasDialog({ initialText, onClose }: { initialText: string; onClose: () => void }) {
  const { org, error } = useOrg()
  if (error) return null
  if (!org) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent title="Loading organisation…"><div className="p-6"><Skeleton className="h-24" /></div></DialogContent>
      </Dialog>
    )
  }
  return <AddAlias org={org} initialText={initialText} onClose={onClose} onDone={() => toast.info('Alias saved — re-match the month to apply it.')} />
}
