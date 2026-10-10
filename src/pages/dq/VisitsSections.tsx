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
import { fetchAll } from '../../lib/api/core'
import {
  fetchMissing, fetchNoTerritory, fetchNonWorkAll, fetchNonWorkPage, fetchOrgForMonth, fetchPairingAll,
  fetchPairingPage, fetchUnmatchedAll, fetchUnmatchedCounts, fetchUnmatchedPage, rematchMonth,
  type GenericRow, type MatchStatus, type MissingRow, type NoTerritoryGroup, type NonWorkRow, type OrgRepInfo, type UnmatchedRow,
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

/* =============================== Unmatched doctors =============================== */
export function UnmatchedSection({ month }: { month: string }) {
  const [status, setStatus] = useState<MatchStatus | null>(null)
  const [code, setCode] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [counts, setCounts] = useState<Record<MatchStatus, number> | null>(null)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ProcessResult | null>(null)

  useEffect(() => {
    setCounts(null)
    fetchUnmatchedCounts(month).then(setCounts).catch(() => setCounts({ unmatched: 0, not_in_list: 0 }))
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

  const columns: PagedColumn<UnmatchedRow>[] = [
    { header: 'Date', cell: (r) => <span className="tnum whitespace-nowrap">{r.visit_date}</span> },
    { header: 'Shift', cell: (r) => r.shift },
    { header: 'CODE', cell: (r) => <span className="tnum">{r.owner_code}</span> },
    { header: 'Owner', cell: (r) => r.owner },
    { header: 'Doctor', cell: (r) => r.doctor_raw ?? '—' },
    { header: 'Account', cell: (r) => r.account_raw ?? '—' },
    { header: 'Status', cell: (r) => <Badge tone={r.match_status === 'unmatched' ? 'danger' : 'warning'}>{r.match_status === 'unmatched' ? 'Unmatched' : 'Not in list'}</Badge> },
  ]

  return (
    <Section id="unmatched" title="Unmatched doctors" description="not_in_list = a known doctor outside the rep's list (counts in the rep's total visits, valid = 0). unmatched = the doctor/account was not found in any list.">
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Unmatched" value={counts?.unmatched ?? null} tone="warning" />
        <Stat label="Not in list" value={counts?.not_in_list ?? null} tone="warning" />
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
          <span className="tnum">{result.rows.toLocaleString()} rows · {result.unique_visits.toLocaleString()} unique visits · matched {result.matched.toLocaleString()} · not in list {result.not_in_list.toLocaleString()} · unmatched {result.unmatched.toLocaleString()} · no territory {result.no_territory.toLocaleString()}</span>
        </Card>
      )}
      <PagedTable
        key={`${month}-${status}-${code}`}
        refreshKey={version}
        columns={columns}
        csvName={`unmatched-visits-${month.slice(0, 7)}`}
        emptyTitle="No unmatched visits"
        emptyDescription="Every visit of this month matched a doctor in the list."
        load={(p, s) => fetchUnmatchedPage(month, status, code, p, s)}
        exportAll={async () => (await fetchUnmatchedAll(month, status, code)).map((r) => ({ date: r.visit_date, shift: r.shift, code: r.owner_code, owner: r.owner, doctor: r.doctor_raw ?? '', account: r.account_raw ?? '', status: r.match_status }))}
        toolbar={
          <>
            <Combobox label="Status" placeholder="Both statuses" className="h-8" options={[{ value: 'unmatched', label: 'Unmatched' }, { value: 'not_in_list', label: 'Not in list' }]} value={status} onChange={(v) => setStatus(v as MatchStatus | null)} />
            <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); setCode(codeInput) }}>
              <Input aria-label="Filter by CODE" placeholder="CODE…" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} className="h-8 w-32" />
              <Button size="sm" type="submit">Filter</Button>
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

/* ================================== Missing days ================================== */
interface MissingSummary { rep_id: number; code: string; name: string; line: string; manager: string; am: number; pm: number; total: number }

