import { useMemo, useRef, useState, type DragEvent } from 'react'
import { format, parseISO } from 'date-fns'
import { AlertTriangle, Download, FileSpreadsheet, ListChecks, Plus, Trash2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorState, PageHeader } from '../components/app/states'
import { Button } from '../components/ui/button'
import { Card, Input } from '../components/ui/misc'
import { Dialog, DialogContent, DialogTrigger } from '../components/ui/overlay'
import { downloadDailyWorkbook } from '../features/daily/dailyExport'
import {
  NOT_IN_SYSTEM, STATUS_COLORS, buildLineRows, commentKey, computeCards, defaultComment, detectFromName, fmtAvg, fmtNum, normName, parseReportRows, unseenProspection, yesterdayIso,
  type DailyRow, type FileRep, type ParsedFile, type Shift,
} from '../features/daily/dailyMath'
import { useAsync } from '../features/dashboard/useAsync'
import { fetchDailyReps, fetchProspection, saveProspection } from '../lib/api/daily'
import { cn } from '../lib/utils'

const LINES = [1, 2, 3] as const
const LOGO = `${import.meta.env.BASE_URL}assets/cira-logo.png`
const GREEN = '#1B5E42'
const SELECT = 'h-8 rounded-control border bg-card px-2 text-sm text-foreground'

interface LoadedFile { id: number; name: string; shift: Shift | null; line: number | null; parsed: ParsedFile }
let nextId = 1

async function readFile(file: File): Promise<LoadedFile> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const ws = wb.Sheets['sheet1'] ?? wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
  const parsed = parseReportRows(rows)
  const d = detectFromName(file.name)
  return { id: nextId++, name: file.name, shift: d.shift, line: d.line ?? parsed.lineFromRows, parsed }
}

const merge = (files: LoadedFile[]): FileRep[] => files.flatMap((f) => f.parsed.reps)

/** null = nothing typed yet (an empty string means the comment was cleared on purpose). */
const readComment = (k: string): string | null => {
  try { return localStorage.getItem(k) } catch { return null }
}

