import type { WorkBook } from 'xlsx'
import { readColumns, text, toIsoDate } from '../excel'
import { normName } from '../norm'
import { fetchAll, insertChunks, rpc, upsertChunks } from './core'
import type { Box, BoxTerritory, Line, Manager, ManagerBox, Rep, RepBox, Territory } from './org'

export const IMPORT_START = '2026-01-01'

/* ---------- parsed (file) shapes ---------- */
interface MgrRow { code: string; name: string; status: 'Active' | 'Resigned'; hire: string | null; resign: string | null }
interface RepRow { code: string; name: string; line: string; box: string; status: 'Active' | 'Resigned'; hire: string | null; resign: string | null }
interface BoxMgrRow { line: string; box: string; manager: string | null }
interface BoxTerrRow { line: string; box: string; territory: string }

export interface ImportPlan {
  errors: string[]
  warnings: string[]
  counts: { label: string; value: number }[]
  /** Everything needed to execute; absent if there are blocking errors. */
  exec: ExecPlan | null
}

interface PlannedBox { line_id: number; name: string }
interface ExecPlan {
  managers: { code: string; name: string; status: string; hire_date: string | null; resign_date: string | null }[]
  boxes: PlannedBox[]
  territories: { line_id: number; name: string }[]
  boxTerritory: { line_id: number; box: string; territory: string }[]
  reps: { code: string; name: string; status: string; hire_date: string | null; resign_date: string | null }[]
  repBox: { code: string; line_id: number; box: string; valid_from: string; valid_to: string | null }[]
  managerBox: { managerCode: string; line_id: number; box: string; valid_from: string; valid_to: string | null }[]
}

const statusOf = (v: string | null): 'Active' | 'Resigned' => (v && /resign/i.test(v) ? 'Resigned' : 'Active')
const overlaps = (a: { from: string; to: string | null }, b: { from: string; to: string | null }) =>
  a.from <= (b.to ?? '9999-12-31') && b.from <= (a.to ?? '9999-12-31')

export interface DbSnapshot {
  lines: Line[]; managers: Manager[]; reps: Rep[]; boxes: Box[]; territories: Territory[]
  boxTerritory: BoxTerritory[]; repBox: RepBox[]; managerBox: ManagerBox[]
}

export async function loadSnapshot(): Promise<DbSnapshot> {
  const [lines, managers, reps, boxes, territories, boxTerritory, repBox, managerBox] = await Promise.all([
    fetchAll<Line>('lines', 'id,name', ['id']),
    fetchAll<Manager>('managers', 'id,code,name,status,hire_date,resign_date', ['id']),
    fetchAll<Rep>('reps', 'id,code,name,status,hire_date,resign_date', ['id']),
    fetchAll<Box>('boxes', 'id,line_id,name', ['id']),
    fetchAll<Territory>('territories', 'id,line_id,name', ['id']),
    fetchAll<BoxTerritory>('box_territory', 'id,box_id,territory_id,valid_from,valid_to', ['id']),
    fetchAll<RepBox>('rep_box', 'id,rep_id,box_id,valid_from,valid_to', ['id']),
    fetchAll<ManagerBox>('manager_box', 'id,manager_id,box_id,valid_from,valid_to', ['id']),
  ])
  return { lines, managers, reps, boxes, territories, boxTerritory, repBox, managerBox }
}

