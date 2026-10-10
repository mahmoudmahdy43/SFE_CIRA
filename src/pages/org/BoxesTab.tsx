import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { DataTable } from '../../components/app/DataTable'
import { Combobox } from '../../components/ui/combobox'
import { Button } from '../../components/ui/button'
import { Input, StatusPill } from '../../components/ui/misc'
import { Dialog, DialogContent } from '../../components/ui/overlay'
import { Field, FormDialog } from '../../components/app/FormDialog'
import { Timeline, spanText } from '../../components/app/Timeline'
import {
  AssignManagerDialog, HireDialog, ResignRepDialog, TransferDialog, UnassignManagerDialog,
} from '../../components/app/PersonnelActions'
import { effectiveTarget, isActiveOn, type Box, type OrgView } from '../../lib/api/org'
import { supabase } from '../../lib/supabase'
import { monthStart, todayIso } from '../../lib/norm'

interface Row {
  box: Box
  line: string
  name: string
  territories: number
  rep: string
  manager: string
  nsm: string
  am: number | null
  pm: number | null
}

type Dlg =
  | { t: 'hire'; box: number }
  | { t: 'resign'; box: number }
  | { t: 'transfer'; box: number }
  | { t: 'assign'; box: number }
  | { t: 'unassign'; box: number }
  | { t: 'create' }
  | { t: 'rename'; box: number }
  | null

export default function BoxesTab({ org, reload }: { org: OrgView; reload: () => void }) {
  const [line, setLine] = useState<string | null>(null)
  const [vac, setVac] = useState<string | null>(null)
  const [sheet, setSheet] = useState<number | null>(null)
  const [dlg, setDlg] = useState<Dlg>(null)
  const month = monthStart(todayIso())

  const rows = useMemo<Row[]>(
    () =>
      org.boxes
        .map((b) => ({
          box: b,
          line: org.lineById.get(b.line_id)?.name ?? '',
          name: b.name,
          territories: org.territoryCount.get(b.id) ?? 0,
          rep: org.repOfBox.get(b.id)?.name ?? 'Vacant',
          manager: org.managerOfBox.get(b.id)?.name ?? 'Vacant',
          nsm: org.nsmOfLine.get(b.line_id)?.name ?? 'Vacant',
          am: effectiveTarget(org.targets, b.id, 'AM', month)?.target ?? null,
          pm: effectiveTarget(org.targets, b.id, 'PM', month)?.target ?? null,
        }))
        .filter((r) => (line ? String(r.box.line_id) === line : true))
        .filter((r) => (vac === 'rep' ? r.rep === 'Vacant' : vac === 'mgr' ? r.manager === 'Vacant' : true)),
    [org, line, vac, month],
  )

  const vacantCell = (v: string) => (v === 'Vacant' ? <StatusPill status="Vacant" /> : v)
  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      { accessorKey: 'line', header: 'Line' },
      { accessorKey: 'name', header: 'Box' },
      { accessorKey: 'territories', header: '# Territories' },
      { accessorKey: 'rep', header: 'Current rep', cell: (c) => vacantCell(c.row.original.rep) },
      { accessorKey: 'manager', header: 'Current manager', cell: (c) => vacantCell(c.row.original.manager) },
      { accessorKey: 'nsm', header: 'NSM', cell: (c) => vacantCell(c.row.original.nsm) },
      { accessorKey: 'am', header: 'AM target', cell: (c) => c.row.original.am ?? '—' },
      { accessorKey: 'pm', header: 'PM target', cell: (c) => c.row.original.pm ?? '—' },
    ],
    [],
  )

  const close = () => setDlg(null)
  const sheetBox = sheet ? org.boxById.get(sheet) : undefined
  const openAction = (d: NonNullable<Dlg>) => {
    setSheet(null)
    setDlg(d)
  }

  return (
    <div className="space-y-3">
      <DataTable
        data={rows}
        columns={columns}
        numericColumns={['territories', 'am', 'pm']}
        csvName="boxes"
        pageSize={15}
        onRowClick={(r) => setSheet(r.box.id)}
        emptyTitle="No boxes yet"
        emptyDescription="Use the Import tab to load the workbook, or create a box."
        toolbar={
          <>
            <Combobox label="Line" placeholder="All lines" className="h-8" options={org.lines.map((l) => ({ value: String(l.id), label: l.name }))} value={line} onChange={setLine} />
            <Combobox label="Vacancy" placeholder="All boxes" className="h-8" options={[{ value: 'rep', label: 'Vacant rep' }, { value: 'mgr', label: 'Vacant manager' }]} value={vac} onChange={setVac} />
            <Button size="sm" variant="primary" onClick={() => setDlg({ t: 'create' })}>
              <Plus className="h-4 w-4" /> New box
            </Button>
          </>
        }
      />

      <Dialog open={sheet !== null} onOpenChange={(o) => !o && setSheet(null)}>
        <DialogContent title={sheetBox ? `Box ${sheetBox.name}` : 'Box'} side="right">
          {sheetBox && <BoxSheet org={org} box={sheetBox} onAction={openAction} />}
        </DialogContent>
      </Dialog>

      {dlg?.t === 'hire' && <HireDialog org={org} open onOpenChange={close} onDone={reload} presetBox={dlg.box} />}
      {dlg?.t === 'assign' && <AssignManagerDialog org={org} open onOpenChange={close} onDone={reload} presetBox={dlg.box} />}
      {dlg?.t === 'unassign' && <UnassignManagerDialog org={org} open onOpenChange={close} onDone={reload} boxId={dlg.box} />}
      {dlg?.t === 'resign' && org.repOfBox.get(dlg.box) && <ResignRepDialog rep={org.repOfBox.get(dlg.box)!} open onOpenChange={close} onDone={reload} />}
      {dlg?.t === 'transfer' && org.repOfBox.get(dlg.box) && <TransferDialog org={org} rep={org.repOfBox.get(dlg.box)!} open onOpenChange={close} onDone={reload} />}
      {dlg?.t === 'create' && <BoxNameDialog org={org} onClose={close} onDone={reload} />}
      {dlg?.t === 'rename' && <BoxNameDialog org={org} box={org.boxById.get(dlg.box)} onClose={close} onDone={reload} />}
    </div>
  )
}

