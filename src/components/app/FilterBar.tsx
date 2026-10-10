import { Combobox, type Option } from '../ui/combobox'
import { MonthPicker } from './MonthPicker'

export interface FilterState {
  line: string | null
  manager: string | null
  box: string | null
}

/** Month + line / manager / box filters. Option lists are supplied by the caller (each may include a "Vacant" entry). */
export function FilterBar({
  value,
  onChange,
  lines,
  managers,
  boxes,
}: {
  value: FilterState
  onChange: (v: FilterState) => void
  lines: Option[]
  managers: Option[]
  boxes: Option[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
      <MonthPicker />
      <Combobox label="Line" placeholder="All lines" options={lines} value={value.line} onChange={(line) => onChange({ ...value, line })} />
      <Combobox label="Manager" placeholder="All managers" options={managers} value={value.manager} onChange={(manager) => onChange({ ...value, manager })} />
      <Combobox label="Box" placeholder="All boxes" options={boxes} value={value.box} onChange={(box) => onChange({ ...value, box })} />
    </div>
  )
}