/** Parse the workbook (only whitelisted sheets/columns are read) and build a preview + execution plan. */
export function planImport(wb: WorkBook, db: DbSnapshot): ImportPlan {
  const errors: string[] = []
  const warnings: string[] = []

  const need = (sheet: string, wanted: Record<string, string[]>) => {
    const ws = wb.Sheets[sheet]
    if (!ws) {
      errors.push(`Sheet "${sheet}" not found in the workbook.`)
      return []
    }
    const r = readColumns(ws, wanted)
    if (r.missing.length) errors.push(`Sheet "${sheet}" is missing column(s): ${r.missing.join(', ')}.`)
    return r.rows
  }

  const mgrRaw = need('Managers', {
    code: ['Username'], name: ['Manager Name'], status: ['Status'], hire: ['Hire Date'], resign: ['Resignation Date'],
  })
  const repRaw = need('Reps', {
    code: ['Username'], name: ['Name'], line: ['Line'], box: ['Box'], status: ['Status'], hire: ['Hire Date'], resign: ['Resignation Date'],
  })
  const bmRaw = need('Box_Manager_Map', { line: ['Line'], box: ['Box'], manager: ['Manager Name'] })
  const btRaw = need('Box_Territory_Map', { line: ['Line'], box: ['Box'], territory: ['Territory'] })
  if (errors.length) return { errors, warnings, counts: [], exec: null }

  /* ---- lines ---- */
  const lineByNorm = new Map(db.lines.map((l) => [normName(l.name) ?? '', l]))
  const lineOf = (raw: string | null, where: string): Line | null => {
    const l = lineByNorm.get(normName(raw) ?? '')
    if (!l) warnings.push(`${where}: unknown line "${raw ?? ''}" — row skipped.`)
    return l ?? null
  }

  /* ---- managers ---- */
  const managers: MgrRow[] = []
  for (const r of mgrRaw) {
    const code = text(r.code)
    const name = text(r.name)
    if (!code || !name) {
      warnings.push(`Managers: row without username or name skipped (${name ?? code ?? 'blank'}).`)
      continue
    }
    managers.push({ code, name, status: statusOf(text(r.status)), hire: toIsoDate(r.hire), resign: toIsoDate(r.resign) })
  }
  const mgrByName = new Map<string, MgrRow>()
  for (const m of managers) {
    const k = normName(m.name)
    if (k && !mgrByName.has(k)) mgrByName.set(k, m)
  }
  for (const m of db.managers) {
    const k = normName(m.name)
    if (k && !mgrByName.has(k) && m.code)
      mgrByName.set(k, { code: m.code, name: m.name, status: m.status, hire: m.hire_date, resign: m.resign_date })
  }

  /* ---- boxes (canonical spelling per line+norm) ---- */
  const boxCanon = new Map<string, string>() // `${line}|${norm}` -> canonical name
  for (const b of db.boxes) boxCanon.set(`${b.line_id}|${normName(b.name)}`, b.name)
  const spellings = new Map<string, Set<string>>()
  const canonBox = (line: Line, raw: string): string => {
    const k = `${line.id}|${normName(raw)}`
    const set = spellings.get(k) ?? new Set<string>()
    set.add(raw.trim())
    spellings.set(k, set)
    const existing = boxCanon.get(k)
    if (existing) return existing
    const name = raw.trim()
    boxCanon.set(k, name)
    return name
  }

  /* ---- Box_Territory_Map ---- */
  const bt: BoxTerrRow[] = []
  const terrSeen = new Map<string, string>() // `${line}|${norm}` -> box
  const terrCanon = new Map<string, string>()
  for (const t of db.territories) terrCanon.set(`${t.line_id}|${normName(t.name)}`, t.name)
  const territories: { line_id: number; name: string }[] = []
  const territoryBoxPairs: { line_id: number; box: string; territory: string }[] = []
  for (const r of btRaw) {
    const lineName = text(r.line), boxRaw = text(r.box), terrRaw = text(r.territory)
    if (!lineName || !boxRaw || !terrRaw) continue
    const line = lineOf(lineName, 'Box_Territory_Map')
    if (!line) continue
    bt.push({ line: lineName, box: boxRaw, territory: terrRaw })
    const box = canonBox(line, boxRaw)
    const tk = `${line.id}|${normName(terrRaw)}`
    if (terrSeen.has(tk)) {
      const prev = terrSeen.get(tk)
      warnings.push(
        prev === box
          ? `Duplicate territory in ${line.name}: "${terrRaw}" appears twice for box "${box}" (kept once).`
          : `Duplicate territory in ${line.name}: "${terrRaw}" is mapped to both "${prev}" and "${box}" — kept "${prev}".`,
      )
      continue
    }
    terrSeen.set(tk, box)
    if (!terrCanon.has(tk)) {
      terrCanon.set(tk, terrRaw)
      territories.push({ line_id: line.id, name: terrRaw })
    }
    territoryBoxPairs.push({ line_id: line.id, box, territory: terrCanon.get(tk) as string })
  }

  /* ---- Reps ---- */
  const reps: (RepRow & { lineId: number | null })[] = []
  const seenRepCodes = new Set<string>()
  for (const r of repRaw) {
    const code = text(r.code), name = text(r.name)
    if (!code || !name) {
      warnings.push(`Reps: row without username or name skipped (${name ?? code ?? 'blank'}).`)
      continue
    }
    if (seenRepCodes.has(code)) {
      warnings.push(`Reps: duplicate username ${code} — second row ignored.`)
      continue
    }
    seenRepCodes.add(code)
    const lineName = text(r.line)
    const line = lineName ? lineByNorm.get(normName(lineName) ?? '') ?? null : null
    reps.push({
      code, name, line: lineName ?? '', box: text(r.box) ?? '', status: statusOf(text(r.status)),
      hire: toIsoDate(r.hire), resign: toIsoDate(r.resign), lineId: line?.id ?? null,
    })
  }

  /* ---- Box_Manager_Map ---- */
  const bm: (BoxMgrRow & { lineId: number })[] = []
  for (const r of bmRaw) {
    const lineName = text(r.line), boxRaw = text(r.box)
    if (!lineName || !boxRaw) continue
    const line = lineOf(lineName, 'Box_Manager_Map')
    if (!line) continue
    canonBox(line, boxRaw)
    bm.push({ line: lineName, box: boxRaw, manager: text(r.manager), lineId: line.id })
  }

  /* ---- reps' boxes must exist in the maps ---- */
  const boxesInMaps = new Set<string>()
  for (const p of territoryBoxPairs) boxesInMaps.add(`${p.line_id}|${normName(p.box)}`)
  for (const b of bm) boxesInMaps.add(`${b.lineId}|${normName(b.box)}`)
  for (const b of db.boxes) boxesInMaps.add(`${b.line_id}|${normName(b.name)}`)

  const repPlan: ExecPlan['repBox'] = []
  const repBoxSkipped: string[] = []
  for (const r of reps) {
    if (!r.box) continue
    if (r.lineId === null) {
      warnings.push(`Reps: ${r.name} (${r.code}) has unknown line "${r.line}" — box assignment skipped.`)
      continue
    }
    const k = `${r.lineId}|${normName(r.box)}`
    if (!boxesInMaps.has(k)) {
      warnings.push(`Rep ${r.name} (${r.code}): box "${r.box}" is not in the box/territory maps — the box will be created without territories.`)
    }
    const boxName = canonBox({ id: r.lineId, name: r.line }, r.box)
    const from = r.hire && r.hire > IMPORT_START ? r.hire : IMPORT_START
    const to = r.status === 'Resigned' ? r.resign : null
    if (r.status === 'Resigned' && !to) {
      repBoxSkipped.push(`${r.name} (${r.code}): resigned without a resignation date — box assignment skipped.`)
      continue
    }
    if (to && to < from) {
      repBoxSkipped.push(`${r.name} (${r.code}): resigned (${to}) before the assignment start (${from}) — skipped.`)
      continue
    }
    repPlan.push({ code: r.code, line_id: r.lineId, box: boxName, valid_from: from, valid_to: to })
  }
  warnings.push(...repBoxSkipped)

  /* ---- overlap rule for rep_box (incl. rows already in the database) ---- */
  const accepted: ExecPlan['repBox'] = []
  let alreadyLoadedRepBox = 0
  const sorted = [...repPlan].sort((a, b) => a.valid_from.localeCompare(b.valid_from) || (a.valid_to ? 1 : 0) - (b.valid_to ? 1 : 0))
  type Occ = { box: string; rep: string; from: string; to: string | null }
  const occupied: Occ[] = []
  for (const x of db.repBox) {
    const box = db.boxes.find((b) => b.id === x.box_id)
    const rep = db.reps.find((r) => r.id === x.rep_id)
    if (box && rep) occupied.push({ box: `${box.line_id}|${normName(box.name)}`, rep: rep.code, from: x.valid_from, to: x.valid_to })
  }
  for (const p of sorted) {
    const bk = `${p.line_id}|${normName(p.box)}`
    const span = { from: p.valid_from, to: p.valid_to }
    if (occupied.some((o) => o.box === bk && o.rep === p.code && o.from === p.valid_from)) {
      alreadyLoadedRepBox++
      continue
    }
    const clash = occupied.find((o) => (o.box === bk || o.rep === p.code) && overlaps(o, span))
    if (clash) {
      warnings.push(
        clash.rep === p.code
          ? `Rep ${p.code}: already covers another box during ${p.valid_from} → ${p.valid_to ?? 'open'} — assignment to "${p.box}" skipped (overlap rule).`
          : `Box "${p.box}": rep ${clash.rep} already covers it during the same period — rep ${p.code} skipped (overlap rule).`,
      )
      continue
    }
    occupied.push({ box: bk, rep: p.code, ...span })
    accepted.push(p)
  }

  /* ---- manager_box ---- */
  const mgrPlan: ExecPlan['managerBox'] = []
  const mgrOcc: { box: string; from: string; to: string | null; code: string }[] = []
  for (const x of db.managerBox) {
    const box = db.boxes.find((b) => b.id === x.box_id)
    const m = db.managers.find((mm) => mm.id === x.manager_id)
    if (box && m?.code) mgrOcc.push({ box: `${box.line_id}|${normName(box.name)}`, from: x.valid_from, to: x.valid_to, code: m.code })
  }
  const unknownManagers = new Set<string>()
  let noManager = 0
  for (const r of bm) {
    const mn = normName(r.manager)
    const isVacant = !mn || mn === 'vacant'
    const m = isVacant ? undefined : mgrByName.get(mn)
    if (!m) {
      noManager++
      if (!isVacant && r.manager) unknownManagers.add(r.manager)
      continue
    }
    const boxName = canonBox({ id: r.lineId, name: r.line }, r.box)
    const bk = `${r.lineId}|${normName(boxName)}`
    const from = IMPORT_START
    const to = m.status === 'Resigned' && m.resign && m.resign >= from ? m.resign : null
    if (mgrOcc.some((o) => o.box === bk && o.code === m.code && o.from === from)) continue
    const clash = mgrOcc.find((o) => o.box === bk && overlaps(o, { from, to }))
    if (clash) {
      warnings.push(`Box "${boxName}": a different manager already covers it from ${from} — mapping to ${m.name} skipped.`)
      continue
    }
    mgrOcc.push({ box: bk, from, to, code: m.code })
    mgrPlan.push({ managerCode: m.code, line_id: r.lineId, box: boxName, valid_from: from, valid_to: to })
  }
  for (const n of unknownManagers) warnings.push(`Box_Manager_Map: manager name "${n}" was not found in the Managers sheet — treated as no manager.`)

  /* ---- box spellings that differ only by case/spacing ---- */
  for (const [k, set] of spellings) {
    if (set.size > 1) warnings.push(`Box names differing only by case/spacing were merged: ${[...set].map((s) => `"${s}"`).join(' / ')} (line ${k.split('|')[0]}).`)
  }

  /* ---- vacancies: boxes with territories but no rep and no manager ---- */
  const boxesWithRep = new Set(accepted.map((a) => `${a.line_id}|${normName(a.box)}`))
  for (const o of occupied) boxesWithRep.add(o.box)
  const boxesWithMgr = new Set(mgrPlan.map((a) => `${a.line_id}|${normName(a.box)}`))
  for (const o of mgrOcc) boxesWithMgr.add(o.box)
  const boxesWithTerr = new Map<string, string>()
  for (const p of territoryBoxPairs) boxesWithTerr.set(`${p.line_id}|${normName(p.box)}`, p.box)
  const vacantBoth = [...boxesWithTerr].filter(([k]) => !boxesWithRep.has(k) && !boxesWithMgr.has(k)).map(([, name]) => name)
  if (vacantBoth.length)
    warnings.push(`${vacantBoth.length} box(es) have territories but no rep and no manager — left Vacant: ${vacantBoth.join(', ')}.`)

  /* ---- assemble executable plan ---- */
  const allBoxKeys = new Map<string, PlannedBox>()
  const addBox = (lineId: number, name: string) => allBoxKeys.set(`${lineId}|${normName(name)}`, { line_id: lineId, name })
  for (const p of territoryBoxPairs) addBox(p.line_id, p.box)
  for (const p of accepted) addBox(p.line_id, p.box)
  for (const p of mgrPlan) addBox(p.line_id, p.box)
  for (const r of reps) if (r.lineId !== null && r.box) addBox(r.lineId, canonBox({ id: r.lineId, name: r.line }, r.box))
  for (const r of bm) addBox(r.lineId, canonBox({ id: r.lineId, name: r.line }, r.box))
  const existingBoxKeys = new Set(db.boxes.map((b) => `${b.line_id}|${normName(b.name)}`))
  const newBoxes = [...allBoxKeys].filter(([k]) => !existingBoxKeys.has(k)).map(([, v]) => v)

  const existingMgrCodes = new Set(db.managers.map((m) => m.code))
  const existingRepCodes = new Set(db.reps.map((r) => r.code))
  const exec: ExecPlan = {
    managers: managers.map((m) => ({ code: m.code, name: m.name, status: m.status, hire_date: m.hire, resign_date: m.resign })),
    boxes: newBoxes,
    territories,
    boxTerritory: territoryBoxPairs,
    reps: reps.map((r) => ({ code: r.code, name: r.name, status: r.status, hire_date: r.hire, resign_date: r.resign })),
    repBox: accepted,
    managerBox: mgrPlan,
  }

  const counts = [
    { label: 'Managers in file', value: managers.length },
    { label: 'Managers new / updated', value: managers.filter((m) => !existingMgrCodes.has(m.code)).length },
    { label: 'Reps in file', value: reps.length },
    { label: 'Reps new / updated', value: reps.filter((r) => !existingRepCodes.has(r.code)).length },
    { label: 'Resigned reps', value: reps.filter((r) => r.status === 'Resigned').length },
    { label: 'Boxes to create', value: newBoxes.length },
    { label: 'Territories to create', value: territories.length },
    { label: 'Territory → box mappings', value: territoryBoxPairs.length },
    { label: 'Rep ↔ box assignments to create', value: accepted.length },
    { label: 'Rep ↔ box already loaded', value: alreadyLoadedRepBox },
    { label: 'Manager ↔ box assignments', value: mgrPlan.length },
    { label: 'Boxes with no manager', value: noManager },
  ]
  return { errors, warnings, counts, exec }
}

