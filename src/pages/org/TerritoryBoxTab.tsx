import { useRef, useState } from 'react'
import { CheckCircle2, Download, FileSpreadsheet, Loader2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/misc'
import { useAuth } from '../../context/AuthContext'
import { useAsync } from '../../features/dashboard/useAsync'
import { openWorkbook, readColumns, text } from '../../lib/excel'
import { fetchTerritoryBoxDiff, loadTerritoryBoxRef, type TerritoryBoxRow } from '../../lib/api/visitsRaw'

const WANTED = { line: ['line', 'line name'], territory: ['territory', 'territory name'], box: ['box', 'box name'] }

/** Reads `loaded` / `territory_not_found` from load_territory_box_ref (a number or a list). */
function summarise(res: unknown): { loaded: number | null; notFound: string[]; notFoundCount: number } {
  let o: unknown = res
  if (Array.isArray(o) && o.length === 1) o = o[0]
  const s = (typeof o === 'object' && o !== null ? o : {}) as Record<string, unknown>
  const nf = s.territory_not_found
  const list = Array.isArray(nf) ? nf.map((x) => (typeof x === 'object' && x !== null ? Object.values(x as object).join(' / ') : String(x))) : []
  const loaded = typeof s.loaded === 'number' ? s.loaded : s.loaded !== undefined ? Number(s.loaded) : typeof res === 'number' ? res : null
  return { loaded: Number.isFinite(loaded as number) ? loaded : null, notFound: list, notFoundCount: Array.isArray(nf) ? nf.length : Number(nf ?? 0) || 0 }
}

export default function TerritoryBoxTab() {
  const { role } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ReturnType<typeof summarise> | null>(null)
  const diff = useAsync('territory-box-diff', () => fetchTerritoryBoxDiff())

  if (role !== 'admin') return <Card className="p-5 text-sm">The Territory → Box mapping is for administrators only.</Card>

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setError(null); setResult(null)
    try {
      const wb = openWorkbook(await file.arrayBuffer())
      const read = readColumns(wb.Sheets[wb.SheetNames[0]], WANTED)
      if (read.missing.length > 0) throw new Error(`Missing column(s): ${read.missing.join(', ')}. Expected Line, Territory, Box.`)
      const rows: TerritoryBoxRow[] = read.rows
        .map((r) => ({ line: text(r.line) ?? '', territory: text(r.territory) ?? '', box: text(r.box) ?? '' }))
        .filter((r) => r.territory !== '')
      if (rows.length === 0) throw new Error('No rows found in the sheet.')
      const s = summarise(await loadTerritoryBoxRef(rows))
      setResult(s)
      toast.success('Territory → Box mapping loaded')
      diff.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const exportDiff = () => {
    const wb = XLSX.utils.book_new()
    const rows = (diff.data ?? []).map((d) => ({ Line: d.line, Territory: d.territory, 'Box in sheet': d.box_in_sheet, 'Box in system': d.box_in_system, Issue: d.issue }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Territory-Box diff')
    XLSX.writeFile(wb, 'territory-box-diff.xlsx')
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="text-base font-semibold">Territory → Box mapping</h2>
        <p className="mt-1 text-sm text-muted-foreground">Upload an .xlsx with the columns Line, Territory, Box (a Box ID column is ignored). The sheet is compared with the system below.</p>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="h-4 w-4" aria-hidden />} Choose .xlsx
          </Button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" className="sr-only" aria-label="Territory to Box workbook" onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        {error && <div role="alert" className="mt-3 rounded-control bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}
        {result && (
          <div role="status" className="mt-3 text-sm">
            <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> Loaded <b className="tnum">{result.loaded ?? '—'}</b> row(s).</p>
            {result.notFoundCount > 0 && (
              <p className="mt-1 text-warning">{result.notFoundCount.toLocaleString()} territor{result.notFoundCount === 1 ? 'y' : 'ies'} not found in the system{result.notFound.length > 0 ? `: ${result.notFound.slice(0, 20).join(', ')}${result.notFound.length > 20 ? ' …' : ''}` : ''}.</p>
            )}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Differences between the sheet and the system</h3>
          <Button size="sm" onClick={exportDiff} disabled={!diff.data || diff.data.length === 0}><Download className="h-4 w-4" aria-hidden /> Export</Button>
        </div>
        {diff.loading ? <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
          : diff.error ? <p role="alert" className="mt-3 text-sm text-danger">{diff.error}</p>
          : !diff.data || diff.data.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No differences — the sheet agrees with the system.</p>
          : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground">{['Line', 'Territory', 'Box in sheet', 'Box in system', 'Issue'].map((h) => <th key={h} className="py-1.5 pr-4 font-medium">{h}</th>)}</tr></thead>
                <tbody>{diff.data.map((d, i) => (
                  <tr key={i} className="border-b last:border-0"><td className="py-1.5 pr-4">{d.line}</td><td className="py-1.5 pr-4">{d.territory}</td><td className="py-1.5 pr-4">{d.box_in_sheet}</td><td className="py-1.5 pr-4">{d.box_in_system}</td><td className="py-1.5 pr-4 text-warning">{d.issue}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
      </Card>
    </div>
  )
}
