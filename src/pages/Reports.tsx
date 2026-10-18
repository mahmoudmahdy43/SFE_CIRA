import { useState } from 'react'
import { PageHeader } from '../components/app/states'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/overlay'
import { useDateRange } from '../context/DateRangeContext'
import { PeriodBanner } from '../components/app/PeriodBanner'
import { periodLabel } from '../lib/dateRange'
import { fetchLineNames } from '../lib/api/reports'
import { useAsync } from '../features/dashboard/useAsync'
import { CallRateTab } from '../features/reports/CallRateTab'
import { EmployeePerformanceTab } from '../features/reports/EmployeePerformanceTab'
import { LeavesTab, MissingTab } from '../features/reports/AbsenceTab'
import { ManagersTab } from '../features/reports/ManagersTab'
import { KpiRepTab } from '../features/reports/KpiRepTab'
import { CapacityTab } from '../features/reports/CapacityTab'
import { SpecialityMixTab } from '../features/reports/SpecialityMixTab'
import { JointDaysTab } from '../features/reports/JointDaysTab'
import { ManagerCoverageTab } from '../features/reports/ManagerCoverageTab'
import { CoachingTab } from '../features/reports/CoachingTab'
import { SalesTab } from '../features/reports/SalesTab'
import type { ReportFilters } from '../features/reports/reportMath'

export default function Reports() {
  const { month, from, to, isFullMonth } = useDateRange()
  const [filters, setFilters] = useState<ReportFilters>({ lineId: null, manager: '', search: '' })
  const lines = useAsync('lines:names', fetchLineNames)
  const shared = { month, lines: lines.data ?? [], filters, onFilters: setFilters }

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Reports"
          description={`Employee performance, call-rate, KPI, leave, missing-day, visits-capacity, speciality-mix, manager-joint-days, manager-coverage, coaching and sales reports for ${isFullMonth ? month.slice(0, 7) : periodLabel(from, to)} — read straight from the database; change the period in the top bar. Employee performance, KPI by Rep, Leaves, Missing Days, Managers and Joint Days (by day) follow a day range; the others are monthly and show the month of the To date.`}
        />
      </div>
      <Tabs defaultValue="employee-performance">
        <TabsList className="mb-4 print:hidden">
          <TabsTrigger value="employee-performance">Employee performance</TabsTrigger>
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
          <TabsTrigger value="sales">Sales</TabsTrigger>
        </TabsList>
        <TabsContent value="employee-performance"><PeriodBanner className="mb-3" /><EmployeePerformanceTab {...shared} /></TabsContent>
        <TabsContent value="call-rate"><PeriodBanner monthly className="mb-3" /><CallRateTab {...shared} /></TabsContent>
        <TabsContent value="kpi-rep"><KpiRepTab {...shared} /></TabsContent>
        <TabsContent value="leaves"><LeavesTab {...shared} /></TabsContent>
        <TabsContent value="missing"><MissingTab {...shared} /></TabsContent>
        <TabsContent value="managers"><PeriodBanner className="mb-3" /><ManagersTab {...shared} /></TabsContent>
        <TabsContent value="capacity"><PeriodBanner monthly className="mb-3" /><CapacityTab {...shared} /></TabsContent>
        <TabsContent value="speciality-mix"><PeriodBanner monthly className="mb-3" /><SpecialityMixTab {...shared} /></TabsContent>
        <TabsContent value="joint-days"><JointDaysTab {...shared} /></TabsContent>
        <TabsContent value="manager-coverage"><PeriodBanner monthly own className="mb-3" /><ManagerCoverageTab {...shared} /></TabsContent>
        <TabsContent value="coaching"><PeriodBanner monthly own className="mb-3" /><CoachingTab {...shared} /></TabsContent>
        <TabsContent value="sales"><SalesTab {...shared} /></TabsContent>
      </Tabs>
    </div>
  )
}
