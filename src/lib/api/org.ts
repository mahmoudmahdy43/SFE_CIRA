import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAll, rpc } from './core'
import { monthStart, todayIso } from '../norm'

export interface Line { id: number; name: string }
export interface Nsm { id: number; name: string }
export interface LineNsm { id: number; line_id: number; nsm_id: number | null; valid_from: string; valid_to: string | null }
export interface Manager { id: number; code: string | null; name: string; status: 'Active' | 'Resigned'; hire_date: string | null; resign_date: string | null }
export interface Rep { id: number; code: string; name: string; status: 'Active' | 'Resigned'; hire_date: string | null; resign_date: string | null }
export interface Box { id: number; line_id: number; name: string }
export interface Territory { id: number; line_id: number; name: string }
export interface Span { valid_from: string; valid_to: string | null }
export interface BoxTerritory extends Span { id: number; box_id: number; territory_id: number }
export interface RepBox extends Span { id: number; rep_id: number; box_id: number }
export interface ManagerBox extends Span { id: number; manager_id: number; box_id: number }
export interface TargetRow { box_id: number; shift: 'AM' | 'PM'; effective_from: string; target: number }

export interface OrgData {
  lines: Line[]
  nsms: Nsm[]
  lineNsm: LineNsm[]
  managers: Manager[]
  reps: Rep[]
  boxes: Box[]
  territories: Territory[]
  boxTerritory: BoxTerritory[]
  repBox: RepBox[]
  managerBox: ManagerBox[]
  targets: TargetRow[]
}

export function isActiveOn(s: Span, day: string): boolean {
  return s.valid_from <= day && (s.valid_to === null || s.valid_to >= day)
}

async function loadOrg(): Promise<OrgData> {
  const [lines, nsms, lineNsm, managers, reps, boxes, territories, boxTerritory, repBox, managerBox, targets] =
    await Promise.all([
      fetchAll<Line>('lines', 'id,name', ['id']),
      fetchAll<Nsm>('nsms', 'id,name', ['id']),
      fetchAll<LineNsm>('line_nsm', 'id,line_id,nsm_id,valid_from,valid_to', ['id']),
      fetchAll<Manager>('managers', 'id,code,name,status,hire_date,resign_date', ['id']),
      fetchAll<Rep>('reps', 'id,code,name,status,hire_date,resign_date', ['id']),
      fetchAll<Box>('boxes', 'id,line_id,name', ['id']),
      fetchAll<Territory>('territories', 'id,line_id,name', ['id']),
      fetchAll<BoxTerritory>('box_territory', 'id,box_id,territory_id,valid_from,valid_to', ['id']),
      fetchAll<RepBox>('rep_box', 'id,rep_id,box_id,valid_from,valid_to', ['id']),
      fetchAll<ManagerBox>('manager_box', 'id,manager_id,box_id,valid_from,valid_to', ['id']),
      fetchAll<TargetRow>('call_rate_targets', 'box_id,shift,effective_from,target', ['box_id', 'shift', 'effective_from']),
    ])
  return { lines, nsms, lineNsm, managers, reps, boxes, territories, boxTerritory, repBox, managerBox, targets }
}

/** Derived lookups for a given "as of" day (default today). */
export interface OrgView extends OrgData {
  asOf: string
  lineById: Map<number, Line>
  boxById: Map<number, Box>
  repById: Map<number, Rep>
  managerById: Map<number, Manager>
  territoryById: Map<number, Territory>
  nsmById: Map<number, Nsm>
  repOfBox: Map<number, Rep>
  managerOfBox: Map<number, Manager>
  currentBoxOfRep: Map<number, Box>
  territoryCount: Map<number, number>
  boxOfTerritory: Map<number, Box>
  nsmOfLine: Map<number, Nsm>
  boxesOfManager: Map<number, Box[]>
  boxLabel: (id: number) => string
}

