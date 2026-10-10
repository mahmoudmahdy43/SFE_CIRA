import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowRightLeft, LogOut, Plus } from 'lucide-react'
import { DataTable } from '../../components/app/DataTable'
import { Button } from '../../components/ui/button'
import { StatusPill } from '../../components/ui/misc'
import { Dialog, DialogContent } from '../../components/ui/overlay'
import { Timeline, spanText } from '../../components/app/Timeline'
import { HireDialog, ResignRepDialog, TransferDialog } from '../../components/app/PersonnelActions'
import type { OrgView, Rep } from '../../lib/api/org'

interface Row {
  rep: Rep
  code: string
  name: string
  line: string
  box: string
  status: 'Active' | 'Resigned'
  hire: string
  resign: string
}

type Dlg = { k: 'hire' } | { k: 'resign'; rep: Rep } | { k: 'transfer'; rep: Rep } | null

export default function RepsTab({ org, reload }: { org: OrgView; reload: () => void }) {
  const [dlg, setDlg] = useState<Dlg>(null)
  const [detail, setDetail] = useState<Rep | null>(null)

  const rows = useMemo<Row[]>(
    () =>
      org.reps.map((r) => {
        const box = org.currentBoxOfRep.get(r.id)
        return {
          rep: r,
          code: r.code,
          name: r.name,
          line: box ? org.lineById.get(box.line_id)?.name ?? '' : '—',
          box: box?.name ?? '—',
          status: r.status,
          hire: r.hire_date ?? '—',
          resign: r.resign_date ?? '—',
        }
      }),
    [org],
  )
  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      { accessorKey: 'code', header: 'Code', enableHiding: false },
      { accessorKey: 'name', header: 'Name' },
      { accessorKey: 'line', header: 'Line' },
      { accessorKey: 'box', header: 'Box' },
      { accessorKey: 'status', header: 'Status', cell: (c) => <StatusPill status={c.row.original.status} /> },
      { accessorKey: 'hire', header: 'Hire date' },
      { accessorKey: 'resign', header: 'Resign date' },
      {
        id: 'actions', header: '', enableSorting: false, enableHiding: false,
        cell: (c) => {
          const r = c.row.original
          if (r.status !== 'Active' || r.box === '—') return null
          return (
            <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="icon-sm" variant="ghost" aria-label={`Transfer ${r.name}`} onClick={() => setDlg({ k: 'transfer', rep: r.rep })}><ArrowRightLeft className="h-4 w-4" /></Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Resign ${r.name}`} onClick={() => setDlg({ k: 'resign', rep: r.rep })}><LogOut className="h-4 w-4" /></Button>
            </span>
          )
        },
      },
    ],
    [],
  )
  const close = () => setDlg(null)
  const history = detail ? org.repBox.filter((x) => x.rep_id === detail.id).sort((a, b) => b.valid_from.localeCompare(a.valid_from)) : []

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        csvName="reps"
        pageSize={15}
        onRowClick={(r) => setDetail(r.rep)}
        emptyTitle="No reps yet"
        emptyDescription="Import the workbook from Org & Territories, or hire a rep."
        toolbar={<Button size="sm" variant="primary" onClick={() => setDlg({ k: 'hire' })}><Plus className="h-4 w-4" /> Hire rep</Button>}
      />
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent title={detail?.name ?? 'Rep'} side="right">
          {detail && (
            <div className="space-y-5 p-6">
              <div>
                <h2 className="text-lg font-semibold">{detail.name}</h2>
                <p className="tnum text-sm text-muted-foreground">{detail.code}</p>
              </div>
              <section>
                <h3 className="mb-3 text-sm font-semibold">Assignment history</h3>
                <Timeline empty="No box assignments." items={history.map((h) => ({ id: h.id, title: org.boxLabel(h.box_id), range: spanText(h.valid_from, h.valid_to), muted: h.valid_to !== null }))} />
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {dlg?.k === 'hire' && <HireDialog org={org} open onOpenChange={close} onDone={reload} />}
      {dlg?.k === 'resign' && <ResignRepDialog rep={dlg.rep} open onOpenChange={close} onDone={reload} />}
      {dlg?.k === 'transfer' && <TransferDialog org={org} rep={dlg.rep} open onOpenChange={close} onDone={reload} />}
    </>
  )
}
