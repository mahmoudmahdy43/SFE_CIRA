import { useMemo, useRef, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { CalendarClock, CopyPlus, FileUp, History, Info, Loader2, Layers } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader, ErrorState } from '../components/app/states'
import { DataTable } from '../components/app/DataTable'
import { Field, FormDialog } from '../components/app/FormDialog'
import { Combobox } from '../components/ui/combobox'
import { Button } from '../components/ui/button'
import { Card, Input, Skeleton, StatusPill } from '../components/ui/misc'
import { Dialog, DialogContent, Popover, PopoverContent, PopoverTrigger, Tooltip } from '../components/ui/overlay'
import { useMonth } from '../context/MonthContext'
import { effectiveTarget, useOrg, type Box, type OrgView } from '../lib/api/org'
import { monthsFrom, refreshMonths, upsertChunks } from '../lib/api/core'
import { openWorkbook, readColumns, text } from '../lib/excel'
import { addMonthsIso, normName } from '../lib/norm'
import { cn } from '../lib/utils'

type Shift = 'AM' | 'PM'
interface Row {
  box: Box
  line: string
  name: string
  manager: string
  vacant: boolean
  am: number | null
  pm: number | null
  since: string
}
interface TargetUpsert { box_id: number; shift: Shift; effective_from: string; target: number }

const valid = (n: number) => Number.isFinite(n) && n >= 0 && n <= 50 && Math.abs(n * 2 - Math.round(n * 2)) < 1e-9

/** Save rows, then refresh KPIs from the selected month through the current month. */
async function saveTargets(rows: TargetUpsert[], month: string, onProgress?: (d: number, t: number) => void): Promise<void> {
  await upsertChunks('call_rate_targets', rows, 'box_id,shift,effective_from')
  await refreshMonths(monthsFrom(month), onProgress)
}

