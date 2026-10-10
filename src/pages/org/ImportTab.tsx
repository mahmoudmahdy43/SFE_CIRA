import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Badge, Card } from '../../components/ui/misc'
import { openWorkbook } from '../../lib/excel'
import {
  executeImport, loadSnapshot, planImport, type ImportPlan, type ImportSummary,
} from '../../lib/api/importOrg'

type Stage = 'idle' | 'parsing' | 'preview' | 'running' | 'done'

export default function ImportTab({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [fileName, setFileName] = useState('')
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [step, setStep] = useState('')
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setStage('idle')
    setPlan(null)
    setSummary(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    setStage('parsing')
    setError(null)
    try {
      const wb = openWorkbook(await file.arrayBuffer())
      const db = await loadSnapshot()
      setPlan(planImport(wb, db))
      setStage('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the workbook')
      setStage('idle')
    }
  }

  const run = async () => {
    if (!plan?.exec) return
    setStage('running')
    setError(null)
    try {
      const s = await executeImport(plan.exec, setStep)
      setSummary(s)
      setStage('done')
      toast.success('Import finished', { description: `Org and KPIs were rebuilt from 2026-01-01 (${s.rebuiltMonths} month(s)).` })
      onImported()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Import failed'
      setError(`${msg} — the import stopped at "${step}". It is safe to run it again: existing rows are updated, not duplicated.`)
      toast.error(msg)
      setStage('preview')
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-accent text-accent-foreground">
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Initial data load — Rep_Data_Entry_System.xlsx</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Reads the sheets <b>Managers</b>, <b>Reps</b>, <b>Box_Manager_Map</b> and <b>Box_Territory_Map</b>. Safe to re-run: rows are matched by natural keys and nothing is duplicated.
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />
              The file is parsed in your browser only. Only the listed columns are read — any Password column is never read, stored or shown.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <input ref={inputRef} id="org-file" type="file" accept=".xlsx,.xlsm" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
              <Button variant="primary" disabled={stage === 'parsing' || stage === 'running'} onClick={() => inputRef.current?.click()}>
                {stage === 'parsing' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Choose workbook…
              </Button>
              {fileName && <span className="truncate text-sm text-muted-foreground">{fileName}</span>}
            </div>
          </div>
        </div>
      </Card>

      {error && (
        <div role="alert" className="rounded-control bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {plan && (stage === 'preview' || stage === 'running') && (
        <>
          {plan.errors.length > 0 && (
            <Card className="border-danger/40 p-5">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-danger"><XCircle className="h-4 w-4" aria-hidden /> Cannot import</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">{plan.errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </Card>
          )}
          {plan.exec && (
            <>
              <Card className="p-5">
                <h3 className="mb-3 text-sm font-semibold">Preview</h3>
                <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                  {plan.counts.map((c) => (
                    <div key={c.label} className="flex items-center justify-between border-b py-1.5 text-sm">
                      <dt className="text-muted-foreground">{c.label}</dt>
                      <dd className="tnum font-medium">{c.value.toLocaleString()}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
              <Card className="p-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Warnings
                  <Badge tone={plan.warnings.length ? 'warning' : 'success'}>{plan.warnings.length}</Badge>
                </h3>
                {plan.warnings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No warnings.</p>
                ) : (
                  <ul className="max-h-72 list-disc space-y-1 overflow-auto pl-5 text-sm">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                )}
              </Card>
              <div className="flex items-center gap-2">
                <Button variant="primary" disabled={stage === 'running'} onClick={() => void run()}>
                  {stage === 'running' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {stage === 'running' ? `Importing — ${step}…` : 'Confirm and import'}
                </Button>
                <Button disabled={stage === 'running'} onClick={reset}>Cancel</Button>
              </div>
            </>
          )}
        </>
      )}

      {summary && stage === 'done' && (
        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> Import complete</h3>
          <dl className="grid gap-x-8 sm:grid-cols-2">
            {summary.steps.map((s) => (
              <div key={s.label} className="flex items-center justify-between border-b py-1.5 text-sm">
                <dt className="text-muted-foreground">{s.label}</dt>
                <dd className="tnum font-medium">{s.count.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">Org and KPIs were rebuilt from 2026-01-01 ({summary.rebuiltMonths} month(s)). Boxes without a rep or manager were left Vacant — see Personnel → Vacancies.</p>
          <Button className="mt-4" onClick={reset}>Import another file</Button>
        </Card>
      )}
    </div>
  )
}