export function MissingDaysSection({ month }: { month: string }) {
  const [rows, setRows] = useState<MissingRow[] | null>(null)
  const [orgInfo, setOrgInfo] = useState<Map<number, OrgRepInfo> | null>(null)
  const [lines, setLines] = useState<Map<number, string>>(new Map())
  const [managers, setManagers] = useState<Map<number, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [line, setLine] = useState<string | null>(null)
  const [mgr, setMgr] = useState<string | null>(null)
  const [detail, setDetail] = useState<number | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setRows(null)
    try {
      const [m, o, l, mg] = await Promise.all([
        fetchMissing(month),
        fetchOrgForMonth(month),
        fetchAll<{ id: number; name: string }>('lines', 'id,name', ['id']),
        fetchAll<{ id: number; name: string }>('managers', 'id,name', ['id']),
      ])
      setRows(m)
      setOrgInfo(o)
      setLines(new Map(l.map((x) => [x.id, x.name])))
      setManagers(new Map(mg.map((x) => [x.id, x.name])))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    }
  }, [month])
  useEffect(() => {
    void load()
  }, [load])

  const summary = useMemo<MissingSummary[]>(() => {
    const map = new Map<number, MissingSummary>()
    for (const r of rows ?? []) {
      const info = orgInfo?.get(r.rep_id)
      const s = map.get(r.rep_id) ?? {
        rep_id: r.rep_id, code: r.code, name: r.name,
        line: info?.line_id ? lines.get(info.line_id) ?? '—' : '—',
        manager: info?.manager_id ? managers.get(info.manager_id) ?? '—' : 'Vacant',
        am: 0, pm: 0, total: 0,
      }
      if (r.shift === 'AM') s.am++
      else s.pm++
      s.total++
      map.set(r.rep_id, s)
    }
    return [...map.values()]
      .filter((s) => (line ? orgInfo?.get(s.rep_id)?.line_id === Number(line) : true))
      .filter((s) => (mgr ? (mgr === 'vacant' ? !orgInfo?.get(s.rep_id)?.manager_id : orgInfo?.get(s.rep_id)?.manager_id === Number(mgr)) : true))
      .sort((a, b) => b.total - a.total)
  }, [rows, orgInfo, lines, managers, line, mgr])

  const columns = useMemo<ColumnDef<MissingSummary, unknown>[]>(
    () => [
      { accessorKey: 'name', header: 'Rep', enableHiding: false },
      { accessorKey: 'code', header: 'Code' },
      { accessorKey: 'line', header: 'Line' },
      { accessorKey: 'manager', header: 'Manager' },
      { accessorKey: 'am', header: 'Missing AM' },
      { accessorKey: 'pm', header: 'Missing PM' },
      { accessorKey: 'total', header: 'Total' },
    ],
    [],
  )
  const days = detail === null ? [] : (rows ?? []).filter((r) => r.rep_id === detail)
  const detailRep = summary.find((s) => s.rep_id === detail)

  return (
    <Section id="missing" title="Missing days" description="Working slots with no visits, leave, office work or activity. Click a rep to see the days.">
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : (
        <DataTable
          data={summary}
          columns={columns}
          numericColumns={['am', 'pm', 'total']}
          loading={!rows}
          csvName={`missing-days-${month.slice(0, 7)}`}
          pageSize={15}
          onRowClick={(r) => setDetail(r.rep_id)}
          emptyTitle="No missing days"
          emptyDescription="Every working slot of this month is accounted for."
          toolbar={
            <>
              <Combobox label="Line" placeholder="All lines" className="h-8" options={[...lines].map(([id, n]) => ({ value: String(id), label: n }))} value={line} onChange={setLine} />
              <Combobox label="Manager" placeholder="All managers" className="h-8" options={[{ value: 'vacant', label: 'Vacant manager' }, ...[...managers].map(([id, n]) => ({ value: String(id), label: n }))]} value={mgr} onChange={setMgr} />
            </>
          }
        />
      )}
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent title={detailRep?.name ?? 'Missing days'} side="right">
          <div className="h-full space-y-3 overflow-y-auto p-6">
            <h3 className="text-lg font-semibold">{detailRep?.name}</h3>
            <p className="text-sm text-muted-foreground">{days.length} missing slot(s) in {month.slice(0, 7)}</p>
            <ul className="divide-y text-sm">
              {days.map((d) => (
                <li key={`${d.day}-${d.shift}`} className="flex justify-between py-2"><span className="tnum">{d.day}</span><Badge tone="danger">{d.shift}</Badge></li>
              ))}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </Section>
  )
}