export default function Targets() {
  const { month } = useMonth()
  const { org, error, reload } = useOrg()
  const [line, setLine] = useState<string | null>(null)
  const [mgr, setMgr] = useState<string | null>(null)
  const [vac, setVac] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dlg, setDlg] = useState<'line' | 'excel' | null>(null)

  const refetch = () => void reload()

  const commit = async (rows: TargetUpsert[], okMessage: string) => {
    setBusy('Saving…')
    try {
      await saveTargets(rows, month, (d, t) => setBusy(`Refreshing KPIs ${d}/${t}…`))
      toast.success(okMessage, { description: `KPIs refreshed from ${month.slice(0, 7)} onwards.` })
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(null)
    }
  }

  const rows = useMemo<Row[]>(() => {
    if (!org) return []
    return org.boxes
      .filter((b) => (line ? String(b.line_id) === line : true))
      .filter((b) => (mgr ? (mgr === 'vacant' ? !org.managerOfBox.has(b.id) : org.managerOfBox.get(b.id)?.id === Number(mgr)) : true))
      .filter((b) => (vac === 'vacant' ? !org.repOfBox.has(b.id) : vac === 'covered' ? org.repOfBox.has(b.id) : true))
      .map((b) => {
        const am = effectiveTarget(org.targets, b.id, 'AM', month)
        const pm = effectiveTarget(org.targets, b.id, 'PM', month)
        return {
          box: b,
          line: org.lineById.get(b.line_id)?.name ?? '',
          name: b.name,
          manager: org.managerOfBox.get(b.id)?.name ?? 'Vacant',
          vacant: !org.repOfBox.has(b.id),
          am: am?.target ?? null,
          pm: pm?.target ?? null,
          since: [am?.effective_from, pm?.effective_from].filter(Boolean).sort().pop() ?? '—',
        }
      })
  }, [org, line, mgr, vac, month])

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      { accessorKey: 'line', header: 'Line' },
      {
        accessorKey: 'name', header: 'Box', enableHiding: false,
        cell: (c) => (
          <span className="flex items-center gap-2">
            {c.row.original.name}
            {c.row.original.vacant && <StatusPill status="Vacant" />}
          </span>
        ),
      },
      { accessorKey: 'manager', header: 'Manager' },
      { accessorKey: 'am', header: 'AM target', cell: (c) => <TargetCell value={c.row.original.am} label={`AM target for ${c.row.original.name}`} disabled={!!busy} onSave={(v) => commit([{ box_id: c.row.original.box.id, shift: 'AM', effective_from: month, target: v }], 'AM target saved')} /> },
      { accessorKey: 'pm', header: 'PM target', cell: (c) => <TargetCell value={c.row.original.pm} label={`PM target for ${c.row.original.name}`} disabled={!!busy} onSave={(v) => commit([{ box_id: c.row.original.box.id, shift: 'PM', effective_from: month, target: v }], 'PM target saved')} /> },
      { accessorKey: 'since', header: 'Effective since' },
      { id: 'hist', header: 'History', enableSorting: false, cell: (c) => org && <HistoryPopover org={org} box={c.row.original.box} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [org, month, busy],
  )

  const copyPrevious = async () => {
    if (!org) return
    const prev = addMonthsIso(month, -1)
    const out: TargetUpsert[] = []
    for (const b of org.boxes) {
      for (const shift of ['AM', 'PM'] as const) {
        const had = org.targets.some((t) => t.box_id === b.id && t.shift === shift && t.effective_from === month)
        const p = effectiveTarget(org.targets, b.id, shift, prev)
        const cur = effectiveTarget(org.targets, b.id, shift, month)
        if (!had && p && p.target !== (cur?.target ?? null)) out.push({ box_id: b.id, shift, effective_from: month, target: p.target })
      }
    }
    if (out.length === 0) {
      toast.info('Nothing to copy', { description: 'Targets carry forward automatically, so this month already has the same effective values as the previous month.' })
      return
    }
    await commit(out, `${out.length} target row(s) copied`)
  }

  return (
    <div>
      <PageHeader
        title="Targets"
        description="Call-rate targets per box per shift. A value saved here applies from the selected month onwards, until changed."
        actions={
          <>
            <Tooltip side="bottom" content="Targets carry forward, so this normally inserts nothing. It only inserts rows where the previous month's effective value differs from this month's.">
              <Button disabled={!org || !!busy} onClick={() => void copyPrevious()}><CopyPlus className="h-4 w-4" /> Copy previous month</Button>
            </Tooltip>
            <Button disabled={!org || !!busy} onClick={() => setDlg('excel')}><FileUp className="h-4 w-4" /> Import Excel</Button>
            <Button variant="primary" disabled={!org || !!busy} onClick={() => setDlg('line')}><Layers className="h-4 w-4" /> Set for a line</Button>
          </>
        }
      />
      <div className="mb-4 flex items-center gap-2 rounded-control border bg-accent px-3 py-2 text-sm text-accent-foreground" role="note">
        <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
        Editing month: <b className="tnum">{month.slice(0, 7)}</b> — saved values apply from this month onwards until changed. Value range 0–50, step 0.5.
      </div>
      {busy && (
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {busy}
        </div>
      )}
      {error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : !org ? (
        <div className="space-y-3" aria-busy="true"><Skeleton className="h-10" /><Skeleton className="h-72" /></div>
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          numericColumns={['am', 'pm']}
          csvName={`targets-${month.slice(0, 7)}`}
          pageSize={20}
          emptyTitle="No boxes"
          emptyDescription="Import the org workbook first (Org & Territories → Import)."
          toolbar={
            <>
              <Combobox label="Line" placeholder="All lines" className="h-8" options={org.lines.map((l) => ({ value: String(l.id), label: l.name }))} value={line} onChange={setLine} />
              <Combobox label="Manager" placeholder="All managers" className="h-8" options={[{ value: 'vacant', label: 'Vacant manager' }, ...org.managers.map((m) => ({ value: String(m.id), label: m.name }))]} value={mgr} onChange={setMgr} />
              <Combobox label="Vacancy" placeholder="All boxes" className="h-8" options={[{ value: 'vacant', label: 'Vacant rep' }, { value: 'covered', label: 'Covered' }]} value={vac} onChange={setVac} />
            </>
          }
        />
      )}
      {org && dlg === 'line' && <LineDialog org={org} month={month} onClose={() => setDlg(null)} onSave={commit} />}
      {org && dlg === 'excel' && <ExcelDialog org={org} month={month} onClose={() => setDlg(null)} onSave={commit} />}
    </div>
  )
}

function TargetCell({ value, label, disabled, onSave }: { value: number | null; label: string; disabled: boolean; onSave: (v: number) => Promise<void> }) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value === null ? '' : String(value))
  const n = Number(draft)
  const bad = draft !== null && draft !== '' && !valid(n)
  const finish = () => {
    if (draft === null) return
    if (draft !== '' && valid(n) && n !== value) void onSave(n).finally(() => setDraft(null))
    else if (!bad) setDraft(null)
  }
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      max={50}
      step={0.5}
      aria-label={label}
      aria-invalid={bad}
      disabled={disabled}
      value={shown}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setDraft(null)
      }}
      className={cn('tnum h-8 w-20 rounded-control border bg-transparent px-2 text-right hover:bg-muted focus:bg-card', bad && 'border-danger text-danger')}
    />
  )
}

