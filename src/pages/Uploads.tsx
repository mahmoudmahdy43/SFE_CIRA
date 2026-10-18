import { useState } from 'react'
import { DollarSign } from 'lucide-react'
import { PageHeader } from '../components/app/states'
import { Badge, Card } from '../components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/overlay'
import UploadWizard from '../features/uploads/UploadWizard'
import { listConfig } from '../features/uploads/list/listConfig'
import { visitsConfig } from '../features/uploads/visits/visitsConfig'
import ActivitiesUploadEntry from '../features/uploads/absence/ActivitiesUploadEntry'
import LeavesUploadEntry from '../features/uploads/absence/LeavesUploadEntry'
import VisitsUploadEntry from '../features/uploads/visits/VisitsUploadEntry'
import { coachingConfig } from '../features/uploads/coaching/coachingConfig'
import SalesUploadWizard, { SALES_DESCRIPTION, SALES_LABEL } from '../features/uploads/sales/SalesUploadWizard'
import { activitiesConfig, leavesConfig, officeWorkConfig } from '../features/uploads/absence/absenceConfigs'
import HistoryTab from './uploads/HistoryTab'
import MonthsTab from './uploads/MonthsTab'

type Key = 'list' | 'visits' | 'leaves' | 'office_work' | 'activities' | 'coaching' | 'sales'

const AVAILABLE: { key: Key; label: string; description: string; icon: typeof DollarSign }[] = [
  { key: 'list', ...listConfig },
  { key: 'visits', ...visitsConfig },
  { key: 'leaves', ...leavesConfig },
  { key: 'office_work', ...officeWorkConfig },
  { key: 'activities', ...activitiesConfig },
  { key: 'coaching', ...coachingConfig },
  { key: 'sales', label: SALES_LABEL, description: SALES_DESCRIPTION, icon: DollarSign },
]

const SOON: { label: string; description: string; icon: typeof DollarSign }[] = []

export default function Uploads() {
  const [tab, setTab] = useState('upload')
  const [wizard, setWizard] = useState<Key | null>(null)
  const [month, setMonth] = useState<string | null>(null)
  const exit = () => setWizard(null)
  const noop = () => undefined

  return (
    <div>
      <PageHeader title="Uploads" description="Load Excel exports, review upload history and see what is loaded per month." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="months">Months &amp; changes</TabsTrigger>
        </TabsList>
        <div className="mt-4">
          <TabsContent value="upload">
            {wizard === 'list' ? (
              <UploadWizard config={listConfig} onExit={exit} onViewChanges={(m) => { setMonth(m); setTab('months') }} />
            ) : wizard === 'visits' ? (
              <VisitsUploadEntry onExit={exit} onViewChanges={noop} />
            ) : wizard === 'leaves' ? (
              <LeavesUploadEntry onExit={exit} onViewChanges={noop} />
            ) : wizard === 'office_work' ? (
              <UploadWizard config={officeWorkConfig} onExit={exit} onViewChanges={noop} />
            ) : wizard === 'activities' ? (
              <ActivitiesUploadEntry onExit={exit} onViewChanges={noop} />
            ) : wizard === 'coaching' ? (
              <UploadWizard config={coachingConfig} onExit={exit} onViewChanges={noop} />
            ) : wizard === 'sales' ? (
              <SalesUploadWizard onExit={exit} />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {AVAILABLE.map((c) => (
                  <button key={c.key} onClick={() => setWizard(c.key)} className="rounded-card border bg-card p-5 text-left transition-colors hover:bg-muted">
                    <div className="flex items-center justify-between">
                      <span className="flex h-9 w-9 items-center justify-center rounded-control bg-accent text-accent-foreground"><c.icon className="h-4 w-4" aria-hidden /></span>
                      <Badge tone="success">Available</Badge>
                    </div>
                    <h2 className="mt-3 text-sm font-semibold">{c.label}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
                  </button>
                ))}
                {SOON.map((s) => (
                  <Card key={s.label} className="p-5 opacity-70" aria-disabled="true">
                    <div className="flex items-center justify-between">
                      <span className="flex h-9 w-9 items-center justify-center rounded-control bg-muted text-muted-foreground"><s.icon className="h-4 w-4" aria-hidden /></span>
                      <Badge>Coming soon</Badge>
                    </div>
                    <h2 className="mt-3 text-sm font-semibold">{s.label}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="history"><HistoryTab /></TabsContent>
          <TabsContent value="months"><MonthsTab selected={month} onSelect={setMonth} /></TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
