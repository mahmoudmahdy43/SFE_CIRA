import { supabase } from '../supabase'
import { DEFAULT_PARAMS, doctorTimesFromHistory, usualMaxDayFromHistory, windowFromTimes, type ActualVisit, type BrickPair, type BrickRepeat, type HistoryInfo, type PlanInputs, type PlanParams, type PlanRow, type PlanSummary } from '../../features/plan/planner'
import { fetchAll, rpc } from './core'
import { rpcAll } from './reports'

type Raw = Record<string, unknown>
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

/** The rep's PM visits of the 3 months before `month` (his own history: PM window, usual weekday and hour of each doctor). */
export async function fetchRepHistory(rep: number, month: string): Promise<ActualVisit[]> {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const months = [1, 2, 3].map((k) => { const d = new Date(Date.UTC(y, m - 1 - k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01` })
  const parts = await Promise.all(months.map((mm) => fetchPlanActuals(rep, mm).catch(() => [] as ActualVisit[])))
  return parts.flat()
}

/** plan_history_info (88_plan_history_any_rep.sql): how much history the rep's list has. undefined when the function is not installed. */
export async function fetchHistoryInfo(rep: number, month: string): Promise<HistoryInfo | undefined> {
  try {
    const j = ((await rpc<Raw | null>('plan_history_info', { p_rep: rep, p_month: month, p_months_back: 6 })) ?? null) as Raw | null
    if (!j) return undefined
    const n = (v: unknown): number => Number(v ?? 0)
    return { list_doctors: n(j.list_doctors), doctors_with_any: n(j.doctors_with_any), doctors_with_time_any: n(j.doctors_with_time_any), visits_own: n(j.visits_own), doctors_with_own: n(j.doctors_with_own), doctors_with_gps: n(j.doctors_with_gps) }
  } catch {
    return undefined
  }
}

/** plan_doctor_history (88): the PM visits of the rep's list doctors by ANY rep in the last 6 months. undefined when the function is not installed. */
export async function fetchDoctorHistory(rep: number, month: string): Promise<ActualVisit[] | undefined> {
  try {
    const rows = await rpcAll('plan_doctor_history', { p_rep: rep, p_month: month, p_months_back: 6 }, ['doctor_id', 'visit_date'])
    return rows.map((r) => ({ day: String(r.visit_date).slice(0, 10), doctor_id: Number(r.doctor_id), visit_time: str(r.visit_time) }))
  } catch {
    return undefined
  }
}

/** plan_brick_pairs (86_plan_brick_pairs.sql): bricks the rep worked in the same day in the last 6 months. undefined when the function is not installed. */
export async function fetchBrickPairs(rep: number, month: string, any = false): Promise<BrickPair[] | undefined> {
  try {
    const rows = await rpc<Raw[] | null>(any ? 'plan_brick_pairs_any' : 'plan_brick_pairs', { p_rep: rep, p_month: month, p_months_back: 6 })
    return (rows ?? []).map((r) => ({ a: String(r.brick_a), b: String(r.brick_b), pm_days: Number(r.pm_days_together ?? 0), any_days: Number(r.any_days_together ?? 0), last_day: r.last_day ? String(r.last_day).slice(0, 10) : null }))
  } catch {
    return undefined
  }
}

/** plan_brick_repeats (87_plan_brick_repeats.sql): how often the rep worked the same brick two PM working days in a row. undefined when the function is not installed. */
export async function fetchBrickRepeats(rep: number, month: string, any = false): Promise<BrickRepeat[] | undefined> {
  try {
    const rows = await rpc<Raw[] | null>(any ? 'plan_brick_repeats_any' : 'plan_brick_repeats', { p_rep: rep, p_month: month, p_months_back: 6 })
    return (rows ?? []).map((r) => ({ brick: String(r.brick), repeat_days: Number(r.repeat_days ?? 0), brick_days: Number(r.brick_days ?? 0), last_repeat: r.last_repeat ? String(r.last_repeat).slice(0, 10) : null }))
  } catch {
    return undefined
  }
}

/**
 * plan_inputs (85_monthly_plan.sql) plus what comes from the rep's own history: PM window, usual start of the day, each doctor's usual weekday and hours
 * (3 months before the month), the brick pairs, and - for a re-plan from `fromDay` - the visits already done this month.
 */
export async function fetchPlanInputs(rep: number, month: string, fromDay: string | null = null): Promise<PlanInputs> {
  const [inputs, history, info, docHist, pairsOwn, repeatsOwn, pairsAny, repeatsAny, thisMonth] = await Promise.all([
    fetchPlanInputsRaw(rep, month), fetchRepHistory(rep, month), fetchHistoryInfo(rep, month), fetchDoctorHistory(rep, month),
    fetchBrickPairs(rep, month), fetchBrickRepeats(rep, month), fetchBrickPairs(rep, month, true), fetchBrickRepeats(rep, month, true),
    fromDay && fromDay > month ? fetchPlanActuals(rep, month) : Promise.resolve([] as ActualVisit[]),
  ])
  // brick history: the rep's own when he has 30+ PM visits in the last 3 months, else the history of any rep who worked these bricks
  const own = history.length >= DEFAULT_PARAMS.minOwnVisitsForBricks
  const pairs = own ? pairsOwn ?? pairsAny : pairsAny ?? pairsOwn
  const repeats = own ? repeatsOwn ?? repeatsAny : repeatsAny ?? repeatsOwn
  const brickSource: 'own' | 'any' = own || (pairsAny === undefined && repeatsAny === undefined) ? 'own' : 'any'
  const done: Record<number, number> = {}
  for (const v of thisMonth) if (fromDay && v.day < fromDay) done[v.doctor_id] = (done[v.doctor_id] ?? 0) + 1
  return {
    ...inputs, historyInfo: info, brickSource, doctors: doctorTimesFromHistory(docHist ?? history, inputs.doctors), window: windowFromTimes(history.map((v) => v.visit_time)),
    brickRepeats: repeats, usualMaxDay: usualMaxDayFromHistory(history), brickPairs: pairs, fromDay: fromDay && fromDay > month ? fromDay : null, done,
  }
}

async function fetchPlanInputsRaw(rep: number, month: string): Promise<PlanInputs> {
  const j = ((await rpc<Raw | null>('plan_inputs', { p_rep: rep, p_month: month })) ?? {}) as Raw
  const rr = j.rep as Raw | null | undefined
  const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : [])
  return {
    rep: rr ? { id: Number(rr.id), name: String(rr.name ?? ''), code: String(rr.code ?? '') } : null,
    month: String(j.month ?? month).slice(0, 10), list_month: str(j.list_month), box_id: num(j.box_id), daily_target: num(j.daily_target),
    days: arr(j.days).map((d) => ({ day: String(d.day).slice(0, 10), isodow: Number(d.isodow), closed: d.closed === true, reason: str(d.reason) })),
    doctors: arr(j.doctors).map((d) => ({
      doctor_id: Number(d.doctor_id), name: String(d.name ?? ''), account: str(d.account), account_type: str(d.account_type), freq: Number(d.freq ?? 0),
      brick: str(d.brick), division: str(d.division), lat: num(d.lat), lng: num(d.lng), pos_source: str(d.pos_source),
      usual_isodow: num(d.usual_isodow), usual_hour: str(d.usual_hour), n_visits: Number(d.n_visits ?? 0),
    })),
  }
}

export async function fetchPlanActuals(rep: number, month: string): Promise<ActualVisit[]> {
  const rows = await rpc<Raw[] | null>('plan_actuals', { p_rep: rep, p_month: month })
  return (rows ?? []).map((r) => ({ day: String(r.day).slice(0, 10), doctor_id: Number(r.doctor_id), visit_time: str(r.visit_time) }))
}

export interface PlanRequest { id: number; day: string; kind: 'activity' | 'training' | 'other'; shift: 'AM' | 'PM' | 'FULL'; note: string | null }

export async function fetchPlanRequests(rep: number, month: string): Promise<PlanRequest[]> {
  const rows = await fetchAll<Raw>('plan_requests', 'id,day,kind,shift,note', ['day', 'id'], (q) => q.eq('rep_id', rep).eq('month', month))
  return rows.map((r) => ({ id: Number(r.id), day: String(r.day).slice(0, 10), kind: r.kind as PlanRequest['kind'], shift: r.shift as PlanRequest['shift'], note: str(r.note) }))
}

export async function addPlanRequest(rep: number, month: string, r: Omit<PlanRequest, 'id'>): Promise<void> {
  const { error } = await supabase.from('plan_requests').insert({ rep_id: rep, month, day: r.day, kind: r.kind, shift: r.shift, note: r.note })
  if (error) throw new Error(error.code === '23505' ? 'This request already exists for that day.' : error.message)
}

export async function deletePlanRequest(id: number): Promise<void> {
  const { error } = await supabase.from('plan_requests').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export interface SavedPlan { id: number; status: 'draft' | 'approved'; params: Partial<PlanParams>; summary: PlanSummary | null; generated_at: string; rows: PlanRow[] }

/** monthly_plans + monthly_plan_days of a rep and month (null when none is saved). */
export async function fetchSavedPlan(rep: number, month: string): Promise<SavedPlan | null> {
  const heads = await fetchAll<Raw>('monthly_plans', 'id,status,params,summary,generated_at', ['id'], (q) => q.eq('rep_id', rep).eq('month', month))
  if (heads.length === 0) return null
  const h = heads[0]
  const id = Number(h.id)
  const days = await fetchAll<Raw>('monthly_plan_days', 'day,seq,doctor_id,planned_time,fixed,visit_no,note', ['day', 'seq'], (q) => q.eq('plan_id', id))
  const summary = h.summary && typeof h.summary === 'object' && Object.keys(h.summary as object).length > 0 ? (h.summary as PlanSummary) : null
  return {
    id, status: h.status === 'approved' ? 'approved' : 'draft', params: (h.params ?? {}) as Partial<PlanParams>, summary, generated_at: String(h.generated_at ?? ''),
    rows: days.map((d) => ({
      day: String(d.day).slice(0, 10), seq: Number(d.seq), doctor_id: Number(d.doctor_id), planned_time: d.planned_time ? String(d.planned_time).slice(0, 5) : null,
      fixed: d.fixed === true, visit_no: Number(d.visit_no ?? 1), note: str(d.note),
    })),
  }
}

/** save_plan: returns the plan id, or null when the month's plan is already approved. */
export async function savePlan(rep: number, month: string, params: PlanParams, summary: PlanSummary, rows: PlanRow[]): Promise<number | null> {
  const id = await rpc<number | null>('save_plan', { p_rep: rep, p_month: month, p_params: params, p_summary: summary, p_rows: rows })
  return id === null || id === undefined ? null : Number(id)
}

export async function approvePlan(plan: number): Promise<void> {
  await rpc('approve_plan', { p_plan: plan })
}

export interface PlanRep { rep_id: number; name: string; code: string; line_id: number | null; line_name: string; manager_id: number | null; manager_name: string }

/** The reps that have a territory in the month, with their line and direct manager. */
export async function fetchPlanReps(month: string): Promise<PlanRep[]> {
  const [org, reps, lines, managers] = await Promise.all([
    fetchAll<Raw>('org_month', 'territory_id,rep_id,line_id,manager_id', ['territory_id'], (q) => q.eq('month', month)),
    fetchAll<Raw>('reps', 'id,code,name', ['id']),
    fetchAll<Raw>('lines', 'id,name', ['id']),
    fetchAll<Raw>('managers', 'id,name', ['id']),
  ])
  const repMap = new Map(reps.map((r) => [Number(r.id), r]))
  const lineMap = new Map(lines.map((l) => [Number(l.id), String(l.name)]))
  const mgrMap = new Map(managers.map((m) => [Number(m.id), String(m.name)]))
  const out = new Map<number, PlanRep>()
  for (const o of org) {
    const id = num(o.rep_id)
    if (id === null || out.has(id)) continue
    const r = repMap.get(id)
    if (!r) continue
    const lineId = num(o.line_id)
    const mgr = num(o.manager_id)
    out.set(id, { rep_id: id, name: String(r.name), code: String(r.code), line_id: lineId, line_name: lineId === null ? '' : lineMap.get(lineId) ?? '', manager_id: mgr, manager_name: mgr === null ? '' : mgrMap.get(mgr) ?? '' })
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}