/* ------------------------------ Prospection Phase list ------------------------------ */
function ProspectionDialog({ saved, suggestions, unseen, onSaved }: {
  saved: string[]; suggestions: string[]; unseen: number; onSaved: (names: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>(saved)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const add = () => {
    const name = text.replace(/\s+/g, ' ').trim()
    if (name === '') return
    if (!draft.some((d) => normName(d) === normName(name))) setDraft((cur) => [...cur, name])
    setText('')
  }
  const save = async () => {
    setBusy(true)
    try {
      const n = await saveProspection(draft)
      onSaved(draft)
      toast.success(`Prospection Phase list saved: ${n} name${n === 1 ? '' : 's'}`)
      setOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setDraft(saved); setText('') } }}>
      <DialogTrigger asChild>
        <Button><ListChecks className="h-4 w-4" aria-hidden /> Prospection Phase list ({saved.length})</Button>
      </DialogTrigger>
      <DialogContent title="Prospection Phase list" description="These reps always show as Reported Day with the comment Prospection Phase. The list is saved once and applies to every day.">
        <div className="mt-4 flex gap-2">
          <Input list="daily-prospection-names" value={text} placeholder="Rep name" aria-label="Rep name" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <datalist id="daily-prospection-names">{suggestions.map((n) => <option key={n} value={n} />)}</datalist>
          <Button onClick={add} disabled={text.trim() === ''}><Plus className="h-4 w-4" aria-hidden /> Add</Button>
        </div>
        <ul className="mt-3 max-h-64 divide-y overflow-y-auto rounded-control border text-sm">
          {draft.length === 0 && <li className="px-3 py-3 text-muted-foreground">The list is empty.</li>}
          {draft.map((n) => (
            <li key={normName(n)} className="flex items-center justify-between gap-2 px-3 py-1.5">
              {n}
              <button aria-label={`Remove ${n}`} className="rounded-control p-1 text-muted-foreground hover:bg-muted" onClick={() => setDraft((cur) => cur.filter((d) => d !== n))}><X className="h-4 w-4" aria-hidden /></button>
            </li>
          ))}
        </ul>
        {unseen > 0 && <p className="mt-2 text-xs text-muted-foreground">{unseen} name{unseen === 1 ? '' : 's'} in the saved list {unseen === 1 ? 'is' : 'are'} not in today's files.</p>}
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={() => void save()} disabled={busy}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------ upload ------------------------------ */
function UploadZone({ files, onFiles, onChange, onRemove }: {
  files: LoadedFile[]
  onFiles: (f: File[]) => void
  onChange: (id: number, patch: Partial<Pick<LoadedFile, 'shift' | 'line'>>) => void
  onRemove: (id: number) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    onFiles([...e.dataTransfer.files])
  }
  return (
    <Card className="p-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cn('flex cursor-pointer flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed px-4 py-6 text-center', over && 'border-primary bg-muted')}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      >
        <Upload className="h-5 w-5 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">Drop the CRM Daily Report files here, or click to choose</p>
        <p className="text-xs text-muted-foreground">PM and PHARMA files for CIRA 1, 2 and 3 (up to six). Nothing is uploaded — files are read in this browser only.</p>
        <input ref={input} type="file" multiple accept=".xlsx,.xls" className="hidden" onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
      </div>
      {files.length > 0 && (
        <ul className="mt-3 divide-y text-sm">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
              <span className="text-xs text-muted-foreground">{f.parsed.reps.length} reps</span>
              <select aria-label={`Line of ${f.name}`} className={cn(SELECT, f.line === null && 'border-destructive')} value={f.line ?? ''} onChange={(e) => onChange(f.id, { line: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Line?</option>
                {LINES.map((l) => <option key={l} value={l}>CIRA {l}</option>)}
              </select>
              <select aria-label={`Type of ${f.name}`} className={cn(SELECT, f.shift === null && 'border-destructive')} value={f.shift ?? ''} onChange={(e) => onChange(f.id, { shift: (e.target.value || null) as Shift | null })}>
                <option value="">Type?</option>
                <option value="PM">PM</option>
                <option value="PHARMA">Pharmacy</option>
              </select>
              <Button variant="ghost" size="sm" aria-label={`Remove ${f.name}`} onClick={() => onRemove(f.id)}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ------------------------------ one line ------------------------------ */
function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="overflow-hidden rounded-card border bg-card shadow-sm">
      <div className="px-2 py-1 text-center text-[10px] font-bold leading-tight text-white" style={{ background: color }}>{label}</div>
      <div className="tnum py-3 text-center text-2xl font-bold">{value}</div>
    </div>
  )
}

function LineView({ line, date, rows, comment, setComment }: {
  line: number; date: string; rows: DailyRow[]
  comment: (k: string, r: DailyRow) => string; setComment: (k: string, v: string) => void
}) {
  const c = computeCards(rows)
  const missing = rows.filter((r) => !r.inSystem).length
  return (
    <div className="space-y-3">
      <div className="flex items-stretch gap-3 rounded-card px-3 py-2 text-white" style={{ background: GREEN }}>
        <img src={LOGO} alt="" className="h-14 w-14 rounded bg-white object-contain p-0.5" />
        <h2 className="flex flex-1 items-center justify-center text-center text-lg font-bold">CIRA {line} - MEDICAL REP DAILY PERFORMANCE</h2>
        <div className="self-center overflow-hidden rounded border-2 border-black bg-white text-center text-black">
          <div className="px-3 text-[10px] font-bold text-white" style={{ background: GREEN }}>Date</div>
          <div className="px-3 py-0.5 text-sm font-bold">{format(parseISO(date), 'EEEE, MMMM d, yyyy')}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-9">
        <StatCard label="ACTIVE REPS" value={String(c.active)} color="#2E8B57" />
        <StatCard label="REPORTED DAY" value={String(c.reported)} color="#2E8B57" />
        <StatCard label="UNREPORTED DAY" value={String(c.unreported)} color="#C00000" />
        <StatCard label="FOLLOW UP REQ." value={String(c.followUp)} color="#ED7D31" />
        <StatCard label="AVG. PM CALL RATE" value={fmtAvg(c.avgPm)} color="#4A90A4" />
        <StatCard label="AVG. PHARMACIES C. RATE" value={fmtAvg(c.avgPharmacy)} color="#339933" />
        <StatCard label="TOTAL VACATIONS" value={String(c.vacations)} color="#C0392B" />
        <StatCard label="TOTAL OFFICE WORK" value={String(c.office)} color="#339933" />
        <StatCard label="TOTAL ACTIVITIES" value={String(c.activities)} color="#4A90A4" />
      </div>
      {missing > 0 && (
        <p className="flex items-center gap-2 rounded-control border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {missing} rep{missing === 1 ? '' : 's'} in the files {missing === 1 ? 'is' : 'are'} not in the system (District Manager shown as Unassigned).
        </p>
      )}
      <div className="overflow-x-auto rounded-card border-2 border-black bg-card">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="text-white" style={{ background: GREEN }}>
              {['District Manager', 'Medical Rep', 'Status', 'Reporting Status', 'PM Visits', 'Pharmacy Visits', 'Vacations', 'Office Work', 'Activities', 'Comment'].map((h) => (
                <th key={h} className="border border-black px-2 py-1.5 text-center font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const first = i === 0 || rows[i - 1].districtManager !== r.districtManager
              const col = STATUS_COLORS[r.reporting]
              const tint = r.reporting === 'Reported Day' ? undefined : { background: `#${col.bg}`, color: `#${col.fg}` }
              const cell = cn('border border-black/60 px-2 py-1', first && 'border-t-2 border-t-black')
              const num = cn(cell, 'tnum text-center')
              return (
                <tr key={r.key} style={tint}>
                  <td className={cell}>{r.districtManager}</td>
                  <td className={cell}>{r.rep}{r.prospection && <span className="ml-2 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-300">Prospection</span>}</td>
                  <td className={cn(cell, 'text-center')}>
                    {r.inSystem
                      ? <><span aria-hidden style={{ color: r.reporting === 'Follow Up Required' ? '#ED7D31' : '#000' }}>●</span> {r.status}</>
                      : <span className="inline-flex items-center gap-1 font-medium"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />{NOT_IN_SYSTEM}</span>}
                  </td>
                  <td className={cn(cell, 'text-center')} style={{ background: `#${col.bg}`, color: `#${col.fg}` }}>{r.reporting}</td>
                  <td className={num}>{fmtNum(r.pm)}</td>
                  <td className={num}>{fmtNum(r.pharmacy)}</td>
                  <td className={num}>{fmtNum(r.vacations)}</td>
                  <td className={num}>{fmtNum(r.office)}</td>
                  <td className={num}>{fmtNum(r.activities)}</td>
                  <td className={cn(cell, 'p-0')}>
                    <input
                      aria-label={`Comment for ${r.rep}`}
                      value={comment(commentKey(date, line, r.norm), r)}
                      onChange={(e) => setComment(commentKey(date, line, r.norm), e.target.value)}
                      className="h-full w-full min-w-[180px] bg-transparent px-2 py-1 outline-none focus:bg-white/70"
                      style={{ color: 'inherit' }}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ------------------------------ page ------------------------------ */
export default function DailyReporting() {
  const [date, setDate] = useState(yesterdayIso)
  const [files, setFiles] = useState<LoadedFile[]>([])
  const [line, setLine] = useState<number>(1)
  const [edited, setEdited] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const month = `${date.slice(0, 7)}-01`
  const reps = useAsync(`daily:reps:${month}`, () => fetchDailyReps(month))
  const prosLoad = useAsync('daily:prospection', fetchProspection)
  const [prosSaved, setProsSaved] = useState<string[] | null>(null)
  const prosNames = useMemo(() => prosSaved ?? (prosLoad.data ?? []).map((p) => p.rep_name), [prosSaved, prosLoad.data])
  const prosSet = useMemo(() => new Set(prosNames.map(normName)), [prosNames])

  const addFiles = async (list: File[]) => {
    for (const f of list) {
      try {
        const loaded = await readFile(f)
        setFiles((cur) => [...cur, loaded])
      } catch (e) {
        toast.error(`${f.name}: ${e instanceof Error ? e.message : 'could not be read'}`)
      }
    }
  }

  const byLine = useMemo(() => {
    const out = new Map<number, DailyRow[]>()
    for (const l of LINES) {
      const pick = (s: Shift) => merge(files.filter((f) => f.line === l && f.shift === s))
      const pm = pick('PM'), ph = pick('PHARMA')
      if (pm.length + ph.length > 0) out.set(l, buildLineRows(l, pm, ph, reps.data ?? [], prosSet))
    }
    return out
  }, [files, reps.data, prosSet])

  const comment = (k: string, r: DailyRow) => edited[k] ?? readComment(k) ?? defaultComment(r)
  const setComment = (k: string, v: string) => {
    setEdited((cur) => ({ ...cur, [k]: v }))
    try { localStorage.setItem(k, v) } catch { /* storage unavailable: kept in memory only */ }
  }

  const download = async () => {
    setBusy(true)
    try {
      const sheets = LINES.map((l) => {
        const rows = byLine.get(l) ?? []
        return { line: l, rows, comments: Object.fromEntries(rows.map((r) => [r.key, comment(commentKey(date, l, r.norm), r)])) }
      })
      await downloadDailyWorkbook(date, sheets, LOGO)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  const allRows = [...byLine.values()].flat()
  const unseen = files.length === 0 ? 0 : unseenProspection(prosNames, allRows).length
  const suggestions = useMemo(() => [...new Set([...files.flatMap((f) => f.parsed.reps.map((r) => r.name)), ...(reps.data ?? []).map((r) => r.rep_name)])].sort(), [files, reps.data])
  const unrecognised = files.filter((f) => f.line === null || f.shift === null).length
  const rows = byLine.get(line)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Daily Reporting"
        description="Daily rep performance per line, built in this browser from the CRM Daily Report files. Nothing is stored in the database."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              Date
              <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-8 rounded-control border bg-card px-2 text-sm" />
            </label>
            <ProspectionDialog saved={prosNames} suggestions={suggestions} unseen={unseen} onSaved={setProsSaved} />
            <Button onClick={() => void download()} disabled={busy || byLine.size === 0}><Download className="h-4 w-4" aria-hidden /> Download Excel</Button>
          </>
        }
      />
      <UploadZone
        files={files}
        onFiles={(f) => void addFiles(f)}
        onChange={(id, patch) => setFiles((cur) => cur.map((f) => (f.id === id ? { ...f, ...patch } : f)))}
        onRemove={(id) => setFiles((cur) => cur.filter((f) => f.id !== id))}
      />
      {unrecognised > 0 && <p className="text-sm text-destructive">{unrecognised} file{unrecognised === 1 ? '' : 's'} could not be identified — choose the line and type above.</p>}
      {prosLoad.error && <ErrorState className="py-4" title="Could not load the Prospection Phase list" message={prosLoad.error} onRetry={prosLoad.reload} />}
      {reps.error && <ErrorState className="py-4" title="Could not load the reps from the system" message={`${reps.error} — every rep will show as Not in system.`} onRetry={reps.reload} />}

      <div role="tablist" className="flex gap-1">
        {LINES.map((l) => (
          <button
            key={l}
            role="tab"
            aria-selected={line === l}
            onClick={() => setLine(l)}
            className={cn('rounded-control border px-4 py-1.5 text-sm font-medium', line === l ? 'border-transparent text-white' : 'bg-card hover:bg-muted')}
            style={line === l ? { background: GREEN } : undefined}
          >
            CIRA {l}{byLine.has(l) ? '' : ' (no files)'}
          </button>
        ))}
      </div>
      {rows ? (
        <LineView line={line} date={date} rows={rows} comment={comment} setComment={setComment} />
      ) : (
        <Card className="p-8 text-center text-sm text-muted-foreground">Upload the PM and PHARMA files for CIRA {line} to see its report.</Card>
      )}
    </div>
  )
}
