import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowRightLeft, Pencil, Plus } from 'lucide-react'
import { DataTable } from '../../components/app/DataTable'
import { Combobox } from '../../components/ui/combobox'
import { Button } from '../../components/ui/button'
import { Input, StatusPill } from '../../components/ui/misc'
import { DateField, Field, FormDialog } from '../../components/app/FormDialog'
import { rpc } from '../../lib/api/core'
import type { OrgView, Territory } from '../../lib/api/org'
import { supabase } from '../../lib/supabase'
import { todayIso } from '../../lib/norm'

interface Row {
  t: Territory
  line: string
  name: string
  box: string
  rep: string
  manager: string
}

type Dlg = { k: 'create' } | { k: 'rename'; t: Territory } | { k: 'move'; t: Territory } | null

export default function TerritoriesTab({ org, reload }: { org: OrgView; reload: () => void }) {
  const [line, setLine] = useState<string | null>(null)
  const [dlg, setDlg] = useState<Dlg>(null)

  const rows = useMemo<Row[]>(
    () =>
      org.territories
        .filter((t) => (line ? String(t.line_id) === line : true))
        .map((t) => {
          const box = org.boxOfTerritory.get(t.id)
          return {
            t,
            line: org.lineById.get(t.line_id)?.name ?? '',
            name: t.name,
            box: box?.name ?? '—',
            rep: box ? org.repOfBox.get(box.id)?.name ?? 'Vacant' : '—',
            manager: box ? org.managerOfBox.get(box.id)?.name ?? 'Vacant' : '—',
          }
        }),
    [org, line],
  )
  const vacant = (v: string) => (v === 'Vacant' ? <StatusPill status="Vacant" /> : v)
  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      { accessorKey: 'line', header: 'Line' },
      { accessorKey: 'name', header: 'Territory' },
      { accessorKey: 'box', header: 'Box' },
      { accessorKey: 'rep', header: 'Current rep', cell: (c) => vacant(c.row.original.rep) },
      { accessorKey: 'manager', header: 'Current manager', cell: (c) => vacant(c.row.original.manager) },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        enableHiding: false,
        cell: (c) => (
          <span className="flex gap-1">
            <Button size="icon-sm" variant="ghost" aria-label={`Rename ${c.row.original.name}`} onClick={() => setDlg({ k: 'rename', t: c.row.original.t })}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Move ${c.row.original.name} to another box`} onClick={() => setDlg({ k: 'move', t: c.row.original.t })}>
              <ArrowRightLeft className="h-4 w-4" />
            </Button>
          </span>
        ),
      },
    ],
    [],
  )
  const close = () => setDlg(null)

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        csvName="territories"
        pageSize={15}
        emptyTitle="No territories yet"
        emptyDescription="Use the Import tab to load the workbook, or create a territory."
        toolbar={
          <>
            <Combobox label="Line" placeholder="All lines" className="h-8" options={org.lines.map((l) => ({ value: String(l.id), label: l.name }))} value={line} onChange={setLine} />
            <Button size="sm" variant="primary" onClick={() => setDlg({ k: 'create' })}>
              <Plus className="h-4 w-4" /> New territory
            </Button>
          </>
        }
      />
      {dlg?.k === 'create' && <CreateTerritory org={org} onClose={close} onDone={reload} />}
      {dlg?.k === 'rename' && <RenameTerritory t={dlg.t} onClose={close} onDone={reload} />}
      {dlg?.k === 'move' && <MoveTerritory org={org} t={dlg.t} onClose={close} onDone={reload} />}
    </>
  )
}

function CreateTerritory({ org, onClose, onDone }: { org: OrgView; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [line, setLine] = useState<string | null>(null)
  const [box, setBox] = useState<string | null>(null)
  const [date, setDate] = useState(todayIso())
  const boxes = org.boxes.filter((b) => String(b.line_id) === line).map((b) => ({ value: String(b.id), label: b.name }))
  return (
    <FormDialog
      open
      onOpenChange={onClose}
      onDone={onDone}
      title="New territory"
      description="Territory names are unique within a line (the same name may exist in another line)."
      submitLabel="Create"
      disabled={!name.trim() || !line || !box}
      onSubmit={async () => {
        const ins = await supabase.from('territories').insert({ name: name.trim(), line_id: Number(line) }).select('id').single()
        if (ins.error) throw new Error(ins.error.message.includes('duplicate') ? 'A territory with this name already exists in the line.' : ins.error.message)
        const link = await supabase.from('box_territory').insert({ box_id: Number(box), territory_id: ins.data.id, valid_from: date })
        if (link.error) throw new Error(`Territory created but could not be linked to the box: ${link.error.message}`)
        await rpc('rebuild_org_from', { p_date: date })
        return { message: `Territory ${name.trim()} created`, rebuiltFrom: date }
      }}
    >
      <Field label="Line">
        <Combobox allowAll={false} label="Line" placeholder="Select line" className="w-full" options={org.lines.map((l) => ({ value: String(l.id), label: l.name }))} value={line} onChange={(v) => { setLine(v); setBox(null) }} />
      </Field>
      <Field label="Territory name" htmlFor="t-name"><Input id="t-name" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Box (same line)">
        <Combobox allowAll={false} label="Box" placeholder={line ? 'Select box' : 'Pick a line first'} className="w-full" options={boxes} value={box} onChange={setBox} />
      </Field>
      <DateField id="t-from" label="In the box from" value={date} onChange={setDate} />
    </FormDialog>
  )
}

function RenameTerritory({ t, onClose, onDone }: { t: Territory; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(t.name)
  return (
    <FormDialog
      open
      onOpenChange={onClose}
      onDone={onDone}
      title={`Rename ${t.name}`}
      submitLabel="Rename"
      disabled={!name.trim() || name.trim() === t.name}
      onSubmit={async () => {
        const { error } = await supabase.from('territories').update({ name: name.trim() }).eq('id', t.id)
        if (error) throw new Error(error.message.includes('duplicate') ? 'Another territory in this line already has this name.' : error.message)
        return { message: 'Territory renamed' }
      }}
    >
      <Field label="New name" htmlFor="rt-name"><Input id="rt-name" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
    </FormDialog>
  )
}

function MoveTerritory({ org, t, onClose, onDone }: { org: OrgView; t: Territory; onClose: () => void; onDone: () => void }) {
  const [box, setBox] = useState<string | null>(null)
  const [date, setDate] = useState(todayIso())
  const current = org.boxOfTerritory.get(t.id)
  const boxes = org.boxes.filter((b) => b.line_id === t.line_id && b.id !== current?.id).map((b) => ({ value: String(b.id), label: b.name }))
  return (
    <FormDialog
      open
      onOpenChange={onClose}
      onDone={onDone}
      title={`Move ${t.name}`}
      description={`Currently in ${current?.name ?? 'no box'}. Only boxes of the same line are listed.`}
      submitLabel="Move"
      disabled={!box}
      onSubmit={async () => {
        await rpc('move_territory', { p_territory: t.id, p_new_box: Number(box), p_first_day: date })
        return { message: `${t.name} moved`, rebuiltFrom: date }
      }}
    >
      <Field label="New box">
        <Combobox allowAll={false} label="Box" placeholder="Select box" className="w-full" options={boxes} value={box} onChange={setBox} />
      </Field>
      <DateField id="mv-date" label="First day in the new box" value={date} onChange={setDate} />
    </FormDialog>
  )
}
