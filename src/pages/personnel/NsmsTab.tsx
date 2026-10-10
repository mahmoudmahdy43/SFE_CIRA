import { useState } from 'react'
import { UserCog } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Avatar, Card, StatusPill } from '../../components/ui/misc'
import { ChangeNsmDialog } from '../../components/app/PersonnelActions'
import type { OrgView } from '../../lib/api/org'

export default function NsmsTab({ org, reload }: { org: OrgView; reload: () => void }) {
  const [line, setLine] = useState<number | null>(null)
  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        {org.lines.map((l) => {
          const nsm = org.nsmOfLine.get(l.id)
          return (
            <Card key={l.id} className="p-5">
              <div className="text-xs font-medium text-muted-foreground">{l.name}</div>
              <div className="mt-3 flex items-center gap-3">
                {nsm ? <Avatar text={nsm.name} className="h-10 w-10 text-sm" /> : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><UserCog className="h-4 w-4" aria-hidden /></span>}
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{nsm?.name ?? 'No NSM'}</div>
                  {!nsm && <StatusPill status="Vacant" />}
                </div>
              </div>
              <Button className="mt-4 w-full" onClick={() => setLine(l.id)}>Change NSM</Button>
            </Card>
          )
        })}
      </div>
      {line !== null && <ChangeNsmDialog org={org} lineId={line} open onOpenChange={() => setLine(null)} onDone={reload} />}
    </>
  )
}
