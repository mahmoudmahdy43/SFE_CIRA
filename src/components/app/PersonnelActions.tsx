import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Combobox, type Option } from '../ui/combobox'
import { Input } from '../ui/misc'
import { Button } from '../ui/button'
import { DateField, Field, FormDialog } from './FormDialog'
import { isActiveOn, type Manager, type OrgView, type Rep } from '../../lib/api/org'
import { rpc } from '../../lib/api/core'
import { todayIso } from '../../lib/norm'

interface Base {
  org: OrgView
  open: boolean
  onOpenChange: (o: boolean) => void
  onDone: () => void
}

/** Boxes with no rep on `day` (sorted by label). */
export function vacantBoxOptions(org: OrgView, day: string): Option[] {
  const taken = new Set(org.repBox.filter((rb) => isActiveOn(rb, day)).map((rb) => rb.box_id))
  return org.boxes
    .filter((b) => !taken.has(b.id))
    .map((b) => ({ value: String(b.id), label: org.boxLabel(b.id) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export const allBoxOptions = (org: OrgView): Option[] =>
  org.boxes.map((b) => ({ value: String(b.id), label: org.boxLabel(b.id) })).sort((a, b) => a.label.localeCompare(b.label))

export const managerOptions = (org: OrgView): Option[] =>
  org.managers.filter((m) => m.status === 'Active').map((m) => ({ value: String(m.id), label: m.name })).sort((a, b) => a.label.localeCompare(b.label))

/* ------------------------------ Hire rep ------------------------------ */
export function HireDialog({ org, open, onOpenChange, onDone, presetBox }: Base & { presetBox?: number }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [date, setDate] = useState(todayIso())
  const [box, setBox] = useState<string | null>(presetBox ? String(presetBox) : null)
  const options = useMemo(() => vacantBoxOptions(org, date), [org, date])
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDone={onDone}
      title="Hire rep"
      description="Creates the rep (or re-activates an existing code) and puts them on the box from the first day."
      submitLabel="Hire"
      disabled={!code.trim() || !name.trim() || !box}
      onSubmit={async () => {
        await rpc('hire_rep', { p_code: code.trim(), p_name: name.trim(), p_box: Number(box), p_date: date })
        return { message: `${name.trim()} hired`, rebuiltFrom: date }
      }}
    >
      <Field label="Rep code" htmlFor="h-code"><Input id="h-code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 1C0813" /></Field>
      <Field label="Full name" htmlFor="h-name"><Input id="h-name" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <DateField id="h-date" label="First day on the box" value={date} onChange={setDate} />
      <Field label="Box" hint="Only boxes that are vacant on the chosen date are listed.">
        <Combobox allowAll={false} label="Box" placeholder="Select a box" options={options} value={box} onChange={setBox} className="w-full" />
      </Field>
    </FormDialog>
  )
}

/* ----------------------------- Resign rep ----------------------------- */
export function ResignRepDialog({ rep, open, onOpenChange, onDone }: Omit<Base, 'org'> & { rep: Rep }) {
  const [date, setDate] = useState(todayIso())
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDone={onDone}
      title={`Resign ${rep.name}`}
      description="The box becomes Vacant after the last day."
      submitLabel="Resign"
      variant="danger"
      onSubmit={async () => {
        await rpc('resign_rep', { p_rep: rep.id, p_last_day: date })
        return { message: `${rep.name} resigned`, rebuiltFrom: date }
      }}
    >
      <DateField id="r-date" label="Last day on the box" value={date} onChange={setDate} hint="The resignation date is the last day the rep still covers the box." />
    </FormDialog>
  )
}

/* ---------------------------- Transfer rep ---------------------------- */
export function TransferDialog({ org, rep, open, onOpenChange, onDone }: Base & { rep: Rep }) {
  const [date, setDate] = useState(todayIso())
  const [box, setBox] = useState<string | null>(null)
  const options = useMemo(() => vacantBoxOptions(org, date), [org, date])
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDone={onDone}
      title={`Transfer ${rep.name}`}
      submitLabel="Transfer"
      disabled={!box}
      onSubmit={async () => {
        await rpc('transfer_rep', { p_rep: rep.id, p_new_box: Number(box), p_first_day: date })
        return { message: `${rep.name} transferred`, rebuiltFrom: date }
      }}
    >
      <DateField id="t-date" label="First day on the new box" value={date} onChange={setDate} />
      <Field label="New box" hint="Only boxes that are vacant on the chosen date are listed.">
        <Combobox allowAll={false} label="Box" placeholder="Select a box" options={options} value={box} onChange={setBox} className="w-full" />
      </Field>
    </FormDialog>
  )
}

/* --------------------------- Create manager --------------------------- */
export function CreateManagerDialog({ open, onOpenChange, onDone }: Omit<Base, 'org'>) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [hire, setHire] = useState('')
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDone={onDone}
      title="Create manager"
      description="Then assign the manager to boxes from the Managers tab."
      submitLabel="Create"
      disabled={!name.trim()}
      onSubmit={async () => {
        await rpc('create_manager', { p_code: code.trim() || null, p_name: name.trim(), p_hire: hire || null })
        return { message: `Manager ${name.trim()} created` }
      }}
    >
      <Field label="Code (optional)" htmlFor="m-code" hint="The employee code used in the visits file."><Input id="m-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      <Field label="Full name" htmlFor="m-name"><Input id="m-name" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Hire date (optional)" htmlFor="m-hire"><Input id="m-hire" type="date" value={hire} onChange={(e) => setHire(e.target.value)} /></Field>
    </FormDialog>
  )
}

