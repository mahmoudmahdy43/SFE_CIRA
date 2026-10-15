import { Columns3, Download, FileSpreadsheet, Search } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/misc'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/overlay'
import { cn } from '../../lib/utils'
import type { ReportFilters } from './reportMath'

interface Props {
  lines: { id: number; name: string }[]
  filters: ReportFilters
  onFilters: (f: ReportFilters) => void
  managers: string[]
  /** Toggleable column groups. */
  columns: { id: string; label: string }[]
  hidden: Set<string>
  onToggleColumn: (id: string) => void
  canExport: boolean
  onXlsx: () => void
  onCsv: () => void
  /** Tab-specific controls (view mode, missing-days toggle). */
  children?: React.ReactNode
  /** Replaces the Direct manager dropdown (Managers tab: Role). */
  roleSelect?: React.ReactNode
  searchLabel?: string
  searchPlaceholder?: string
}

export function ReportToolbar({ lines, filters, onFilters, managers, columns, hidden, onToggleColumn, canExport, onXlsx, onCsv, children, roleSelect, searchLabel, searchPlaceholder }: Props) {
  const chips = [{ id: null as number | null, name: 'All' }, ...lines]
  return (
    <div className="space-y-3">
      <div role="group" aria-label="Line filter" className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c.name}
            aria-pressed={filters.lineId === c.id}
            onClick={() => onFilters({ ...filters, lineId: c.id, manager: '' })}
            className={cn('rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted', filters.lineId === c.id && 'border-primary bg-accent font-medium text-accent-foreground')}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {roleSelect ?? (
          <select
            aria-label="Direct manager"
            value={filters.manager}
            onChange={(e) => onFilters({ ...filters, manager: e.target.value })}
            className="h-9 max-w-[14rem] rounded-control border bg-card px-2 text-sm"
          >
            <option value="">All managers</option>
            {managers.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input aria-label={searchLabel ?? 'Search rep, code or box'} placeholder={searchPlaceholder ?? 'Rep, code or box…'} value={filters.search} onChange={(e) => onFilters({ ...filters, search: e.target.value })} className="pl-8" />
        </div>
        {children}
        <div className="ml-auto flex items-center gap-2">
          {columns.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" aria-label="Choose columns"><Columns3 className="h-4 w-4" /> Columns</Button>
            </PopoverTrigger>
            <PopoverContent className="w-52">
              {columns.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <input type="checkbox" checked={!hidden.has(c.id)} onChange={() => onToggleColumn(c.id)} />
                  {c.label}
                </label>
              ))}
            </PopoverContent>
          </Popover>
          )}
          <Button size="sm" onClick={onXlsx} disabled={!canExport}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
          <Button size="sm" onClick={onCsv} disabled={!canExport}><Download className="h-4 w-4" /> CSV</Button>
        </div>
      </div>
    </div>
  )
}
