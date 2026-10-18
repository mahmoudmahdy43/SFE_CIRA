import * as XLSX from 'xlsx'
import { Download } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Badge, Card } from '../../../components/ui/misc'
import { cn } from '../../../lib/utils'
import { noSpecialityExport } from './listJoin.ts'
import type { CrmInfo } from './listSheet.ts'

function downloadNoSpeciality(info: CrmInfo): void {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(noSpecialityExport(info.noSpecRows)), 'No speciality')
  XLSX.writeFile(wb, 'rows-without-speciality.xlsx')
}

/** Preview section for the CRM exports: which files were recognised and how well the Speciality join matched. */
export default function ListFilesPanel({ info }: { info: CrmInfo }) {
  const total = info.noSpecRows.length
  return (
    <Card className="p-5">
      <h3 className="mb-3 text-sm font-semibold">Files recognised</h3>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">File</th><th className="py-1.5 font-medium">Type</th><th className="py-1.5 font-medium">Line</th><th className="py-1.5 text-right font-medium">Rows in file</th><th className="py-1.5 text-right font-medium">Matching nothing in the main list</th></tr></thead>
        <tbody>
          {info.files.map((f) => (
            <tr key={`${f.kind}|${f.name}`} className="border-b last:border-0">
              <td className="py-1.5 pr-4">{f.name}</td>
              <td className="py-1.5 pr-4">{f.kind === 'main' ? <Badge tone="info">Main list</Badge> : <Badge tone="accent">Speciality</Badge>}</td>
              <td className="py-1.5 pr-4">{f.line ?? '—'}</td>
              <td className="tnum py-1.5 text-right">{f.rows.toLocaleString()}</td>
              <td className={cn('tnum py-1.5 text-right', (f.unmatched ?? 0) > 0 && 'text-warning')}>{f.kind === 'speciality' ? (f.unmatched ?? 0).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="mb-3 mt-6 text-sm font-semibold">Rows per line</h3>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Line</th><th className="py-1.5 text-right font-medium">Rows</th><th className="py-1.5 text-right font-medium">Without Speciality</th><th className="py-1.5 text-right font-medium">No match in the Speciality file</th></tr></thead>
        <tbody>
          {info.lines.map((l) => (
            <tr key={l.line} className="border-b last:border-0">
              <td className="py-1.5">{l.line}</td>
              <td className="tnum py-1.5 text-right">{l.rows.toLocaleString()}</td>
              <td className={cn('tnum py-1.5 text-right', l.noSpeciality > 0 && 'font-medium text-warning')}>{l.noSpeciality.toLocaleString()}</td>
              <td className="tnum py-1.5 text-right">{info.specFiles > 0 ? l.noMatch.toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
        <p className="text-muted-foreground">
          {info.specFiles > 0
            ? <>Speciality rows matching nothing in the main list: <b className="tnum">{info.specNoMatch.toLocaleString()}</b> · main-list rows with no match in the Speciality file: <b className="tnum">{info.mainNoMatch.toLocaleString()}</b></>
            : 'No Speciality file was dropped.'}
        </p>
        {total > 0 && (
          <Button size="sm" onClick={() => downloadNoSpeciality(info)}>
            <Download className="h-4 w-4" aria-hidden /> Download list ({total.toLocaleString()} without Speciality)
          </Button>
        )}
      </div>
    </Card>
  )
}
