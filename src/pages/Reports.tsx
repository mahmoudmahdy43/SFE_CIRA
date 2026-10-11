import { useState } from 'react'
import { PageHeader } from '../components/app/states'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/overlay'
import { useMonth } from '../context/MonthContext'
import { fetchLineNames } from '../lib/api/reports'
import { useAsync } from '../features/dashboard/useAsync'
import { CallRateTab } from '../features/reports/CallRateTab'
import { CoverageTab } from '../features/reports/CoverageTab'
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
        description={`Coverage and call-rate reports for ${month.slice(0, 7)} — read straight from the database views; change the month in the top bar.`}
      />
      <Tabs defaultValue="coverage">
        <TabsList className="mb-4">
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
          <TabsTrigger value="call-rate">Call Rate</TabsTrigger>
        </TabsList>
        <TabsContent value="coverage"><CoverageTab {...shared} /></TabsContent>
        <TabsContent value="call-rate"><CallRateTab {...shared} /></TabsContent>
      </Tabs>
    </div>
  )
}
