import { Link } from 'react-router-dom'
import { Palette } from 'lucide-react'
import { PageHeader } from '../components/app/states'
import { Card } from '../components/ui/misc'
import { buttonVariants } from '../components/ui/button'
import { cn } from '../lib/utils'

export default function Settings() {
  return (
    <div>
      <PageHeader title="Settings" description="Application settings and design preview." />
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-control bg-accent text-accent-foreground">
            <Palette className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Design preview</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Every UI component with clearly labelled sample data, in light and dark.
            </p>
          </div>
        </div>
        <Link to="/design" className={cn(buttonVariants({ variant: 'primary' }))}>
          Open design preview
        </Link>
      </Card>
    </div>
  )
}
