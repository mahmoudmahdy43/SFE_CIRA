import { useState } from 'react'
import { Clock, Coffee, DollarSign, Plane, Stethoscope, type LucideIcon } from 'lucide-react'
import { PageHeader } from '../components/app/states'
import { Badge, Card } from '../components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/overlay'
import UploadWizard from '../features/uploads/UploadWizard'
import { listConfig } from '../features/uploads/list/listConfig'
import HistoryTab from './uploads/HistoryTab'
import MonthsTab from './uploads/MonthsTab'

const SOON: { label: string; description: string; icon: LucideIcon }[] = [
  { label: 'Visits', description: 'Daily visit log per rep and manager. Matched to doctors by name and account.', icon: Stethoscope },
  { label: 'Sales', description: 'Territory-level actual vs target units and value, rolled up through the org.', icon: DollarSign },
  { label: 'Leaves', description: 'Approved leave ranges per person and shift.', icon: Plane },
  { label: 'Office Work', description: 'Office-work days per person and shift.', icon: Coffee },
  { label: 'Activities', description: 'Meetings and activities with time, per person and shift.', icon: Clock },
]

export default function Uploads() {
  const [tab, setTab] = useState('upload')
  const [wizard, setWizard] = useState(false)
  const [month, setMonth] = useState<string | null>(null)

  return (
    <div>
      <PageHeader title="Uploads" description="Load Excel exports, review upload history and see month-to-month list changes." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="months">Months &amp; changes</TabsTrigger>
        </TabsList>
        <div className="mt-4">
          <TabsContent value="upload">
            {wizard ? (
              <UploadWizard
                config={listConfig}
                onExit={() => setWizard(false)}
                onViewChanges={(m) => { setMonth(m); setTab('months') }}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <button onClick={() => setWizard(true)} className="rounded-card border bg-card p-5 text-left transition-colors hover:bg-muted">
                  <div className="flex items-center justify-between">
                    <span className="flex h-9 w-9 items-center justify-center rounded-control bg-accent text-accent-foreground"><listConfig.icon className="h-4 w-4" aria-hidden /></span>
                    <Badge tone="success">Available</Badge>
                  </div>
                  <h2 className="mt-3 text-sm font-semibold">{listConfig.label}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{listConfig.description}</p>
                </button>
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