function BoxSheet({ org, box, onAction }: { org: OrgView; box: Box; onAction: (d: NonNullable<Dlg>) => void }) {
  const today = todayIso()
  const rep = org.repOfBox.get(box.id)
  const mgr = org.managerOfBox.get(box.id)
  const terrs = org.boxTerritory
    .filter((bt) => bt.box_id === box.id && isActiveOn(bt, today))
    .map((bt) => org.territoryById.get(bt.territory_id)?.name)
    .filter((n): n is string => !!n)
    .sort()
  const repHist = org.repBox.filter((x) => x.box_id === box.id).sort((a, b) => b.valid_from.localeCompare(a.valid_from))
  const mgrHist = org.managerBox.filter((x) => x.box_id === box.id).sort((a, b) => b.valid_from.localeCompare(a.valid_from))
  return (
    <div className="h-full space-y-6 overflow-y-auto p-6">
      <div>
        <h2 className="text-lg font-semibold">{box.name}</h2>
        <p className="text-sm text-muted-foreground">{org.lineById.get(box.line_id)?.name}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {!rep ? (
          <Button size="sm" variant="primary" onClick={() => onAction({ t: 'hire', box: box.id })}>Hire into box</Button>
        ) : (
          <>
            <Button size="sm" onClick={() => onAction({ t: 'resign', box: box.id })}>Resign rep</Button>
            <Button size="sm" onClick={() => onAction({ t: 'transfer', box: box.id })}>Transfer rep</Button>
          </>
        )}
        <Button size="sm" onClick={() => onAction({ t: 'assign', box: box.id })}>{mgr ? 'Change manager' : 'Assign manager'}</Button>
        {mgr && <Button size="sm" onClick={() => onAction({ t: 'unassign', box: box.id })}>Unassign manager</Button>}
        <Button size="sm" variant="ghost" onClick={() => onAction({ t: 'rename', box: box.id })}>Rename</Button>
      </div>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Territories ({terrs.length})</h3>
        {terrs.length ? <p className="text-sm text-muted-foreground">{terrs.join(' · ')}</p> : <p className="text-sm text-muted-foreground">No territories.</p>}
      </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold">Rep history</h3>
        <Timeline empty="No rep has covered this box." items={repHist.map((h) => ({ id: h.id, title: org.repById.get(h.rep_id)?.name ?? '?', range: spanText(h.valid_from, h.valid_to), muted: h.valid_to !== null }))} />
      </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold">Manager history</h3>
        <Timeline empty="No manager has covered this box." items={mgrHist.map((h) => ({ id: h.id, title: org.managerById.get(h.manager_id)?.name ?? '?', range: spanText(h.valid_from, h.valid_to), muted: h.valid_to !== null }))} />
      </section>
    </div>
  )
}

function BoxNameDialog({ org, box, onClose, onDone }: { org: OrgView; box?: Box; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(box?.name ?? '')
  const [line, setLine] = useState<string | null>(box ? String(box.line_id) : null)
  return (
    <FormDialog
      open
      onOpenChange={onClose}
      onDone={onDone}
      title={box ? 'Rename box' : 'New box'}
      submitLabel={box ? 'Rename' : 'Create'}
      disabled={!name.trim() || !line}
      onSubmit={async () => {
        const q = box
          ? supabase.from('boxes').update({ name: name.trim() }).eq('id', box.id)
          : supabase.from('boxes').insert({ name: name.trim(), line_id: Number(line) })
        const { error } = await q
        if (error) throw new Error(error.message.includes('duplicate') ? 'A box with this name already exists in the line.' : error.message)
        return { message: box ? 'Box renamed' : 'Box created' }
      }}
    >
      {!box && (
        <Field label="Line">
          <Combobox allowAll={false} label="Line" placeholder="Select line" className="w-full" options={org.lines.map((l) => ({ value: String(l.id), label: l.name }))} value={line} onChange={setLine} />
        </Field>
      )}
      <Field label="Box name" htmlFor="bx-name"><Input id="bx-name" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
    </FormDialog>
  )
}