/* --------------------------- Assign manager --------------------------- */
export function AssignManagerDialog({ org, open, onOpenChange, onDone, manager, presetBox, presetBoxes }: Base & { manager?: Manager; presetBox?: number; presetBoxes?: number[] }) {
  const [mgr, setMgr] = useState<string | null>(manager ? String(manager.id) : null)
  const [boxes, setBoxes] = useState<number[]>(presetBoxes ?? (presetBox ? [presetBox] : []))
  const [date, setDate] = useState(todayIso())
  const options = allBoxOptions(org).filter((o) => !boxes.includes(Number(o.value)))
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDone={onDone}
      title="Assign manager to box(es)"
      description="Replaces the box's current manager from the first day."
      submitLabel="Assign"
      disabled={!mgr || boxes.length === 0}
      onSubmit={async () => {
        for (const b of boxes) await rpc('assign_manager', { p_manager: Number(mgr), p_box: b, p_first_day: date })
        return { message: `Manager assigned to ${boxes.length} box(es)`, rebuiltFrom: date }
      }}
    >
      {!manager && (
        <Field label="Manager">
          <Combobox allowAll={false} label="Manager" placeholder="Select a manager" options={managerOptions(org)} value={mgr} onChange={setMgr} className="w-full" />
        </Field>
      )}
      <DateField id="a-date" label="First day" value={date} onChange={setDate} />
      <Field label="Boxes">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {boxes.map((b) => (
            <span key={b} className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs text-accent-foreground">
              {org.boxLabel(b)}
              <button type="button" aria-label={`Remove ${org.boxLabel(b)}`} onClick={() => setBoxes((x) => x.filter((y) => y !== b))}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <Combobox allowAll={false} label="Box" placeholder="Add a box…" options={options} value={null} onChange={(v) => v && setBoxes((x) => [...x, Number(v)])} className="w-full" />
      </Field>
    </FormDialog>
  )
}

/* -------------------------- Unassign manager -------------------------- */
export function UnassignManagerDialog({ org, boxId, open, onOpenChange, onDone }: Base & { boxId: number }) {
  const [date, setDate] = useState(todayIso())
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDone={onDone}
      title={`Unassign manager — ${org.boxLabel(boxId)}`}
      description="The box becomes Vacant manager; its sales roll up to the NSM."
      submitLabel="Unassign"
      variant="danger"
      onSubmit={async () => {
        await rpc('unassign_manager', { p_box: boxId, p_last_day: date })
        return { message: 'Manager unassigned', rebuiltFrom: date }
      }}
    >
      <DateField id="u-date" label="Last day with this manager" value={date} onChange={setDate} />
    </FormDialog>
  )
}

/* --------------------------- Resign manager --------------------------- */
export function ResignManagerDialog({ manager, open, onOpenChange, onDone }: Omit<Base, 'org'> & { manager: Manager }) {
  const [date, setDate] = useState(todayIso())
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDone={onDone}
      title={`Resign ${manager.name}`}
      description="All of this manager's boxes become Vacant manager and roll up to the NSM."
      submitLabel="Resign"
      variant="danger"
      onSubmit={async () => {
        await rpc('resign_manager', { p_manager: manager.id, p_last_day: date })
        return { message: `${manager.name} resigned`, rebuiltFrom: date }
      }}
    >
      <DateField id="rm-date" label="Last day" value={date} onChange={setDate} />
    </FormDialog>
  )
}

/* ------------------------------ Change NSM ------------------------------ */
export function ChangeNsmDialog({ org, lineId, open, onOpenChange, onDone }: Base & { lineId: number }) {
  const [mode, setMode] = useState<'existing' | 'new' | 'vacant'>('existing')
  const [nsm, setNsm] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [date, setDate] = useState(todayIso())
  const lineName = org.lineById.get(lineId)?.name ?? ''
  const valid = mode === 'vacant' || (mode === 'existing' && nsm) || (mode === 'new' && newName.trim())
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDone={onDone}
      title={`Change NSM — ${lineName}`}
      submitLabel="Save"
      disabled={!valid}
      onSubmit={async () => {
        await rpc('set_nsm', {
          p_line: lineId,
          p_nsm: mode === 'existing' ? Number(nsm) : null,
          p_first_day: date,
          p_new_name: mode === 'new' ? newName.trim() : null,
        })
        return { message: `NSM of ${lineName} updated`, rebuiltFrom: date }
      }}
    >
      <div role="radiogroup" aria-label="NSM choice" className="flex gap-1 rounded-control bg-muted p-1">
        {(['existing', 'new', 'vacant'] as const).map((m) => (
          <Button key={m} type="button" size="sm" variant={mode === m ? 'outline' : 'ghost'} role="radio" aria-checked={mode === m} className="flex-1" onClick={() => setMode(m)}>
            {{ existing: 'Existing', new: 'New person', vacant: 'Vacant' }[m]}
          </Button>
        ))}
      </div>
      {mode === 'existing' && (
        <Field label="NSM">
          <Combobox allowAll={false} label="NSM" placeholder="Select NSM" options={org.nsms.map((n) => ({ value: String(n.id), label: n.name }))} value={nsm} onChange={setNsm} className="w-full" />
        </Field>
      )}
      {mode === 'new' && (
        <Field label="Name" htmlFor="n-name"><Input id="n-name" value={newName} onChange={(e) => setNewName(e.target.value)} /></Field>
      )}
      <DateField id="n-date" label="First day" value={date} onChange={setDate} />
    </FormDialog>
  )
}
