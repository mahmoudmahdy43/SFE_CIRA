import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ErrorBoundary } from '../components/app/ErrorBoundary'
import { PageHeader } from '../components/app/states'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/overlay'
import { useDateRange } from '../context/DateRangeContext'
import { PeriodBanner } from '../components/app/PeriodBanner'
import { periodLabel } from '../lib/dateRange'
import { fetchLineNames } from '../lib/api/reports'
import { useAsync } from '../features/dashboard/useAsync'
import { SpecialityRoiTab } from '../features/roi/SpecialityRoiTab'
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
import { SalesByEmployeeTab } from '../features/reports/SalesByEmployeeTab'
import { SuspiciousTab } from '../features/reports/SuspiciousTab'
import { useAuth } from '../context/AuthContext'
import type { ReportFilters } from '../features/reports/reportMath'

export default function Reports() {
  const { month, from, to, isFullMonth } = useDateRange()
  const { role } = useAuth()
  const [params] = useSearchParams()
  const [tab, setTab] = useState(params.get('tab') === 'suspicious' && role === 'admin' ? 'suspicious' : 'employee-performance')
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
      <Tabs value={tab} onValueChange={setTab}>
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
          {role === 'admin' && <TabsTrigger value="sales-by-employee">Sales by Employee</TabsTrigger>}
          <TabsTrigger value="speciality-roi">Speciality ROI</TabsTrigger>
          {role === 'admin' && <TabsTrigger value="suspicious">Suspicious Cases</TabsTrigger>}
        </TabsList>
        <TabsContent value="employee-performance"><ErrorBoundary label="employee-performance report" resetKey={tab}><PeriodBanner className="mb-3" /><EmployeePerformanceTab {...shared} /></ErrorBoundary></TabsContent>
        <TabsContent value="call-rate"><ErrorBoundary label="call-rate report" resetKey={tab}><PeriodBanner monthly className="mb-3" /><CallRateTab {...shared} /></ErrorBoundary></TabsContent>
        <TabsContent value="kpi-rep"><ErrorBoundary label="kpi-rep report" resetKey={tab}><KpiRepTab {...shared} /></ErrorBoundary></TabsContent>
        <TabsContent value="leaves"><ErrorBoundary label="leaves report" resetKey={tab}><LeavesTab {...shared} /></ErrorBoundary></TabsContent>
        <TabsContent value="missing"><ErrorBoundary label="missing report" resetKey={tab}><MissingTab {...shared} /></ErrorBoundary></TabsContent>
        <TabsContent value="managers"><ErrorBoundary label="managers report" resetKey={tab}><PeriodBanner className="mb-3" /><ManagersTab {...shared} /></ErrorBoundary></TabsContent>
        <TabsContent value="capacity"><ErrorBoundary label="capacity report" resetKey={tab}><PeriodBanner monthly className="mb-3" /><CapacityTab {...shared} /></ErrorBoundary></TabsContent>
        <TabsContent value="speciality-mix"><ErrorBoundary label="speciality-mix report" resetKey={tab}><PeriodBanner monthly className="mb-3" /><SpecialityMixTab {...shared} /></ErrorBoundary></TabsContent>
        <TabsContent value="joint-days"><ErrorBoundary label="joint-days report" resetKey={tab}><JointDaysTab {...shared} /></ErrorBoundary></TabsContent>
        <TabsContent value="manager-coverage"><ErrorBoundary label="manager-coverage report" resetKey={tab}><PeriodBanner monthly own className="mb-3" /><ManagerCoverageTab {...shared} /></ErrorBoundary></TabsContent>
        <TabsContent value="coaching"><ErrorBoundary label="coaching report" resetKey={tab}><PeriodBanner monthly own className="mb-3" /><CoachingTab {...shared} /></ErrorBoundary></TabsContent>
        <TabsContent value="sales"><ErrorBoundary label="sales report" resetKey={tab}><SalesTab {...shared} /></ErrorBoundary></TabsContent>
        {role === 'admin' && <TabsContent value="sales-by-employee"><ErrorBoundary label="sales-by-employee report" resetKey={tab}><SalesByEmployeeTab lines={lines.data ?? []} /></ErrorBoundary></TabsContent>}
        <TabsContent value="speciality-roi"><ErrorBoundary label="speciality-roi report" resetKey={tab}><SpecialityRoiTab /></ErrorBoundary></TabsContent>
        {role === 'admin' && <TabsContent value="suspicious"><ErrorBoundary label="suspicious-cases report" resetKey={tab}><SuspiciousTab /></ErrorBoundary></TabsContent>}
      </Tabs>
    </div>
  )
}
