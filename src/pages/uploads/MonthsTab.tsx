import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowRight, CalendarSearch } from 'lucide-react'
import { DataTable } from '../../components/app/DataTable'
import { EmptyState, ErrorState } from '../../components/app/states'
import { Combobox } from '../../components/ui/combobox'
import { Badge, Card, Skeleton } from '../../components/ui/misc'
import {
  CHANGE_LABEL, CHANGE_TYPES, fetchChangeCounts, fetchChangeDetails, fetchListMonths,
  type ChangeRow, type ChangeType, type ListMonth,
} from '../../lib/api/lists'
import { cn } from '../../lib/utils'

const TONE: Record<ChangeType, 'success' | 'danger' | 'info' | 'warning'> = {
  added: 'success', removed: 'danger', transferred: 'info', freq_changed: 'warning',
}

export default function MonthsTab({ selected, onSelect }: { selected: string | null; onSelect: (m: string | null) => void }) {
  const [months, setMonths] = useState<ListMonth[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setMonths(await fetchListMonths())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load months')
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !months ? (
        <div className="grid gap-3 sm:grid-cols-3" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : months.length === 0 ? (
        <Card><EmptyState icon={CalendarSearch} title="No list months loaded" description="Upload a Target List to see months here." /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...months].reverse().map((m) => (
            <button
              key={m.month}
              onClick={() => onSelect(m.month)}
              aria-pressed={selected === m.month}
              className={cn('rounded-card border bg-card p-4 text-left transition-colors hover:bg-muted', selected === m.month && 'border-primary ring-1 ring-primary')}
            >
              <div className="tnum text-base font-semibold">{m.month.slice(0, 7)}</div>
              <dl className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                <div className="flex justify-between"><dt>Rows</dt><dd className="tnum text-foreground">{m.rows.toLocaleString()}</dd></div>
                <div className="flex justify-between"><dt>Reps</dt><dd className="tnum text-foreground">{m.reps.toLocaleString()}</dd></div>
                <div className="flex justify-between"><dt>Doctors</dt><dd className="tnum text-foreground">{m.doctors.toLocaleString()}</dd></div>
                <div className="flex justify-between"><dt>Target visits</dt><dd className="tnum text-foreground">{m.total_freq.toLocaleString()}</dd></div>
              </dl>
            </button>
          ))}
        </div>
      )}
      {selected && <ListChanges month={selected} />}
    </div>
  )
}

function ListChanges({ month }: { month: string }) {
  const [counts, setCounts] = useState<Record<ChangeType, number> | null>(null)
  const [rows, setRows] = useState<ChangeRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState<string | null>(null)
  const [rep, setRep] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setCounts(null)
    setRows(null)
    try {
      const [c, d] = await Promise.all([fetchChangeCounts(month), fetchChangeDetails(month)])
      setCounts(c)
      setRows(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load list changes')
    }
  }, [month])
  useEffect(() => {
    void load()
  }, [load])

  const repOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows ?? []) {
      if (r.fromRep !== '—') set.add(r.fromRep)
      if (r.toRep !== '—') set.add(r.toRep)
    }
    return [...set].sort().map((x) => ({ value: x, label: x }))
  }, [rows])

  const filtered = useMemo(
    () => (rows ?? []).filter((r) => (type ? r.change_type === type : true)).filter((r) => (rep ? r.fromRep === rep || r.toRep === rep : true)),
    [rows, type, rep],
  )
  const columns = useMemo<ColumnDef<ChangeRow, unknown>[]>(
    () => [
      { accessorKey: 'doctor', header: 'Doctor', enableHiding: false },
      { accessorKey: 'account', header: 'Account' },
      { accessorKey: 'change_type', header: 'Change', cell: (c) => <Badge tone={TONE[c.row.original.change_type]}>{CHANGE_LABEL[c.row.original.change_type]}</Badge> },
      {
        id: 'rep', header: 'Rep', accessorFn: (r) => `${r.fromRep} → ${r.toRep}`,
        cell: (c) => {
          const r = c.row.original
          return r.change_type === 'transferred' ? <span className="inline-flex items-center gap-1.5">{r.fromRep}<ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />{r.toRep}</span> : r.toRep !== '—' ? r.toRep : r.fromRep
        },
      },
      {
        id: 'freq', header: 'Freq', accessorFn: (r) => `${r.old_freq ?? '—'} → ${r.new_freq ?? '—'}`,
        cell: (c) => {
          const r = c.row.original
          return <span className="tnum">{r.old_freq ?? '—'} → {r.new_freq ?? '—'}</span>
        },
      },
    ],
    [],
  )

  if (error) return <Card><ErrorState message={error} onRetry={() => void load()} /></Card>
  const empty = counts && CHANGE_TYPES.every((t) => counts[t] === 0)
  return (
    <section aria-label={`List changes for ${month.slice(0, 7)}`}>
      <h2 className="mb-3 text-base font-semibold">List changes — <span className="tnum">{month.slice(0, 7)}</span> vs previous month</h2>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {CHANGE_TYPES.map((t) => (
          <Card key={t} className="p-4">
            <div className="text-xs font-medium text-muted-foreground">{CHANGE_LABEL[t]}</div>
            {counts ? <div className="tnum mt-1 text-2xl font-semibold">{counts[t].toLocaleString()}</div> : <Skeleton className="mt-2 h-8 w-16" />}
          </Card>
        ))}
      </div>
      {empty ? (
        <Card><EmptyState icon={CalendarSearch} title="First month loaded — nothing to compare" description="Changes appear once an adjacent earlier month exists, or when nothing differs." /></Card>
      ) : (
        <DataTable
          data={filtered}
          columns={columns}
          csvName={`list-changes-${month.slice(0, 7)}`}
          pageSize={20}
          loading={!rows}
          toolbar={
            <>
              <Combobox label="Change type" placeholder="All changes" className="h-8" options={CHANGE_TYPES.map((t) => ({ value: t, label: CHANGE_LABEL[t] }))} value={type} onChange={setType} />
              <Combobox label="Rep" placeholder="All reps" className="h-8" options={repOptions} value={rep} onChange={setRep} />
            </>
          }
        />
      )}
    </section>
  )
}