export interface ImportSummary { steps: { label: string; count: number }[]; rebuiltMonths: number }

/** Execute the plan in the documented order; upserts keyed by natural keys, chunks of 500. */
export async function executeImport(plan: ExecPlan, onStep: (label: string) => void): Promise<ImportSummary> {
  const steps: { label: string; count: number }[] = []
  const done = (label: string, count: number) => steps.push({ label, count })

  onStep('Managers')
  await upsertChunks('managers', plan.managers, 'code')
  done('Managers upserted', plan.managers.length)

  onStep('Boxes')
  await upsertChunks('boxes', plan.boxes, 'line_id,name')
  done('Boxes created', plan.boxes.length)

  onStep('Territories')
  // Territories already present (case-insensitive) were filtered out during planning.
  await upsertChunks('territories', plan.territories, 'line_id,name')
  done('Territories created', plan.territories.length)

  // Re-read ids.
  const snap = await loadSnapshot()
  const boxId = new Map(snap.boxes.map((b) => [`${b.line_id}|${normName(b.name)}`, b.id]))
  const terrId = new Map(snap.territories.map((t) => [`${t.line_id}|${normName(t.name)}`, t.id]))
  const mgrId = new Map(snap.managers.filter((m) => m.code).map((m) => [m.code as string, m.id]))

  onStep('Territory → box mappings')
  const openTerr = new Set(snap.boxTerritory.filter((x) => x.valid_to === null).map((x) => x.territory_id))
  const btRows: { box_id: number; territory_id: number; valid_from: string }[] = []
  for (const p of plan.boxTerritory) {
    const b = boxId.get(`${p.line_id}|${normName(p.box)}`)
    const t = terrId.get(`${p.line_id}|${normName(p.territory)}`)
    if (b && t && !openTerr.has(t)) btRows.push({ box_id: b, territory_id: t, valid_from: IMPORT_START })
  }
  await insertChunks('box_territory', btRows)
  done('Territory mappings created', btRows.length)

  onStep('Reps')
  await upsertChunks('reps', plan.reps, 'code')
  done('Reps upserted', plan.reps.length)

  const repIds = new Map((await fetchAll<Rep>('reps', 'id,code,name,status,hire_date,resign_date', ['id'])).map((r) => [r.code, r.id]))

  onStep('Rep ↔ box')
  const rbRows = plan.repBox.flatMap((p) => {
    const rep = repIds.get(p.code)
    const box = boxId.get(`${p.line_id}|${normName(p.box)}`)
    return rep && box ? [{ rep_id: rep, box_id: box, valid_from: p.valid_from, valid_to: p.valid_to }] : []
  })
  await insertChunks('rep_box', rbRows)
  done('Rep ↔ box assignments created', rbRows.length)

  onStep('Manager ↔ box')
  const mbRows = plan.managerBox.flatMap((p) => {
    const m = mgrId.get(p.managerCode)
    const box = boxId.get(`${p.line_id}|${normName(p.box)}`)
    return m && box ? [{ manager_id: m, box_id: box, valid_from: p.valid_from, valid_to: p.valid_to }] : []
  })
  await insertChunks('manager_box', mbRows)
  done('Manager ↔ box assignments created', mbRows.length)

  onStep('Rebuilding org and KPIs')
  const rebuilt = await rpc<number>('rebuild_org_from', { p_date: IMPORT_START })
  return { steps, rebuiltMonths: rebuilt }
}

export type { ExecPlan }
