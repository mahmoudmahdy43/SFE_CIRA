import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { profileHref, type ProfileKind } from '../../features/profile/profileLinks'
import { cn } from '../../lib/utils'

/**
 * A rep / manager / box / staff name that opens its 360° profile. Without an id (vacant, unknown) the children are
 * rendered unchanged, so the cell behaves exactly as before. Clicks do not bubble (rows can have their own click action).
 */
export function ProfileLink({ type, id, children, className }: { type: ProfileKind; id: number | string | null | undefined; children: ReactNode; className?: string }) {
  if (id === null || id === undefined || id === '' || id === 0) return <>{children}</>
  return (
    <Link
      to={profileHref(type, id)}
      onClick={(e) => e.stopPropagation()}
      className={cn('rounded-sm underline-offset-2 hover:text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring', className)}
    >
      {children}
    </Link>
  )
}
