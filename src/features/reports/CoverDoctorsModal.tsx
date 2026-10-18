import { lastDayOf, rangeFileSlug } from '../../lib/dateRange'
import { useMemo, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Skeleton } from '../../components/ui/misc'
import { Dialog, DialogContent } from '../../components/ui/overlay'
import { ErrorState } from '../../components/app/states'
import { downloadXlsx } from '../../lib/xlsxExport'
import { fetchManagerCoverageDoctors } from '../../lib/api/reports'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import { CPAL, orderDoctors, shiftText, type CoverRow, type CoverShift } from './coverageMath'

interface Props {
  /** The manager x rep pair to drill into; null = closed. */
  target: CoverRow | null
  from: string
  to: string
  periodText: string
  shift: CoverShift
  onClose: () => void
}

function Body({ target, from, to, periodText, shift }: { target: CoverRow; from: string; to: string; periodText: string; shift: CoverShift }) {
  const data = useAsync(`report:cover:docs:${from}:${to}:${shift}:${target.manager_id ?? ''}:${target.rep_id}`, () =>
    fetchManagerCoverageDoctors(from, to, target.rep_id, target.manager_id, shift),
  )
  const [view, setView] = useState<'missed' | 'all'>('missed')
  const all = useMemo(() => orderDoctors(data.data ?? []), [data.data])
  const missed = useMemo(() => all.filter((d) => !d.covered), [all])
  const shown = view === 'missed' ? missed : all

  const exportXlsx = () =>
    void downloadXlsx(
      `manager-coverage-doctors-${(target.rep_name ?? 'rep').replace(/[^\w]+/g, '-')}-${rangeFileSlug(from, lastDayOf(to))}-${shift.toLowerCase()}.xlsx`,
      'Doctors',
      shown.map((d) => ({
        Manager: target.manager ?? '', Rep: target.rep_name ?? '', Period: periodText, Shift: shiftText(shift),
        Doctor: d.doctor_name, Account: d.account_name ?? '', Speciality: d.speciality ?? '', Class: d.class ?? '', Frequency: d.freq,
        'Joint visits': d.joint_visits, Covered: d.covered ? 'Yes' : 'No',
      })),
    )

  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Doctors shown" className="inline-flex rounded-control border bg-card p-0.5">
          {([['missed', `Not visited (${missed.length})`], ['all', `Whole list (${all.length})`]] as const).map(([id, label]) => (
            <button
              key={id} aria-pressed={view === id} onClick={() => setView(id)}
              className={cn('rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors', view === id && 'bg-accent font-medium text-accent-foreground')}
            >
              {label}
            </button>
          ))}
        </div>
        <Button size="sm" className="ml-auto" onClick={exportXlsx} disabled={shown.length === 0}><FileSpreadsheet className="h-4 w-4" /> Export Excel</Button>
      </div>
      <div className="max-h-[55vh] overflow-auto rounded-md border">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {['Doctor', 'Account', 'Speciality', 'Class', 'Freq', 'Joint visits', 'Covered'].map((h, i) => (
                <th key={h} className={cn('sticky top-0 z-10 h-8 whitespace-nowrap px-3 text-xs font-bold text-white', i >= 3 ? 'text-center' : 'text-left')} style={{ backgroundColor: CPAL.navy }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.loading
              ? Array.from({ length: 8 }, (_, r) => <tr key={r}>{Array.from({ length: 7 }, (_, c) => <td key={c} className="h-9 border-b px-3"><Skeleton className="h-4" /></td>)}</tr>)
              : shown.map((d, i) => (
                  <tr key={d.doctor_id} style={i % 2 === 1 ? { backgroundColor: CPAL.zebra } : undefined}>
                    <td className="h-9 whitespace-nowrap border-b px-3 font-medium" style={{ color: CPAL.navy }}>{d.doctor_name}</td>
                    <td className="border-b px-3 text-muted-foreground">{d.account_name ?? '-'}</td>
                    <td className="border-b px-3">{d.speciality ?? '-'}</td>
                    <td className="border-b px-3 text-center font-bold">{d.class ?? '-'}</td>
                    <td className="tnum border-b px-3 text-center">{d.freq ?? '-'}</td>
                    <td className="tnum border-b px-3 text-center">{d.joint_visits}</td>
                    <td className="border-b px-3 text-center font-bold" style={{ color: d.covered ? CPAL.green : CPAL.red }}>{d.covered ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
          </tbody>
        </table>
        {!data.loading && shown.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {all.length === 0 ? 'No active-list doctors for this rep in this period.' : 'Every doctor on the list was visited by the manager.'}
          </p>
        )}
      </div>
    </div>
  )
}

export function CoverDoctorsModal({ target, from, to, periodText, shift, onClose }: Props) {
  return (
    <Dialog open={target !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      {target && (
        <DialogContent
          title={`Not visited doctors — ${target.rep_name ?? 'rep'}`}
          description={`Manager: ${target.manager ?? '-'}  ·  ${periodText}  ·  ${shiftText(shift)}  ·  ${target.list_doctors} list doctors, ${target.covered_doctors} covered`}
          className="max-w-4xl"
        >
          <Body target={target} from={from} to={to} periodText={periodText} shift={shift} />
        </DialogContent>
      )}
    </Dialog>
  )
}
