import { useState } from 'react'
import { PageHeader } from '../components/app/states'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/overlay'
import { useMonth } from '../context/MonthContext'
import { fetchLineNames } from '../lib/api/reports'
import { useAsync } from '../features/dashboard/useAsync'
import { CallRateTab } from '../features/reports/CallRateTab'
import { CoverageTab } from '../features/reports/CoverageTab'
import { LeavesTab, MissingTab } from '../features/reports/AbsenceTab'
import { ManagersTab } from '../features/reports/ManagersTab'
import { KpiRepTab } from '../features/reports/KpiRepTab'
import { CapacityTab } from '../features/reports/CapacityTab'
import { SpecialityMixTab } from '../features/reports/SpecialityMixTab'
import { JointDaysTab } from '../features/reports/JointDaysTab'
import { ManagerCoverageTab } from '../features/reports/ManagerCoverageTab'
import { CoachingTab } from '../features/reports/CoachingTab'
import type { ReportFilters } from '../features/reports/reportMath'

export default function Reports() {
  const { month } = useMonth()
  const [filters, setFilters] = useState<ReportFilters>({ lineId: null, manager: '', search: '' })
  const lines = useAsync('lines:names', fetchLineNames)
  const shared = { month, lines: lines.data ?? [], filters, onFilters: setFilters }

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Reports"
          description={`Coverage, call-rate, KPI, leave, missing-day, visits-capacity, speciality-mix, manager-joint-days, manager-coverage and coaching reports for ${month.slice(0, 7)} — read straight from the database views; change the month in the top bar (Leaves and Missing Days also have their own From / To months).`}
        />
      </div>
      <Tabs defaultValue="coverage">
        <TabsList className="mb-4 print:hidden">
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
          <TabsTrigger value="call-rate">Call Rate</TabsTrigger>
          <TabsTrigger value="kpi-rep">KPI by Rep</TabsTrigger>
          <TabsTrigger value="leaves">Leaves</TabsTrigger>
          <TabsTrigger value="missing">Missing Days</TabsTrigger>
          <TabsTrigger value="managers">Managers</TabsTrigger>
          <TabsTrigger value="capacity">Visits Capacity</TabsTrigger>
          <TabsTrigger value="speciality-mix">Speciality Mix</TabsTrigger>
          <TabsTrigger value="joint-days">Manager Joint Days</TabsTrigger>
          <TabsTrigger value="manager-coverage">Manager Coverage</TabsTrigger>
          <TabsTrigger value="coaching">Coaching</TabsTrigger>
        </TabsList>
        <TabsContent value="coverage"><CoverageTab {...shared} /></TabsContent>
        <TabsContent value="call-rate"><CallRateTab {...shared} /></TabsContent>
        <TabsContent value="kpi-rep"><KpiRepTab {...shared} /></TabsContent>
        <TabsContent value="leaves"><LeavesTab {...shared} /></TabsContent>
        <TabsContent value="missing"><MissingTab {...shared} /></TabsContent>
        <TabsContent value="managers"><ManagersTab {...shared} /></TabsContent>
        <TabsContent value="capacity"><CapacityTab {...shared} /></TabsContent>
        <TabsContent value="speciality-mix"><SpecialityMixTab {...shared} /></TabsContent>
        <TabsContent value="joint-days"><JointDaysTab {...shared} /></TabsContent>
        <TabsContent value="manager-coverage"><ManagerCoverageTab {...shared} /></TabsContent>
        <TabsContent value="coaching"><CoachingTab {...shared} /></TabsContent>
      </Tabs>
    </div>
  )
}
