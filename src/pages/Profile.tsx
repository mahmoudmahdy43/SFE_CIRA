import { ArrowLeft } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader, ErrorState } from '../components/app/states'
import { Skeleton } from '../components/ui/misc'
import { useAuth } from '../context/AuthContext'
import { useDateRange } from '../context/DateRangeContext'
import { periodLabel } from '../lib/dateRange'
import { useOrg } from '../lib/api/org'
import { BoxProfile } from '../features/profile/BoxProfile'
import { ManagerProfile } from '../features/profile/ManagerProfile'
import { parseProfileParams } from '../features/profile/profileLinks'
import { RepProfile } from '../features/profile/RepProfile'
import { SearchView } from '../features/profile/SearchView'
import { StaffProfile } from '../features/profile/StaffProfile'

/** 360° View: `/360` = search, `/360?type=rep|manager|staff|box&id=N` = profile. Admin only (the whole app is). */
export default function Profile() {
  const { role } = useAuth()
  const { month, from, to, isFullMonth } = useDateRange()
  const [params] = useSearchParams()
  const target = parseProfileParams(`?${params.toString()}`)
  const { org, error, reload } = useOrg()
  if (role !== 'admin') return <ErrorState title="Admins only" message="The 360° view is available to administrators." />
  return (
    <div>
      <PageHeader
        title="360° View"
        description={target ? `Profile for ${isFullMonth ? month.slice(0, 7) : periodLabel(from, to)} (change the period in the top bar). ${isFullMonth ? '' : 'A rep\'s KPIs and day calendar follow the day range; every other tab is monthly (marked) and shows ' + month.slice(0, 7) + '. '}Trends cover all months of ${month.slice(0, 4)}.` : 'Full profile of a rep, a manager, a staff member or a box.'}
        actions={target ? <Link to="/360" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> New search</Link> : undefined}
      />
      {!target ? (
        <SearchView />
      ) : target.type === 'staff' ? (
        <StaffProfile id={target.id} month={month} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : !org ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading profile"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>
      ) : target.type === 'rep' ? (
        <RepProfile key={`r${target.id}`} id={target.id} month={month} org={org} />
      ) : target.type === 'manager' ? (
        <ManagerProfile key={`m${target.id}`} id={target.id} month={month} org={org} />
      ) : (
        <BoxProfile key={`b${target.id}`} id={target.id} month={month} org={org} />
      )}
    </div>
  )
}
