/**
 * Independent check of a generated plan against every hard rule. It shares nothing with the planner except the input types and tiny
 * helpers, so a bug in the planner cannot hide here. A plan that fails is shown with the list of failures and is never saved as a draft.
 */
import { brickOf, DEFAULT_PARAMS, pairAllowed, pairLookup, toMin, type PlanInputs, type PlanParams, type PlanRow, type ValidationResult } from './planCore.ts'

const MAX_LISTED = 30

export function validatePlan(inputs: PlanInputs, rows: PlanRow[], over: Partial<PlanParams> = {}, declaredUnderMin: Iterable<string> = []): ValidationResult {
  const p: PlanParams = { ...DEFAULT_PARAMS, ...over }
  const fails: string[] = []
  const declared = new Set(declaredUnderMin)
  const docs = new Map(inputs.doctors.map((d) => [d.doctor_id, d]))
  const dayInfo = new Map(inputs.days.map((d) => [d.day, d]))
  const openDays = inputs.days.filter((d) => !d.closed && (!inputs.fromDay || d.day >= inputs.fromDay)).map((d) => d.day).sort()
  const openIdx = new Map(openDays.map((d, i) => [d, i]))
  const ws = inputs.window ? inputs.window.start : (toMin(p.defaultStart) as number)
  const we = inputs.window ? Math.max(inputs.window.end, ws) : (toMin(p.defaultEnd) as number)
  const pair = pairLookup(inputs.brickPairs)
  const done = inputs.done ?? {}

  const byDay = new Map<string, PlanRow[]>()
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r])

  for (const [day, list] of [...byDay].sort((a, b) => a[0].localeCompare(b[0]))) {
    const info = dayInfo.get(day)
    if (!info) fails.push(`${day}: not a PM working day of the month`)
    else if (info.closed) fails.push(`${day}: a visit on a closed day (${info.reason ?? 'closed'})`)
    else if (inputs.fromDay && day < inputs.fromDay) fails.push(`${day}: a visit before the re-plan date ${inputs.fromDay}`)
    if (list.length > p.maxDay) fails.push(`${day}: ${list.length} visits, above the maximum of ${p.maxDay}`)
    if (list.length < p.minDay && !declared.has(day)) fails.push(`${day}: ${list.length} visits, under the minimum of ${p.minDay}`)

    const ordered = [...list].sort((a, b) => (toMin(a.planned_time) ?? 0) - (toMin(b.planned_time) ?? 0) || a.seq - b.seq)
    // times: inside the PM window, one per minute, at least the visit gap apart
    let prev: number | null = null
    for (const r of ordered) {
      const m = toMin(r.planned_time)
      if (m === null) { fails.push(`${day}: doctor ${r.doctor_id} has no time`); continue }
      if (m < ws || m > we) fails.push(`${day}: ${r.planned_time} is outside the PM window ${Math.floor(ws / 60)}:${String(ws % 60).padStart(2, '0')}-${Math.floor(we / 60)}:${String(we % 60).padStart(2, '0')}`)
      if (prev !== null && m === prev) fails.push(`${day}: two visits at ${r.planned_time}`)
      else if (prev !== null && m - prev < p.gapMin) fails.push(`${day}: visits ${m - prev} minutes apart (minimum ${p.gapMin})`)
      prev = m
    }
    // bricks: at most 2, in one block each, the second allowed by history and with enough doctors
    const seq: string[] = []
    for (const r of ordered) {
      const d = docs.get(r.doctor_id)
      if (!d) { fails.push(`${day}: doctor ${r.doctor_id} is not in the list`); continue }
      const b = brickOf(d)
      if (seq[seq.length - 1] !== b) seq.push(b)
    }
    const distinct = [...new Set(seq)]
    if (distinct.length > p.maxBricksPerDay) fails.push(`${day}: ${distinct.length} bricks in one day (maximum ${p.maxBricksPerDay})`)
    if (seq.length > distinct.length) fails.push(`${day}: bricks are not in blocks (${seq.join(' > ')})`)
    if (distinct.length === 2) {
      const [a, b] = distinct
      if (!pairAllowed(pair(a, b))) fails.push(`${day}: ${a} and ${b} were never worked together before`)
      for (const br of distinct) {
        const n = ordered.filter((r) => { const d = docs.get(r.doctor_id); return d && brickOf(d) === br }).length
        if (n < p.minSecondBrickDoctors) fails.push(`${day}: only ${n} doctor${n === 1 ? '' : 's'} in ${br}, a second brick needs ${p.minSecondBrickDoctors}`)
      }
    }
  }

  // per doctor: never above the visits left, and a minimum gap between his visits
  const perDoc = new Map<number, string[]>()
  for (const r of rows) perDoc.set(r.doctor_id, [...(perDoc.get(r.doctor_id) ?? []), r.day])
  for (const [id, ds] of perDoc) {
    const d = docs.get(id)
    if (!d) continue
    const left = Math.max(0, d.freq - (done[id] ?? 0))
    if (ds.length > left) fails.push(`${d.name}: ${ds.length} planned visits, only ${left} left`)
    const idx = ds.map((x) => openIdx.get(x)).filter((x): x is number => x !== undefined).sort((a, b) => a - b)
    for (let i = 1; i < idx.length; i++) if (idx[i] - idx[i - 1] < p.minGapDays) fails.push(`${d.name}: visits only ${idx[i] - idx[i - 1]} working day${idx[i] - idx[i - 1] === 1 ? '' : 's'} apart (minimum ${p.minGapDays})`)
  }
  if (fails.length > MAX_LISTED) return { ok: false, failures: [...fails.slice(0, MAX_LISTED), `…and ${fails.length - MAX_LISTED} more`] }
  return { ok: fails.length === 0, failures: fails }
}
