import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import { Badge, Card, Skeleton } from '../../components/ui/misc'
import { EmptyState, ErrorState } from '../../components/app/states'
import type { AsyncState } from '../dashboard/useAsync'
import { cn } from '../../lib/utils'

/** A card whose body follows an async state: skeleton while loading, error with retry, empty state, or the content. */
export function Section<T>({
  title, description, state, isEmpty, emptyTitle = 'Nothing to show', emptyText, actions, className, children,
}: {
  title: string
  description?: string
  state: AsyncState<T>
  isEmpty?: (d: T) => boolean
  emptyTitle?: string
  emptyText?: string
  actions?: ReactNode
  className?: string
  children: (d: T) => ReactNode
}) {
  const { data, error, loading, reload } = state
  const empty = data !== null && (data === undefined || (Array.isArray(data) ? data.length === 0 : false) || (isEmpty ? isEmpty(data) : false))
  return (
    <Card className={cn('p-5', className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {error ? (
        <ErrorState message={error} onRetry={reload} className="py-8" />
      ) : loading || data === null ? (
        <div className="space-y-2" aria-busy="true" aria-label={`Loading ${title}`}>
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : empty ? (
        <EmptyState icon={Inbox} title={emptyTitle} description={emptyText} className="py-8" />
      ) : (
        children(data)
      )}
    </Card>
  )
}

export interface Col<T> { h: string; cell: (r: T) => ReactNode; right?: boolean; className?: string }

/** Small read-only table with sticky header inside a scroll box. */
export function SimpleTable<T>({ cols, rows, rowKey, maxHeight = 420 }: { cols: Col<T>[]; rows: T[]; rowKey: (r: T, i: number) => string | number; maxHeight?: number }) {
  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b text-xs text-muted-foreground">
            {cols.map((c) => <th key={c.h} scope="col" className={cn('px-2 py-1.5 font-medium', c.right ? 'text-right' : 'text-left')}>{c.h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className="border-b last:border-0">
              {cols.map((c) => <td key={c.h} className={cn('px-2 py-1.5', c.right && 'tnum text-right', c.className)}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Generic table for rows whose columns are not fixed (views that this repo does not define). Id-like columns are hidden. */
export function RawTable({ rows, maxHeight = 420 }: { rows: Record<string, unknown>[]; maxHeight?: number }) {
  const keys = Object.keys(rows[0] ?? {}).filter((k) => !/(^|_)id$/.test(k))
  const cell = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(2)) : typeof v === 'object' ? JSON.stringify(v) : String(v).replace(/T00:00:00.*$/, ''))
  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card"><tr className="border-b text-xs text-muted-foreground">{keys.map((k) => <th key={k} className="px-2 py-1.5 text-left font-medium">{k.replace(/_/g, ' ')}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b last:border-0">{keys.map((k) => <td key={k} className="tnum px-2 py-1.5">{cell(r[k])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{children ?? '—'}</dd>
    </div>
  )
}

export const VacantPill = ({ what = 'Vacant' }: { what?: string }) => <Badge tone="warning">{what}</Badge>

export function ProfileHeader({ name, code, role, line, status, children }: { name: string; code?: string | null; role: string; line?: string | null; status?: ReactNode; children?: ReactNode }) {
  return (
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{name}</h2>
        {code && <span className="tnum text-sm text-muted-foreground">{code}</span>}
        <Badge tone="neutral">{role}</Badge>
        {line && <Badge tone="neutral">{line}</Badge>}
        {status}
      </div>
      {children && <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">{children}</dl>}
    </Card>
  )
}
