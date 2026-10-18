import { useState } from 'react'
import { ArrowLeft, FileCode2, FileSpreadsheet } from 'lucide-react'
import { Card } from '../../../components/ui/misc'
import UploadWizard from '../UploadWizard'
import { leavesConfig } from './absenceConfigs'
import RawLeavesWizard, { RAW_LEAVES_DESCRIPTION, RAW_LEAVES_LABEL } from './RawLeavesWizard'

/** Leaves upload: the existing Excel file (with CODE) or the raw CRM Vacations Report. */
export default function LeavesUploadEntry({ onExit, onViewChanges }: { onExit: () => void; onViewChanges: (m: string) => void }) {
  const [mode, setMode] = useState<'choose' | 'excel' | 'raw'>('choose')
  if (mode === 'excel') return <UploadWizard config={leavesConfig} onExit={() => setMode('choose')} onViewChanges={onViewChanges} />
  if (mode === 'raw') return <RawLeavesWizard onExit={() => setMode('choose')} />
  return (
    <div className="space-y-4">
      <button onClick={onExit} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> All upload types</button>
      <h2 className="text-base font-semibold">Upload leaves — choose the source</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <button onClick={() => setMode('excel')} className="text-left"><Card className="h-full p-5 hover:bg-muted">
          <FileSpreadsheet className="mb-2 h-5 w-5 text-muted-foreground" aria-hidden />
          <div className="text-sm font-semibold">Excel file</div>
          <p className="mt-1 text-sm text-muted-foreground">{leavesConfig.description}</p>
        </Card></button>
        <button onClick={() => setMode('raw')} className="text-left"><Card className="h-full p-5 hover:bg-muted">
          <FileCode2 className="mb-2 h-5 w-5 text-muted-foreground" aria-hidden />
          <div className="text-sm font-semibold">{RAW_LEAVES_LABEL}</div>
          <p className="mt-1 text-sm text-muted-foreground">{RAW_LEAVES_DESCRIPTION}</p>
        </Card></button>
      </div>
    </div>
  )
}
