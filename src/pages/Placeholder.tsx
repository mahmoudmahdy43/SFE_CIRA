import { Hourglass } from 'lucide-react'
import { PageHeader, EmptyState } from '../components/app/states'
import { Card } from '../components/ui/misc'
import type { NavItem } from '../lib/nav'

export default function Placeholder({ item }: { item: NavItem }) {
  return (
    <div>
      <PageHeader title={item.label} description={item.description} />
      <Card>
        <EmptyState
          icon={Hourglass}
          title="Coming in a later phase"
          description="This page is part of the roadmap and is not built yet."
        />
      </Card>
    </div>
  )
}
