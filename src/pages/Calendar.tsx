import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { CalendarPlus, Loader2, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader, ErrorState } from '../components/app/states'
import { DataTable } from '../components/app/DataTable'
import { ChartCard } from '../components/app/ChartCard'
import { KpiCard, StatGrid } from '../components/app/KpiCard'
import { DateField, Field, FormDialog } from '../components/app/FormDialog'
import { Button } from '../components/ui/button'
import { Input, Skeleton } from '../components/ui/misc'
import { useMonth } from '../context/MonthContext'
import { fetchAll, refreshMonths, rpc } from '../lib/api/core'
import { addDaysIso, addMonthsIso, daysInMonth } from '../lib/norm'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'

interface Holiday { day: string; name: string }
type Kind = 'working' | 'weekly' | 'holiday'

// Weekday of an ISO date, 0 = Saturday … 6 = Friday (Egypt week). Only used for laying out the grid.
function weekdaySat(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return (js + 1) % 7
}

const KIND_STYLE: Record<Kind, string> = {
  working: 'bg-success-soft text-success',
  weekly: 'bg-muted text-muted-foreground',
  holiday: 'bg-warning-soft text-warning',
}
const KIND_LABEL: Record<Kind, string> = { working: 'Working', weekly: 'Weekly off', holiday: 'Public holiday' }
const DOW = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']