function buildView(d: OrgData, asOf: string): OrgView {
  const lineById = new Map(d.lines.map((x) => [x.id, x]))
  const boxById = new Map(d.boxes.map((x) => [x.id, x]))
  const repById = new Map(d.reps.map((x) => [x.id, x]))
  const managerById = new Map(d.managers.map((x) => [x.id, x]))
  const territoryById = new Map(d.territories.map((x) => [x.id, x]))
  const nsmById = new Map(d.nsms.map((x) => [x.id, x]))

  const repOfBox = new Map<number, Rep>()
  const currentBoxOfRep = new Map<number, Box>()
  for (const rb of d.repBox) {
    if (!isActiveOn(rb, asOf)) continue
    const rep = repById.get(rb.rep_id)
    const box = boxById.get(rb.box_id)
    if (rep && box) {
      repOfBox.set(rb.box_id, rep)
      currentBoxOfRep.set(rb.rep_id, box)
    }
  }
  const managerOfBox = new Map<number, Manager>()
  const boxesOfManager = new Map<number, Box[]>()
  for (const mb of d.managerBox) {
    if (!isActiveOn(mb, asOf)) continue
    const m = managerById.get(mb.manager_id)
    const box = boxById.get(mb.box_id)
    if (m && box) {
      managerOfBox.set(mb.box_id, m)
      boxesOfManager.set(m.id, [...(boxesOfManager.get(m.id) ?? []), box])
    }
  }
  const territoryCount = new Map<number, number>()
  const boxOfTerritory = new Map<number, Box>()
  for (const bt of d.boxTerritory) {
    if (!isActiveOn(bt, asOf)) continue
    territoryCount.set(bt.box_id, (territoryCount.get(bt.box_id) ?? 0) + 1)
    const box = boxById.get(bt.box_id)
    if (box) boxOfTerritory.set(bt.territory_id, box)
  }
  const nsmOfLine = new Map<number, Nsm>()
  for (const ln of d.lineNsm) {
    if (!isActiveOn(ln, asOf) || ln.nsm_id === null) continue
    const n = nsmById.get(ln.nsm_id)
    if (n) nsmOfLine.set(ln.line_id, n)
  }
  const boxLabel = (id: number) => {
    const b = boxById.get(id)
    return b ? `${lineById.get(b.line_id)?.name ?? '?'} · ${b.name}` : `Box #${id}`
  }
  return {
    ...d, asOf, lineById, boxById, repById, managerById, territoryById, nsmById, repOfBox, managerOfBox,
    currentBoxOfRep, territoryCount, boxOfTerritory, nsmOfLine, boxesOfManager, boxLabel,
  }
}

export interface OrgState {
  org: OrgView | null
  error: string | null
  loading: boolean
  reload: () => Promise<void>
}

/** Loads the (small) org tables once and exposes derived "current" lookups. */
export function useOrg(): OrgState {
  const [data, setData] = useState<OrgData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await loadOrg())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load organisation data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const org = useMemo(() => (data ? buildView(data, todayIso()) : null), [data])
  return { org, error, loading, reload }
}

/** Effective target of a box/shift for a month: latest effective_from <= month (same rule as SQL get_target). */
export function effectiveTarget(targets: TargetRow[], box: number, shift: 'AM' | 'PM', month: string): TargetRow | null {
  let best: TargetRow | null = null
  for (const t of targets) {
    if (t.box_id === box && t.shift === shift && t.effective_from <= month) {
      if (!best || t.effective_from > best.effective_from) best = t
    }
  }
  return best
}

/** One row of the database function vacant_manager_boxes: a box with no manager in the month. */
export interface VacantManagerBox {
  box_id: number
  box_name: string
  line_name: string
  district: string | null
  /** Null = the district's manager is vacant too. */
  district_manager: string | null
}

/** Boxes with no manager in the month containing `month` (any date; the first day is sent). */
export function fetchVacantManagerBoxes(month: string): Promise<VacantManagerBox[]> {
  return rpc<VacantManagerBox[] | null>('vacant_manager_boxes', { p_month: monthStart(month) }).then((r) => r ?? [])
}
