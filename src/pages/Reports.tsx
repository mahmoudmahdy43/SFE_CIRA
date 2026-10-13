import { useState } from 'react'
import { PageHeader } from '../components/app/states'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/overlay'
import { useMonth } from '../context/MonthContext'
import { fetchLineNames } from '../lib/api/reports'
import { useAsync } from '../features/dashboard/useAsync'
import { CallRateTab } from '../features/reports/CallRateTab'
import { CoverageTab } from '../features/reports/CoverageTab'
import { LeavesTab, MissingTab } from '../features/reports/AbsenceTab'
import { KpiRepTab } from '../features/reports/KpiRepTab'
import type { ReportFilters } from '../features/reports/reportMath'

export default function Reports() {
  const { month } = useMonth()
  const [filters, setFilters] = useState<ReportFilters>({ lineId: null, manager: '', search: '' })
  const lines = useAsync('lines:names', fetchLineNames)
  const shared = { month, lines: lines.data ?? [], filters, onFilters: setFilters }

  return (
    <div>
      <PageHeader
        title="Reports"
        description={`Coverage, call-rate, KPI, leave and missing-day reports for ${month.slice(0, 7)} — read straight from the database views; change the month in the top bar (Leaves and Missing Days also have their own From / To months).`}
      />
      <Tabs defaultValue="coverage">
        <TabsList className="mb-4">
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
          <TabsTrigger value="call-rate">Call Rate</TabsTrigger>
          <TabsTrigger value="kpi-rep">KPI by Rep</TabsTrigger>
          <TabsTrigger value="leaves">Leaves</TabsTrigger>
          <TabsTrigger value="missing">Missing Days</TabsTrigger>
        </TabsList>
        <TabsContent value="coverage"><CoverageTab {...shared} /></TabsContent>
        <TabsContent value="call-rate"><CallRateTab {...shared} /></TabsContent>
        <TabsContent value="kpi-rep"><KpiRepTab {...shared} /></TabsContent>
        <TabsContent value="leaves"><LeavesTab {...shared} /></TabsContent>
        <TabsContent value="missing"><MissingTab {...shared} /></TabsContent>
      </Tabs>
    </div>
  )
}
