import { useState } from 'react'
import { ArrowLeft, FileCode2, FileSpreadsheet } from 'lucide-react'
import { Card } from '../../../components/ui/misc'
import UploadWizard from '../UploadWizard'
import { officeWorkConfig } from './absenceConfigs'
import RawOfficeWorkWizard, { RAW_OFFICE_WORK_DESCRIPTION, RAW_OFFICE_WORK_LABEL } from './RawOfficeWorkWizard'

/** Office Work upload: the existing Excel file (with CODE) or the raw CRM Office Work file. */
export default function OfficeWorkUploadEntry({ onExit, onViewChanges }: { onExit: () => void; onViewChanges: (m: string) => void }) {
  const [mode, setMode] = useState<'choose' | 'excel' | 'raw'>('choose')
  if (mode === 'excel') return <UploadWizard config={officeWorkConfig} onExit={() => setMode('choose')} onViewChanges={onViewChanges} />
  if (mode === 'raw') return <RawOfficeWorkWizard onExit={() => setMode('choose')} />
  return (
    <div className="space-y-4">
      <button onClick={onExit} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> All upload types</button>
      <h2 className="text-base font-semibold">Upload office work — choose the source</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <button onClick={() => setMode('excel')} className="text-left"><Card className="h-full p-5 hover:bg-muted">
          <FileSpreadsheet className="mb-2 h-5 w-5 text-muted-foreground" aria-hidden />
          <div className="text-sm font-semibold">Excel file</div>
          <p className="mt-1 text-sm text-muted-foreground">{officeWorkConfig.description}</p>
        </Card></button>
        <button onClick={() => setMode('raw')} className="text-left"><Card className="h-full p-5 hover:bg-muted">
          <FileCode2 className="mb-2 h-5 w-5 text-muted-foreground" aria-hidden />
          <div className="text-sm font-semibold">{RAW_OFFICE_WORK_LABEL}</div>
          <p className="mt-1 text-sm text-muted-foreground">{RAW_OFFICE_WORK_DESCRIPTION}</p>
        </Card></button>
      </div>
    </div>
  )
}