function HistoryPopover({ org, box }: { org: OrgView; box: Box }) {
  const rows = org.targets.filter((t) => t.box_id === box.id).sort((a, b) => b.effective_from.localeCompare(a.effective_from) || a.shift.localeCompare(b.shift))
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`Target history for ${box.name}`}><History className="h-4 w-4" /></Button>
      </PopoverTrigger>
      <PopoverContent className="w-60">
        <div className="mb-2 text-xs font-medium text-muted-foreground">Target history — {box.name}</div>
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No targets set yet.</p> : (
          <ul className="max-h-60 space-y-1 overflow-auto text-sm">
            {rows.map((r) => (
              <li key={`${r.shift}${r.effective_from}`} className="flex justify-between"><span className="tnum">{r.effective_from.slice(0, 7)} · {r.shift}</span><span className="tnum font-medium">{r.target}</span></li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

function LineDialog({ org, month, onClose, onSave }: { org: OrgView; month: string; onClose: () => void; onSave: (rows: TargetUpsert[], msg: string) => Promise<void> }) {
  const [line, setLine] = useState<string | null>(null)
  const [am, setAm] = useState('')
  const [pm, setPm] = useState('')
  const okAm = am !== '' && valid(Number(am))
  const okPm = pm !== '' && valid(Number(pm))
  return (
    <FormDialog
      open
      onOpenChange={onClose}
      onDone={() => undefined}
      title="Set targets for all boxes in a line"
      description={`Applies from ${month.slice(0, 7)} onwards, until changed.`}
      submitLabel="Apply"
      disabled={!line || (!okAm && !okPm) || (am !== '' && !okAm) || (pm !== '' && !okPm)}
      onSubmit={async () => {
        const boxes = org.boxes.filter((b) => String(b.line_id) === line)
        const rows: TargetUpsert[] = boxes.flatMap((b) => [
          ...(okAm ? [{ box_id: b.id, shift: 'AM' as const, effective_from: month, target: Number(am) }] : []),
          ...(okPm ? [{ box_id: b.id, shift: 'PM' as const, effective_from: month, target: Number(pm) }] : []),
        ])
        void onSave(rows, `Targets set for ${boxes.length} boxes`)
        return { message: 'Saving targets…' }
      }}
    >
      <Field label="Line"><Combobox allowAll={false} label="Line" placeholder="Select line" className="w-full" options={org.lines.map((l) => ({ value: String(l.id), label: l.name }))} value={line} onChange={setLine} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="AM target" htmlFor="l-am" hint="Leave empty to keep"><Input id="l-am" type="number" min={0} max={50} step={0.5} value={am} onChange={(e) => setAm(e.target.value)} /></Field>
        <Field label="PM target" htmlFor="l-pm" hint="Leave empty to keep"><Input id="l-pm" type="number" min={0} max={50} step={0.5} value={pm} onChange={(e) => setPm(e.target.value)} /></Field>
      </div>
    </FormDialog>
  )
}

function ExcelDialog({ org, month, onClose, onSave }: { org: OrgView; month: string; onClose: () => void; onSave: (rows: TargetUpsert[], msg: string) => Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<TargetUpsert[] | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setErr(null)
    try {
      const wb = openWorkbook(await f.arrayBuffer())
      const ws = wb.Sheets[wb.SheetNames[0]]
      const r = readColumns(ws, { line: ['Line'], box: ['Box'], am: ['AM'], pm: ['PM'] })
      if (r.missing.length) {
        setErr(`Missing column(s): ${r.missing.join(', ')}. Expected: Line, Box, AM, PM.`)
        setRows(null)
        return
      }
      const lineByNorm = new Map(org.lines.map((l) => [normName(l.name), l.id]))
      const boxByKey = new Map(org.boxes.map((b) => [`${b.line_id}|${normName(b.name)}`, b.id]))
      const out: TargetUpsert[] = []
      const bad: string[] = []
      r.rows.forEach((x, i) => {
        const lid = lineByNorm.get(normName(text(x.line)))
        const bid = lid ? boxByKey.get(`${lid}|${normName(text(x.box))}`) : undefined
        if (!bid) return void bad.push(`Row ${i + 2}: box "${text(x.line) ?? ''} / ${text(x.box) ?? ''}" not found.`)
        for (const [shift, v] of [['AM', x.am], ['PM', x.pm]] as const) {
          if (v === null) continue
          const n = typeof v === 'number' ? v : Number(v)
          if (!valid(n)) bad.push(`Row ${i + 2}: ${shift} value "${v}" must be 0–50 in steps of 0.5.`)
          else out.push({ box_id: bid, shift, effective_from: month, target: n })
        }
      })
      setRows(out)
      setProblems(bad)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not read the file')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Import targets from Excel" description="Columns: Line, Box, AM, PM (first sheet). Values apply from the selected month onwards.">
        <div className="mt-4 space-y-3">
          <input ref={ref} type="file" accept=".xlsx,.xls" className="sr-only" id="tg-file" onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button onClick={() => ref.current?.click()}><FileUp className="h-4 w-4" /> Choose file…</Button>
          {err && <div role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">{err}</div>}
          {rows && (
            <Card className="p-3 text-sm">
              <p><b className="tnum">{rows.length}</b> target value(s) ready for {month.slice(0, 7)}.</p>
              {problems.length > 0 && (
                <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-auto pl-5 text-warning">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
              )}
            </Card>
          )}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> Rows that fail validation are skipped and listed above.</p>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!rows || rows.length === 0} onClick={() => { if (rows) void onSave(rows, `${rows.length} targets imported`); onClose() }}>Import</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

