import { PageHeader, ErrorState } from '../components/app/states'
import { Skeleton } from '../components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/overlay'
import { useOrg } from '../lib/api/org'
import HistoryTab from './personnel/HistoryTab'
import ManagersTab from './personnel/ManagersTab'
import NsmsTab from './personnel/NsmsTab'
import RepsTab from './personnel/RepsTab'
import VacanciesTab from './personnel/VacanciesTab'

export default function Personnel() {
  const { org, error, reload } = useOrg()
  const refetch = () => void reload()
  return (
    <div>
      <PageHeader title="Personnel" description="Hire, resign and transfer reps; manage managers and NSMs. Every change rebuilds the org and KPIs." />
      <Tabs defaultValue="reps">
        <TabsList>
          <TabsTrigger value="reps">Reps</TabsTrigger>
          <TabsTrigger value="managers">Managers</TabsTrigger>
          <TabsTrigger value="nsms">NSMs</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="vacancies">Vacancies</TabsTrigger>
        </TabsList>
        <div className="mt-4">
          <TabsContent value="history"><HistoryTab /></TabsContent>
          {error ? (
            <ErrorState message={error} onRetry={refetch} />
          ) : !org ? (
            <div className="space-y-3" aria-busy="true"><Skeleton className="h-10" /><Skeleton className="h-64" /></div>
          ) : (
            <>
              <TabsContent value="reps"><RepsTab org={org} reload={refetch} /></TabsContent>
              <TabsContent value="managers"><ManagersTab org={org} reload={refetch} /></TabsContent>
              <TabsContent value="nsms"><NsmsTab org={org} reload={refetch} /></TabsContent>
              <TabsContent value="vacancies"><VacanciesTab org={org} reload={refetch} /></TabsContent>
            </>
          )}
        </div>
      </Tabs>
    </div>
  )
}
