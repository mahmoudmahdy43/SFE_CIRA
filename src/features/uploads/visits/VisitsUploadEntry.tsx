import { useState } from 'react'
import { ArrowLeft, FileCode2, FileSpreadsheet } from 'lucide-react'
import { Card } from '../../../components/ui/misc'
import UploadWizard from '../UploadWizard'
import { visitsConfig } from './visitsConfig'
import TerritoryWizard, { TERRITORY_DESCRIPTION, TERRITORY_LABEL } from './TerritoryWizard'
import RawVisitsWizard, { RAW_VISITS_DESCRIPTION, RAW_VISITS_LABEL } from './RawVisitsWizard'

/** Visits upload: the existing Excel file (CODE + Account ID + Doctor ID) or the raw CRM files. */
export default function VisitsUploadEntry({ onExit, onViewChanges }: { onExit: () => void; onViewChanges: (m: string) => void }) {
  const [mode, setMode] = useState<'choose' | 'excel' | 'raw' | 'territory'>('choose')
  if (mode === 'excel') return <UploadWizard config={visitsConfig} onExit={() => setMode('choose')} onViewChanges={onViewChanges} />
  if (mode === 'territory') return <TerritoryWizard onExit={() => setMode('choose')} />
  if (mode === 'raw') return <RawVisitsWizard onExit={() => setMode('choose')} />
  return (
    <div className="space-y-4">
      <button onClick={onExit} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> All upload types</button>
      <h2 className="text-base font-semibold">Upload visits — choose the source</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <button onClick={() => setMode('excel')} className="text-left"><Card className="h-full p-5 hover:bg-muted">
          <FileSpreadsheet className="mb-2 h-5 w-5 text-muted-foreground" aria-hidden />
          <div className="text-sm font-semibold">Excel file</div>
          <p className="mt-1 text-sm text-muted-foreground">{visitsConfig.description}</p>
        </Card></button>
        <button onClick={() => setMode('raw')} className="text-left"><Card className="h-full p-5 hover:bg-muted">
          <FileCode2 className="mb-2 h-5 w-5 text-muted-foreground" aria-hidden />
          <div className="text-sm font-semibold">{RAW_VISITS_LABEL}</div>
          <p className="mt-1 text-sm text-muted-foreground">{RAW_VISITS_DESCRIPTION}</p>
        </Card></button>
        <button onClick={() => setMode('territory')} className="text-left"><Card className="h-full p-5 hover:bg-muted">
          <FileCode2 className="mb-2 h-5 w-5 text-muted-foreground" aria-hidden />
          <div className="text-sm font-semibold">{TERRITORY_LABEL}</div>
          <p className="mt-1 text-sm text-muted-foreground">{TERRITORY_DESCRIPTION}</p>
        </Card></button>
      </div>
    </div>
  )
}
