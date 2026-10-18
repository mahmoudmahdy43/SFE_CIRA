import { PageHeader, ErrorState } from '../components/app/states'
import { Skeleton } from '../components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/overlay'
import { useOrg } from '../lib/api/org'
import AliasesTab from './org/AliasesTab'
import BoxesTab from './org/BoxesTab'
import ImportTab from './org/ImportTab'
import TerritoriesTab from './org/TerritoriesTab'
import TerritoryBoxTab from './org/TerritoryBoxTab'

export default function Org() {
  const { org, error, loading, reload } = useOrg()
  const refetch = () => void reload()
  return (
    <div>
      <PageHeader title="Org & Territories" description="Boxes, territories and aliases. Use Import for the one-time initial load." />
      <Tabs defaultValue="boxes">
        <TabsList>
          <TabsTrigger value="boxes">Boxes</TabsTrigger>
          <TabsTrigger value="territories">Territories</TabsTrigger>
          <TabsTrigger value="aliases">Aliases</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="terrbox">Territory → Box</TabsTrigger>
        </TabsList>
        <div className="mt-4">
          {error ? (
            <ErrorState message={error} onRetry={refetch} />
          ) : !org ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-10" />
              <Skeleton className="h-64" />
            </div>
          ) : (
            <>
              <TabsContent value="boxes"><BoxesTab org={org} reload={refetch} /></TabsContent>
              <TabsContent value="territories"><TerritoriesTab org={org} reload={refetch} /></TabsContent>
              <TabsContent value="aliases"><AliasesTab org={org} /></TabsContent>
              <TabsContent value="import" forceMount hidden={false} className="data-[state=inactive]:hidden"><ImportTab onImported={refetch} /></TabsContent>
              <TabsContent value="terrbox"><TerritoryBoxTab /></TabsContent>
            </>
          )}
          {loading && org && <span className="sr-only" role="status">Refreshing…</span>}
        </div>
      </Tabs>
    </div>
  )
}