export default function Calendar() {
  const { month } = useMonth()
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [am, setAm] = useState<Set<string> | null>(null)
  const [pm, setPm] = useState<Set<string> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dlg, setDlg] = useState<{ k: 'add' } | { k: 'range' } | { k: 'edit'; h: Holiday } | { k: 'delete'; h: Holiday } | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const from = month
      const to = addDaysIso(addMonthsIso(month, 1), -1)
      // The database is the source of truth for working days (weekly rules + holidays).
      const [h, a, p] = await Promise.all([
        fetchAll<Holiday>('holidays', 'day,name', ['day']),
        rpc<{ day: string }[]>('working_days', { p_shift: 'AM', p_from: from, p_to: to }),
        rpc<{ day: string }[]>('working_days', { p_shift: 'PM', p_from: from, p_to: to }),
      ])
      setHolidays(h)
      setAm(new Set(a.map((x) => x.day)))
      setPm(new Set(p.map((x) => x.day)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load calendar')
    }
  }, [month])
  useEffect(() => {
    setAm(null)
    setPm(null)
    void load()
  }, [load])

  const holidaySet = useMemo(() => new Set(holidays.map((h) => h.day)), [holidays])
  const kindOf = useCallback(
    (set: Set<string>, day: string): Kind => (set.has(day) ? 'working' : holidaySet.has(day) ? 'holiday' : 'weekly'),
    [holidaySet],
  )
  const monthHolidays = holidays.filter((h) => h.day.slice(0, 7) === month.slice(0, 7))

  /** Refresh every affected month after a holiday change. */
  const afterChange = async (days: string[]) => {
    const months = [...new Set(days.map((d) => `${d.slice(0, 7)}-01`))]
    try {
      await refreshMonths(months, (d, t) => setProgress(`Refreshing KPIs ${d}/${t}…`))
      toast.success('Holidays updated', { description: `KPIs refreshed for ${months.length} month(s).` })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setProgress(null)
      void load()
    }
  }

  const cols = useMemo<ColumnDef<Holiday, unknown>[]>(
    () => [
      { accessorKey: 'day', header: 'Date', enableHiding: false },
      { accessorKey: 'name', header: 'Name' },
      {
        id: 'actions', header: '', enableSorting: false, enableHiding: false,
        cell: (c) => (
          <span className="flex gap-1">
            <Button size="icon-sm" variant="ghost" aria-label={`Edit ${c.row.original.name}`} onClick={() => setDlg({ k: 'edit', h: c.row.original })}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Delete ${c.row.original.name}`} onClick={() => setDlg({ k: 'delete', h: c.row.original })}><Trash2 className="h-4 w-4" /></Button>
          </span>
        ),
      },
    ],
    [],
  )

  const n = daysInMonth(month)
  const lead = weekdaySat(month)
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: n }, (_, i) => addDaysIso(month, i))]
  while (cells.length % 7) cells.push(null)
  const close = () => setDlg(null)

  return (
    <div>
      <PageHeader title="Calendar" description="Working days per shift for the selected month, and the public-holiday list." />
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <>
          <StatGrid>
            <KpiCard label="AM working days" loading={!am} value={am ? String(am.size) : undefined} />
            <KpiCard label="PM working days" loading={!pm} value={pm ? String(pm.size) : undefined} />
            <KpiCard label="Holidays this month" loading={!am} value={String(monthHolidays.length)} />
          </StatGrid>

          <ChartCard
            className="mt-6"
            title={`Month grid — ${month.slice(0, 7)}`}
            description="Each day shows its AM and PM status. Friday is off; PM is also off on Thursday."
            legend={[
              { label: 'Working', color: 'hsl(var(--success-soft))' },
              { label: 'Weekly off', color: 'hsl(var(--muted))' },
              { label: 'Public holiday', color: 'hsl(var(--warning-soft))' },
            ]}
          >
            {!am || !pm ? (
              <Skeleton className="h-72" />
            ) : (
              <div className="grid grid-cols-7 gap-1.5" role="grid" aria-label="Month calendar">
                {DOW.map((d) => <div key={d} role="columnheader" className="pb-1 text-center text-xs font-medium text-muted-foreground">{d}</div>)}
                {cells.map((day, i) =>
                  day === null ? (
                    <div key={`b${i}`} />
                  ) : (
                    <div key={day} role="gridcell" className="rounded-control border p-1.5">
                      <div className="tnum mb-1 text-xs font-semibold">{Number(day.slice(8))}</div>
                      {(['AM', 'PM'] as const).map((s) => {
                        const k = kindOf(s === 'AM' ? am : pm, day)
                        return (
                          <div key={s} title={`${s}: ${KIND_LABEL[k]}`} className={cn('mb-0.5 flex items-center justify-between rounded px-1.5 py-0.5 text-[10px] font-medium last:mb-0', KIND_STYLE[k])}>
                            <span>{s}</span>
                            <span className="hidden sm:inline">{k === 'working' ? '✓' : k === 'holiday' ? 'Hol' : 'Off'}</span>
                          </div>
                        )
                      })}
                    </div>
                  ),
                )}
              </div>
            )}
          </ChartCard>

          <h2 className="mb-3 mt-8 text-base font-semibold">Public holidays</h2>
          {progress && (
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {progress}
            </div>
          )}
          <DataTable
            data={holidays}
            columns={cols}
            csvName="holidays"
            pageSize={10}
            loading={!am}
            emptyTitle="No holidays defined"
            emptyDescription="Add a public holiday or a range such as a 3-day Eid."
            toolbar={
              <>
                <Button size="sm" onClick={() => setDlg({ k: 'range' })}><CalendarPlus className="h-4 w-4" /> Add range</Button>
                <Button size="sm" variant="primary" onClick={() => setDlg({ k: 'add' })}><CalendarPlus className="h-4 w-4" /> Add holiday</Button>
              </>
            }
          />
        </>
      )}

      {dlg?.k === 'add' && <HolidayForm onClose={close} onSaved={afterChange} />}
      {dlg?.k === 'range' && <HolidayForm range onClose={close} onSaved={afterChange} />}
      {dlg?.k === 'edit' && <HolidayForm holiday={dlg.h} onClose={close} onSaved={afterChange} />}
      {dlg?.k === 'delete' && (
        <FormDialog
          open
          onOpenChange={close}
          onDone={() => undefined}
          title={`Delete ${dlg.h.name}?`}
          description={`${dlg.h.day} will become a normal working day again.`}
          submitLabel="Delete"
          variant="danger"
          onSubmit={async () => {
            const { error: err } = await supabase.from('holidays').delete().eq('day', dlg.h.day)
            if (err) throw new Error(err.message)
            void afterChange([dlg.h.day])
            return { message: 'Holiday deleted' }
          }}
        >
          <p className="text-sm text-muted-foreground">KPIs for that month will be recalculated.</p>
        </FormDialog>
      )}
    </div>
  )
}

function HolidayForm({ holiday, range, onClose, onSaved }: { holiday?: Holiday; range?: boolean; onClose: () => void; onSaved: (days: string[]) => Promise<void> }) {
  const [from, setFrom] = useState(holiday?.day ?? '')
  const [to, setTo] = useState('')
  const [name, setName] = useState(holiday?.name ?? '')
  const days = range && from && to && to >= from ? Array.from({ length: Math.min(60, (new Date(to).getTime() - new Date(from).getTime()) / 86400000 + 1) }, (_, i) => addDaysIso(from, i)) : from ? [from] : []
  return (
    <FormDialog
      open
      onOpenChange={onClose}
      onDone={() => undefined}
      title={holiday ? 'Edit holiday' : range ? 'Add holiday range' : 'Add holiday'}
      description={range ? 'Each day is stored as its own row with the same name.' : undefined}
      submitLabel={holiday ? 'Save' : 'Add'}
      disabled={!from || !name.trim() || (range === true && (!to || to < from))}
      onSubmit={async () => {
        if (holiday) {
          const { error } = await supabase.from('holidays').update({ day: from, name: name.trim() }).eq('day', holiday.day)
          if (error) throw new Error(error.message.includes('duplicate') ? 'A holiday already exists on that date.' : error.message)
          void onSaved([holiday.day, from])
        } else {
          const { error } = await supabase.from('holidays').insert(days.map((d) => ({ day: d, name: name.trim() })))
          if (error) throw new Error(error.message.includes('duplicate') ? 'One of these dates is already a holiday.' : error.message)
          void onSaved(days)
        }
        return { message: holiday ? 'Holiday updated' : `${days.length} holiday day(s) added` }
      }}
    >
      <DateField id="hd-from" label={range ? 'From' : 'Date'} value={from} onChange={setFrom} />
      {range && <DateField id="hd-to" label="To (inclusive)" value={to} onChange={setTo} hint={days.length > 1 ? `${days.length} days` : undefined} />}
      <Field label="Name" htmlFor="hd-name"><Input id="hd-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Eid al-Fitr" /></Field>
    </FormDialog>
  )
}
