/** Pure grouping for Personnel -> Vacancies -> "Boxes with no manager" (no DOM, unit-tested). */
import type { VacantManagerBox } from '../../lib/api/org.ts'

export interface VacantDistrict {
  key: string
  line: string
  /** Null when the box has no district. */
  district: string | null
  boxes: VacantManagerBox[]
}

export interface VacantManagerView {
  /** Districts whose manager is vacant too, boxes grouped under their district. */
  vacantDistricts: VacantDistrict[]
  /** Boxes whose district has a manager. */
  withManager: VacantManagerBox[]
  /** Number of boxes in the list — the count badge. */
  total: number
}

const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
export const isDistrictManagerVacant = (r: Pick<VacantManagerBox, 'district_manager'>) => r.district_manager === null || r.district_manager.trim() === ''
export const districtLabel = (d: string | null) => (d && d.trim() !== '' ? d : 'No district')

export function groupVacantManagerBoxes(input: VacantManagerBox[]): VacantManagerView {
  // One row per box, so the badge always equals the number of boxes shown.
  const rows = [...new Map(input.map((r) => [r.box_id, r])).values()]
  const byBox = (a: VacantManagerBox, b: VacantManagerBox) => natural(a.line_name, b.line_name) || natural(districtLabel(a.district), districtLabel(b.district)) || natural(a.box_name, b.box_name)

  const groups = new Map<string, VacantDistrict>()
  const withManager: VacantManagerBox[] = []
  for (const r of rows) {
    if (!isDistrictManagerVacant(r)) { withManager.push(r); continue }
    const key = `${r.line_name}|${r.district ?? ''}`
    const g = groups.get(key) ?? { key, line: r.line_name, district: r.district, boxes: [] }
    g.boxes.push(r)
    groups.set(key, g)
  }
  const vacantDistricts = [...groups.values()].sort((a, b) => natural(a.line, b.line) || natural(districtLabel(a.district), districtLabel(b.district)))
  for (const g of vacantDistricts) g.boxes.sort((a, b) => natural(a.box_name, b.box_name))
  return { vacantDistricts, withManager: withManager.sort(byBox), total: rows.length }
}
