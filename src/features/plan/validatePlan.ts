/**
 * Independent check of a generated plan against every hard rule. It shares nothing with the planner except the input types and tiny
 * helpers, so a bug in the planner cannot hide here. A plan that fails is shown with the list of failures and is never saved as a draft.
 */
import { brickOf, dayNum, DEFAULT_PARAMS, gapDaysFor, pairAllowed, pairLookup, toMin, type PlanInputs, type PlanParams, type PlanRow, type ValidationResult } from './planCore.ts'

const MAX_LISTED = 30

export function validatePlan(inputs: PlanInputs, rows: PlanRow[], over: Partial<PlanParams> = {}, declaredUnderMin: Iterable<string> = [], opts: { relaxWeekdays?: boolean } = {}): ValidationResult {
  const p: PlanParams = { ...DEFAULT_PARAMS, ...over }
  const fails: string[] = []
  const warns: string[] = []
  const dayBricks = new Map<string, Set<string>>()
  const declared = new Set(declaredUnderMin)
  const docs = new Map(inputs.doctors.map((d) => [d.doctor_id, d]))
  const dayInfo = new Map(inputs.days.map((d) => [d.day, d]))
  const openDays = inputs.days.filter((d) => !d.closed && (!inputs.fromDay || d.day >= inputs.fromDay)).map((d) => d.day).sort()
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
      const dd = docs.get(r.doctor_id)
      if (dd && dd.win_start != null && dd.win_start - m > p.maxWaitMin) warns.push(`${day}: ${dd.name} arrives ${Math.round(dd.win_start - m)} minutes before his usual hours`)
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
    dayBricks.set(day, new Set(distinct))
    if (distinct.length > p.maxBricksPerDay) fails.push(`${day}: ${distinct.length} bricks in one day (maximum ${p.maxBricksPerDay})`)
    if (seq.length > distinct.length) fails.push(`${day}: bricks are not in blocks (${seq.join(' > ')})`)
    if (distinct.length === 2) {
      const [a, b] = distinct
      // allowed by the history of the two bricks together, or by the weekday history of every doctor of one of them (3+)
      const dow = info ? info.isodow : 0
      const byWeekday = distinct.some((br) => {
        const rs = ordered.filter((r) => { const d = docs.get(r.doctor_id); return d && brickOf(d) === br })
        return rs.length >= p.minSecondBrickDoctors && rs.every((r) => docs.get(r.doctor_id)?.hist_dows?.includes(dow))
      })
      if (!pairAllowed(pair(a, b)) && !byWeekday) fails.push(`${day}: ${a} and ${b} were never worked together before and his doctors were not visited on this weekday before`)
      for (const br of distinct) {
        const n = ordered.filter((r) => { const d = docs.get(r.doctor_id); return d && brickOf(d) === br }).length
        if (n < p.minSecondBrickDoctors) fails.push(`${day}: only ${n} doctor${n === 1 ? '' : 's'} in ${br}, a second brick needs ${p.minSecondBrickDoctors}`)
      }
    }
  }

  // the same brick on two working days in a row is a failure unless the rep's own history allows it (and then only a few times)
  const repeatDays = new Map((inputs.brickRepeats ?? []).map((r) => [r.brick, r.repeat_days]))
  const usedBy = new Map<string, number>()
  let usedTotal = 0
  for (let i = 1; i < openDays.length; i++) {
    const a = dayBricks.get(openDays[i - 1])
    const b = dayBricks.get(openDays[i])
    if (!a || !b) continue
    for (const br of b) {
      if (!a.has(br)) continue
      const allowed = Math.max(0, (repeatDays.get(br) ?? 0) - 1)
      usedBy.set(br, (usedBy.get(br) ?? 0) + 1)
      usedTotal++
      if ((usedBy.get(br) as number) > allowed) fails.push(`${openDays[i - 1]} and ${openDays[i]}: ${br} on two working days in a row${allowed === 0 ? ' (his history has no such repeat)' : ' (more often than his history allows)'}`)
    }
  }
  if (usedTotal > p.maxBrickRepeats) fails.push(`${usedTotal} same-brick repeats on consecutive days, the limit is ${p.maxBrickRepeats}`)

  // doctors restricted to their usual weekdays are only planned on them
  for (const r of rows) {
    const d = docs.get(r.doctor_id)
    const info = dayInfo.get(r.day)
    if (d && info && d.allowed_dows && !d.allowed_dows.includes(info.isodow)) {
      const msg = `${d.name}: planned on ${r.day} but he is only visited on weekday${d.allowed_dows.length === 1 ? '' : 's'} ${d.allowed_dows.join(' and ')} (1 = Monday ... 7 = Sunday)`
      // a weekday restriction is a rule of levels 1-2 only: from level 3 it is relaxed on purpose (the visit is graded C)
      if (opts.relaxWeekdays) warns.push(msg)
      else fails.push(msg)
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
    // minimum gap in calendar days between consecutive visits (10 for 2 visits a month, 7 for 3, 5 for 4 or more), counted from a visit already done too
    const gap = gapDaysFor(d.freq)
    const nums = ds.map(dayNum).sort((a, b) => a - b)
    const last = inputs.lastDone?.[id]
    if (last) nums.unshift(dayNum(last))
    for (let i = 1; i < nums.length; i++) if (nums[i] - nums[i - 1] < gap) fails.push(`${d.name}: visits only ${nums[i] - nums[i - 1]} calendar day${nums[i] - nums[i - 1] === 1 ? '' : 's'} apart (minimum ${gap})`)
  }
  const warnings = warns.length > MAX_LISTED ? [...warns.slice(0, MAX_LISTED), `…and ${warns.length - MAX_LISTED} more`] : warns
  if (fails.length > MAX_LISTED) return { ok: false, failures: [...fails.slice(0, MAX_LISTED), `…and ${fails.length - MAX_LISTED} more`], warnings }
  return { ok: fails.length === 0, failures: fails, warnings }
}
