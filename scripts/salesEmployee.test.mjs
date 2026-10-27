// Run: npm run test:sales-employee
import assert from 'node:assert/strict'
import * as s from '../src/features/reports/salesEmployeeMath.ts'

let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('ok -', name) }

const row = (o) => ({
  month: '2026-07-01', line_id: 1, line_name: 'CIRA 1', manager_id: 10, manager_name: 'Mona', rep_id: null, rep_name: null, rep_code: null,
  territory_id: null, territory_names: null, box_name: null, s_value: 0, s_units: 0, t_value: 0, t_units: 0, ...o,
})
const rep = (id, name, month, sv, tv, o = {}) => row({ rep_id: id, rep_name: name, rep_code: `C${id}`, territory_names: 'T', month, s_value: sv, t_value: tv, s_units: sv / 10, t_units: tv / 10, ...o })
const vac = (tid, name, terr, month, sv, tv, o = {}) => row({ territory_id: tid, box_name: name, territory_names: terr, month, s_value: sv, t_value: tv, s_units: sv / 10, t_units: tv / 10, ...o })
const MONTHS = ['2026-07-01', '2026-08-01', '2026-09-01']

const rows = [
  // CIRA 1 / Mona: Box A vacant in Jul, rep 1 from Aug; rep 2 all three months
  vac(100, 'Box A', 'Terr A1, Terr A2', '2026-07-01', 180, 300),
  rep(1, 'Rep One', '2026-08-01', 160, 220), rep(1, 'Rep One', '2026-09-01', 200, 220),
  rep(2, 'Rep Two', '2026-07-01', 500, 500), rep(2, 'Rep Two', '2026-08-01', 600, 500), rep(2, 'Rep Two', '2026-09-01', 650, 500),
  // CIRA 1 / Ahmed: a bigger manager
  rep(3, 'Rep Three', '2026-07-01', 900, 800, { manager_id: 11, manager_name: 'Ahmed' }), rep(3, 'Rep Three', '2026-08-01', 950, 800, { manager_id: 11, manager_name: 'Ahmed' }),
  // CIRA 2 / vacant manager: only a vacant box
  vac(102, 'Box C', 'Terr C', '2026-07-01', 70, 70, { line_id: 2, line_name: 'CIRA 2', manager_id: null, manager_name: null }),
  vac(102, 'Box C', 'Terr C', '2026-08-01', 80, 90, { line_id: 2, line_name: 'CIRA 2', manager_id: null, manager_name: null }),
  // CIRA 3
  rep(4, 'Rep Four', '2026-09-01', 40, 0, { line_id: 3, line_name: 'CIRA 3', manager_id: 12, manager_name: 'Sara' }),
]
const sumRows = (k, f = () => true) => rows.filter(f).reduce((a, r) => a + r[k], 0)

await t('tree: every total equals the sum of its children, Company equals the sum of the lines (value and units)', () => {
  for (const [metric, sk, tk] of [['value', 's_value', 't_value'], ['units', 's_units', 't_units']]) {
    const root = s.buildTree(rows, MONTHS, metric)
    const check = (nd) => {
      if (nd.children.length === 0) return
      for (const m of MONTHS) {
        const kids = nd.children.map((c) => c.months.get(m)).filter(Boolean)
        const cell = nd.months.get(m)
        assert.equal(cell?.s ?? 0, kids.reduce((a, c) => a + c.s, 0), `${nd.label} ${m} sales`)
        assert.equal(cell?.t ?? 0, kids.reduce((a, c) => a + c.t, 0), `${nd.label} ${m} target`)
      }
      assert.equal(nd.total.s, nd.children.reduce((a, c) => a + c.total.s, 0), `${nd.label} total`)
      assert.equal(nd.total.t, nd.children.reduce((a, c) => a + c.total.t, 0))
      nd.children.forEach(check)
    }
    check(root)
    assert.equal(root.total.s, root.children.reduce((a, l) => a + l.total.s, 0), 'Company = sum of the lines')
    assert.ok(Math.abs(root.total.s - sumRows(sk)) < 1e-9, 'Company = sum of all rows')
    assert.ok(Math.abs(root.total.t - sumRows(tk)) < 1e-9)
  }
})

await t('tree: nesting and order (lines by name, managers by total, reps by total, Vacant after the reps)', () => {
  const root = s.buildTree(rows, MONTHS, 'value')
  assert.equal(root.label, 'Total Company')
  assert.deepEqual(root.children.map((l) => l.label), ['Total CIRA 1', 'Total CIRA 2', 'Total CIRA 3'])
  const c1 = root.children[0]
  assert.deepEqual(c1.children.map((m) => m.label), ['Total Mona', 'Total Ahmed'], 'Mona 2290 > Ahmed 1850')
})

await t('Vacant -> Rep within a box: history stays on the Vacant row, later months are on the rep, with a since hint', () => {
  const root = s.buildTree(rows, MONTHS, 'value')
  const mona = root.children[0].children.find((m) => m.label === 'Total Mona')
  const labels = mona.children.map((c) => c.label)
  assert.deepEqual(labels, ['Rep Two', 'Rep One', 'Box A'], 'reps by total desc, the Vacant box last')
  assert.equal(mona.children[2].box, 'Box A'); assert.equal(mona.children[2].children[0].label, 'Terr A1, Terr A2')
  const vacant = mona.children[2]
  assert.deepEqual([...vacant.months.keys()], ['2026-07-01'], 'July only: the earlier month stays on the Vacant row')
  assert.equal(vacant.total.s, 180)
  assert.equal(vacant.kind, 'vacant')
  const one = mona.children[1]
  assert.deepEqual([...one.months.keys()].sort(), ['2026-08-01', '2026-09-01'])
  assert.equal(one.since, '2026-08-01')
  assert.equal(mona.children[0].since, '', 'a rep covering the whole period has no hint')
  assert.equal(mona.months.get('2026-07-01').s, 680, 'Total Mona Jul = Rep Two + Vacant Box A')
  assert.equal(mona.months.get('2026-08-01').s, 760, 'Aug: no Vacant row for Box A any more')
})

await t('months without rows are absent ("-") and the vacant manager is its own row', () => {
  const root = s.buildTree(rows, MONTHS, 'value')
  const c2 = root.children[1]
  assert.equal(c2.children[0].label, 'Total Vacant manager')
  assert.equal(s.monthCell(c2, '2026-09-01'), '-')
  assert.equal(s.monthCell(c2, '2026-08-01'), '80')
  assert.equal(s.monthCell(root, '2026-07-01'), '1,650')
  const only = s.buildTree(rows, ['2026-08-01'], 'value')
  assert.equal(only.total.s, 160 + 600 + 950 + 80, 'rows outside the columns are ignored')
})

await t('figures: Total, Target, Ach % = all sales / target, average per month, tone', () => {
  const root = s.buildTree(rows, MONTHS, 'value')
  const c3 = root.children[2]
  const f3 = s.figures(c3, 3)
  assert.deepEqual([f3.total, f3.target, f3.ach], [40, 0, null], 'no target -> no Ach %')
  assert.equal(s.fmtPct(f3.ach), '-')
  const f = s.figures(root, 3)
  assert.equal(f.avg, root.total.s / 3)
  assert.equal(f.ach, root.total.s / root.total.t)
  assert.deepEqual([0.79, 0.8, 0.999, 1, 1.2, null].map(s.achTone), ['red', 'amber', 'amber', 'green', 'green', 'none'])
  assert.equal(s.figures(root, 0).avg, 0)
})

await t('expand / collapse: default shows Company and Lines, managers collapsed; expand all and collapse all', () => {
  const root = s.buildTree(rows, MONTHS, 'value')
  const def = s.flatten(root, s.defaultExpanded(root))
  assert.deepEqual(def.map((r) => r.node.kind), ['company', 'line', 'manager', 'manager', 'line', 'manager', 'line', 'manager'])
  assert.ok(def.filter((r) => r.node.kind === 'manager').every((r) => r.open === false && r.expandable))
  assert.ok(def.every((r) => r.node.kind !== 'rep' && r.node.kind !== 'vacant'))
  const all = s.flatten(root, s.expandAll(root))
  assert.equal(all.length, 1 + 3 + 4 + 4 + 2 + 2, 'company + 3 lines + 4 managers + 4 reps + 2 Vacant boxes + 2 territories')
  assert.equal(all.filter((r) => r.node.kind === 'rep' || r.node.kind === 'vacant' || r.node.kind === 'vterr').length, 8)
  assert.equal(s.flatten(root, s.collapseAll()).map((r) => r.node.kind).join(), 'company,line,line,line')
  const none = s.flatten(root, new Set())
  assert.equal(none.length, 1)
})

await t('quarter, semester and YTD to a month range, limited to the loaded months', () => {
  const loaded = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-07-01', '2026-08-01', '2026-09-01']
  assert.deepEqual(s.quickMonths('2026-Q3', loaded), ['2026-07-01', '2026-08-01', '2026-09-01'])
  assert.deepEqual(s.quickMonths('2026-S1', loaded), ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'])
  assert.equal(s.quickMonths('2026-S2', loaded).length, 6)
  assert.deepEqual(s.quickPick('2026-Q3', loaded), { from: '2026-07-01', to: '2026-09-01', shown: 3, total: 3, incomplete: false })
  const q2 = s.quickPick('2026-Q2', loaded)
  assert.deepEqual(q2, { from: '2026-04-01', to: '2026-04-01', shown: 1, total: 3, incomplete: true })
  assert.equal(s.incompleteNote(q2), 'Showing 1 of 3 months loaded')
  assert.equal(s.incompleteNote(s.quickPick('2026-Q3', loaded)), '')
  const s1 = s.quickPick('2026-S1', loaded)
  assert.deepEqual([s1.from, s1.to, s1.shown, s1.total], ['2026-01-01', '2026-04-01', 4, 6])
  const ytd = s.quickPick('2026-YTD', loaded)
  assert.deepEqual([ytd.from, ytd.to, ytd.shown, ytd.total], ['2026-01-01', '2026-09-01', 7, 9], 'Jan to the latest loaded month, 2 not loaded')
  assert.equal(s.quickPick('2025-Q1', loaded), null)
  assert.equal(s.quickPick('2026-Q4', loaded), null)
  assert.deepEqual(s.quickOptions('quarter', loaded).map((o) => o.label), ['Q3 2026', 'Q2 2026', 'Q1 2026'])
  assert.deepEqual(s.quickOptions('semester', loaded).map((o) => o.id), ['2026-S2', '2026-S1'])
  assert.deepEqual(s.quickOptions('ytd', loaded).map((o) => o.label), ['YTD 2026'])
  assert.deepEqual(s.monthsInRange(loaded, '2026-03-01', '2026-07-01'), ['2026-03-01', '2026-04-01', '2026-07-01'])
  assert.equal(s.monthShort('2026-07-01'), 'Jul 26'); assert.equal(s.monthShort(''), '')
})

await t('product filter parameter: null for all or none, else the sorted ids', () => {
  const all = [5, 3, 9, 1]
  assert.equal(s.productParam([], all), null)
  assert.equal(s.productParam(new Set([1, 3, 5, 9]), all), null, 'everything selected = no filter')
  assert.deepEqual(s.productParam(new Set([9, 3]), all), [3, 9])
  assert.deepEqual(s.productParam([3, 3, 99], all), [3], 'unknown ids dropped, duplicates removed')
  assert.equal(s.productParam([99], all), null)
})

await t('paging: pages of 1000 until a short page; an exact multiple needs one more request', async () => {
  const mk = (total) => { const calls = []; const fetchPage = async (from, to) => { calls.push([from, to]); return Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => from + i) }; return { calls, fetchPage } }
  let p = mk(2350)
  const r = await s.pageAll(p.fetchPage)
  assert.equal(r.length, 2350); assert.deepEqual(p.calls, [[0, 999], [1000, 1999], [2000, 2999]])
  p = mk(2000)
  assert.equal((await s.pageAll(p.fetchPage)).length, 2000); assert.equal(p.calls.length, 3, 'a full last page: one more request returns empty')
  p = mk(0)
  assert.equal((await s.pageAll(p.fetchPage)).length, 0); assert.equal(p.calls.length, 1)
  p = mk(7)
  assert.equal((await s.pageAll(p.fetchPage, 5)).length, 7); assert.deepEqual(p.calls, [[0, 4], [5, 9]])
})

await t('RPC row mapping: numeric strings, nulls and timestamps', () => {
  const r = s.toEmpRow({ month: '2026-07-01T00:00:00', line_id: 1, line_name: 'CIRA 1', manager_id: null, rep_id: '5', rep_name: 'X', s_value: '1234.5', t_value: null, s_units: undefined, t_units: 'abc', territory_id: null })
  assert.deepEqual([r.month, r.manager_id, r.rep_id, r.s_value, r.t_value, r.s_units, r.t_units], ['2026-07-01', null, 5, 1234.5, 0, 0, 0])
})

await t('Excel rows: hierarchy with indentation, all months, Total, Target, Ach %, Avg; flat sheet; file name', () => {
  const root = s.buildTree(rows, MONTHS, 'value')
  const h = s.hierarchyRows(root, MONTHS)
  assert.equal(h.length, 1 + 3 + 4 + 4 + 2 + 2, 'the hierarchy follows the grouped screen')
  assert.ok(h.some((r) => r.Name === '      Box A (1 territory)' && r.Level === 'vacant'))
  assert.deepEqual(Object.keys(h[0]), ['Name', 'Level', 'Line', 'Jul 26', 'Aug 26', 'Sep 26', 'Total', 'Target', 'Ach %', 'Avg per month'])
  assert.equal(h[0].Name, 'Total Company'); assert.equal(h[1].Name, '  Total CIRA 1'); assert.equal(h[2].Name, '    Total Mona'); assert.equal(h[3].Name, '      Rep Two')
  assert.equal(h[0].Total, Math.round(sumRows('s_value')))
  assert.equal(h[0]['Ach %'], Math.round((sumRows('s_value') / sumRows('t_value')) * 1000) / 10)
  const c2 = h.find((r) => r.Name === '  Total CIRA 2')
  assert.deepEqual([c2['Sep 26'], c2['Jul 26'], c2['Ach %']], [null, 70, Math.round((150 / 160) * 1000) / 10])
  assert.equal(h.find((r) => r.Name === '  Total CIRA 3')['Ach %'], null)
  assert.equal(h[0]['Avg per month'], Math.round(sumRows('s_value') / 3))
  const f = s.flatRows(root, MONTHS)
  assert.equal(f.length, 6)
  
  assert.deepEqual(Object.keys(f[0]).slice(6), ['Jul 26', 'Aug 26', 'Sep 26', 'Total', 'Target', 'Ach %', 'Avg per month'])
  assert.deepEqual(f.map((r) => r.Type), ['Rep', 'Rep', 'Vacant', 'Rep', 'Vacant', 'Rep'])
  const vacRow = f.find((r) => r.Type === 'Vacant' && r.Manager === 'Mona')
  assert.deepEqual([vacRow.Rep, vacRow.Territory, vacRow['Jul 26'], vacRow['Aug 26'], vacRow.Total], ['', 'Terr A1, Terr A2', 180, null, 180])
  assert.equal(vacRow.Box, 'Box A'); assert.deepEqual(Object.keys(f[0]).slice(0, 6), ['Line', 'Manager', 'Rep', 'Type', 'Territory', 'Box'])
  assert.equal(f.reduce((a, r) => a + r.Total, 0), h[0].Total, 'flat rows add up to the Company total')
  assert.equal(s.exportFileName('2026-07-01', '2026-09-01'), 'Sales_by_Employee_2026-07_2026-09.xlsx')
})

await t('Vacant name: the territory first, the box in gray after it (once), never the box alone when a territory exists', () => {
  assert.equal(s.vacantName('Assiut 2', 'Box Assuit'), 'Assiut 2')
  assert.equal(s.boxHint('Assiut 2', 'Box Assuit'), 'Box Assuit')
  assert.equal(s.boxHint('Faisal', 'Faisal'), '', 'territory equal to the box: shown once')
  assert.equal(s.boxHint('Faisal', ' faisal '), '')
  assert.equal(s.boxHint('Assiut 2', ''), ''); assert.equal(s.boxHint('Assiut 2', null), '')
  assert.equal(s.vacantName('', 'Box Z'), 'Box Z', 'no territory: fall back to the box')
  assert.equal(s.vacantName(null, '  '), '(territory not set)')
  assert.ok(!/vacant/i.test(s.vacantName('Assiut 2', 'Box Assuit')), 'the word Vacant is only the pill')
  const tree = s.buildTree([vac(7, 'Box Assuit', 'Assiut 2', '2026-07-01', 10, 0), vac(8, 'Box Assuit', 'Assiut 3', '2026-07-01', 30, 0), vac(9, null, null, '2026-07-01', 5, 0)], ['2026-07-01'], 'value')
  const boxes = tree.children[0].children[0].children
  assert.deepEqual(boxes.map((c) => c.label), ['Box Assuit', '(territory not set)'], 'one row per box')
  assert.deepEqual(boxes[0].children.map((c) => c.label), ['Assiut 3', 'Assiut 2'], 'its territories, by total desc')
  assert.equal(boxes[0].total.s, 40)
  assert.equal(s.toEmpRow({ month: '2026-07-01', box_name: 'Faisal' }).box_name, 'Faisal')
  assert.equal(s.toEmpRow({ month: '2026-07-01' }).box_name, null)
})

await t('a manager with only Vacant boxes and no sales still shows; rows after the reps', () => {
  const tree = s.buildTree([vac(1, 'Faisal', 'T', '2026-07-01', 0, 0, { manager_id: 99, manager_name: 'Only Vacant' })], ['2026-07-01'], 'value')
  const m = tree.children[0].children[0]
  assert.equal(m.label, 'Total Only Vacant'); assert.equal(m.children[0].label, 'Faisal'); assert.equal(m.children[0].kind, 'vacant'); assert.equal(m.children[0].children[0].label, 'T'); assert.equal(m.total.s, 0)
})

await t('KPI strip: company sales, target, Ach %, Vacant sales and its share; filters change the tree and so the KPIs', () => {
  const root = s.buildTree(rows, MONTHS, 'value')
  const k = s.kpis(root)
  assert.equal(k.sales, sumRows('s_value')); assert.equal(k.target, sumRows('t_value'))
  assert.equal(k.ach, k.sales / k.target)
  assert.equal(k.vacant, 180 + 70 + 80)
  assert.equal(k.vacantShare, 330 / k.sales)
  const none = s.kpis(s.buildTree([], MONTHS, 'value'))
  assert.deepEqual([none.sales, none.ach, none.vacant, none.vacantShare], [0, null, 0, null])
  const jul = s.kpis(s.buildTree(rows, ['2026-07-01'], 'value'))
  assert.equal(jul.vacant, 250)
})

await t('row heat scale (reps and Vacant rows only) and the cell tooltip', () => {
  const root = s.buildTree(rows, MONTHS, 'value')
  const mona = root.children[0].children[0]
  const two = mona.children.find((c) => c.label === 'Rep Two')
  const h = s.rowHeat(two)
  assert.deepEqual([h.get('2026-07-01'), h.get('2026-09-01')], [0, 1]); assert.ok(h.get('2026-08-01') > 0 && h.get('2026-08-01') < 1)
  assert.equal(s.rowHeat(mona).size, 0, 'total rows have no heat'); assert.equal(s.rowHeat(root).size, 0)
  assert.equal(s.rowHeat(mona.children.find((c) => c.kind === 'vacant')).size, 0, 'a single month: no scale')
  assert.equal(s.cellTitle(two, '2026-07-01'), 'Jul 2026: 500 (28.6% of the row total)')
  assert.equal(s.cellTitle(two, '2026-10-01'), 'Oct 2026: no sales')
})

await t('box name: filled on Vacant and rep rows (Excel Box column), shown by the page only next to a Vacant territory', () => {
  const tree = s.buildTree([rep(1, 'Rep One', '2026-07-01', 10, 0, { box_name: 'Box Assuit' }), vac(2, 'Box Assuit', 'Assiut 2', '2026-07-01', 5, 0)], ['2026-07-01'], 'value')
  const f = s.flatRows(tree, ['2026-07-01'])
  assert.deepEqual(f.map((r) => [r.Type, r.Box]), [['Rep', 'Box Assuit'], ['Vacant', 'Box Assuit']])
  assert.equal(f[1].Territory, 'Assiut 2')
  assert.equal(s.toEmpRow({ month: '2026-07-01', box_name: 'Box Assuit' }).box_name, 'Box Assuit')
})

await t('normalised comparison: the box is shown only when it is really different from the territory', () => {
  assert.equal(s.cleanText('  Faisal   &amp;  Sons '), 'Faisal & Sons')
  assert.equal(s.boxHint('Faisal & Sons', 'faisal &amp; sons'), '', 'entity, case and spaces ignored')
  assert.equal(s.boxHint('Assiut  2', ' assiut 2 '), '')
  assert.equal(s.boxHint('ASSIUT 2', 'Assiut 2'), '')
  assert.equal(s.boxHint('Assiut 2', 'Assiut 3'), 'Assiut 3')
  assert.equal(s.boxHint('A &amp; B', 'A and B'), 'A and B')
  assert.equal(s.vacantName(' A &amp; B ', null), 'A & B')
  assert.equal(s.boxHint(null, 'Box Z'), 'Box Z'); assert.equal(s.boxHint('X', '  '), '')
})

await t('the same territory name in CIRA 1, 2 and 3: separate Vacant rows, each under its own line and manager (vacant manager per line)', () => {
  const mk = (lid, ln, mid, mn, tid, sv) => vac(tid, 'Box Assuit', 'Assiut 2', '2026-07-01', sv, 0, { line_id: lid, line_name: ln, manager_id: mid, manager_name: mn })
  const tree = s.buildTree([mk(1, 'CIRA 1', 10, 'Mona', 11, 10), mk(2, 'CIRA 2', null, null, 21, 20), mk(3, 'CIRA 3', null, null, 31, 30), mk(2, 'CIRA 2', 12, 'Sara', 22, 5)], ['2026-07-01'], 'value')
  assert.deepEqual(tree.children.map((l) => l.label), ['Total CIRA 1', 'Total CIRA 2', 'Total CIRA 3'])
  for (const l of tree.children) for (const m of l.children) for (const v of m.children) { assert.equal(v.kind, 'vacant'); assert.equal(v.line, l.line.replace(/^Total /, '')); assert.equal(v.label, 'Box Assuit'); assert.equal(v.children[0].label, 'Assiut 2'); assert.equal(v.children[0].line, v.line) }
  const c2 = tree.children[1]
  assert.deepEqual(c2.children.map((m) => m.label), ['Total Vacant manager', 'Total Sara'], 'the null manager is the Vacant manager of its own line')
  assert.equal(c2.total.s, 25)
  assert.equal(tree.children[0].total.s, 10); assert.equal(tree.children[2].total.s, 30)
  const flat = s.flatRows(tree, ['2026-07-01'])
  assert.deepEqual(flat.map((r) => r.Line), ['CIRA 1', 'CIRA 2', 'CIRA 2', 'CIRA 3'], 'Excel flat rows carry the line')
  assert.ok(s.hierarchyRows(tree, ['2026-07-01']).every((r) => 'Line' in r))
  assert.equal(s.fullLabel(tree.children[1].children[0].children[0]), 'CIRA 2 · VACANT · Box Assuit (1 territory)')
  assert.equal(s.fullLabel(tree.children[1].children[0].children[0].children[0]), 'CIRA 2 · VACANT · Assiut 2 · Box Assuit')
})

await t('Vacant boxes: one row per box with N territories, sums add up, never across lines or managers; a rep keeps box and territories', () => {
  const R = [
    vac(1, 'Shobra & Cairo Center', 'Shobra 1', '2026-07-01', 100, 150, { line_id: 3, line_name: 'CIRA 3', manager_id: null, manager_name: null }),
    vac(2, 'Shobra &amp; Cairo Center', 'Shobra 2', '2026-07-01', 50, 0, { line_id: 3, line_name: 'CIRA 3', manager_id: null, manager_name: null }),
    vac(2, 'Shobra & Cairo Center', 'Shobra 2', '2026-08-01', 25, 0, { line_id: 3, line_name: 'CIRA 3', manager_id: null, manager_name: null }),
    vac(3, 'Shobra & Cairo Center', 'Shobra 3', '2026-07-01', 7, 7, { line_id: 1, line_name: 'CIRA 1', manager_id: 10, manager_name: 'Mona' }),
    rep(1, 'Rep One', '2026-07-01', 60, 80, { line_id: 1, line_name: 'CIRA 1', box_name: 'Nasr City', territory_names: 'Nasr 1, Nasr 2' }),
  ]
  const M = ['2026-07-01', '2026-08-01']
  const tree = s.buildTree(R, M, 'value')
  const c3 = tree.children.find((l) => l.label === 'Total CIRA 3')
  const vm = c3.children[0]
  assert.equal(vm.label, 'Total Vacant manager')
  assert.equal(vm.children.length, 1, 'ONE row for the box')
  const box = vm.children[0]
  assert.equal(box.kind, 'vacant'); assert.equal(box.label, 'Shobra & Cairo Center'); assert.equal(s.groupText(box), 'Shobra & Cairo Center (2 territories)')
  assert.deepEqual(box.children.map((c) => [c.label, c.kind, c.total.s]), [['Shobra 2', 'vterr', 75], ['Shobra 1', 'vterr', 100]].sort((a, b) => b[2] - a[2]))
  assert.equal(box.total.s, 175); assert.equal(box.total.t, 150)
  assert.equal(box.months.get('2026-07-01').s, 150); assert.equal(box.months.get('2026-08-01').s, 25)
  assert.equal(box.total.s, box.children.reduce((a, c) => a + c.total.s, 0))
  const c1 = tree.children.find((l) => l.label === 'Total CIRA 1')
  assert.equal(c1.children.length, 1)
  const mona = c1.children[0]
  assert.deepEqual(mona.children.map((c) => [c.kind, c.label]), [['rep', 'Rep One'], ['vacant', 'Shobra & Cairo Center']], 'the same box name in CIRA 1 is another row under its own line')
  assert.equal(tree.total.s, 100 + 50 + 25 + 7 + 60, 'Company = everything')
  assert.equal(s.kpis(tree).vacant, 100 + 50 + 25 + 7, 'Vacant counts each box once')
  assert.equal(s.kpis(tree).vacantShare, 182 / 242)
  const rp = mona.children[0]
  assert.equal(rp.box, 'Nasr City'); assert.equal(rp.territory, 'Nasr 1, Nasr 2')
  assert.equal(s.fullLabel(rp), 'CIRA 1 · Rep One · Nasr City · Nasr 1, Nasr 2')
  const flat = s.flatRows(tree, M)
  assert.equal(flat.length, 4, 'flat: one row per territory plus the rep')
  assert.deepEqual(flat.filter((r) => r.Type === 'Vacant').map((r) => [r.Line, r.Territory, r.Box]).sort(), [['CIRA 1', 'Shobra 3', 'Shobra & Cairo Center'], ['CIRA 3', 'Shobra 1', 'Shobra & Cairo Center'], ['CIRA 3', 'Shobra 2', 'Shobra & Cairo Center']])
  assert.deepEqual(flat.find((r) => r.Type === 'Rep').Territory, 'Nasr 1, Nasr 2')
  assert.equal(flat.reduce((a, r) => a + r.Total, 0), tree.total.s)
})

await t('a response shaped exactly like the real RPC output (PostgREST JSON): the Territory text and the Box come through', () => {
  const real = [
    { month: '2026-07-01', line_id: 3, line_name: 'CIRA 3', manager_id: null, manager_name: null, rep_id: null, rep_name: null, rep_code: null, territory_id: 412, territory_names: 'Shobra 1', box_name: 'Shobra & Cairo Center', s_value: 1234567.5, s_units: 10, t_value: 2000000, t_units: 12 },
    { month: '2026-07-01', line_id: 1, line_name: 'CIRA 1', manager_id: 10, manager_name: 'Mona', rep_id: 61, rep_name: 'Rep One', rep_code: '1C0001', territory_id: null, territory_names: 'Nasr 1, Nasr 2', box_name: 'Nasr City', s_value: '900.25', s_units: '3', t_value: '1000', t_units: '4' },
  ]
  const rows = real.map(s.toEmpRow)
  assert.equal(s.territoryMissing(rows), false)
  assert.deepEqual(rows.map((r) => r.territory_names), ['Shobra 1', 'Nasr 1, Nasr 2'])
  const tree = s.buildTree(rows, ['2026-07-01'], 'value')
  const flat = s.flatRows(tree, ['2026-07-01'])
  assert.deepEqual(flat.map((r) => [r.Type, r.Territory, r.Box]).sort(), [['Rep', 'Nasr 1, Nasr 2', 'Nasr City'], ['Vacant', 'Shobra 1', 'Shobra & Cairo Center']])
  // the other spellings a function might use are read too; none at all is detected
  assert.equal(s.toEmpRow({ month: '2026-07-01', territory_name: 'Old Name' }).territory_names, 'Old Name')
  assert.equal(s.toEmpRow({ month: '2026-07-01', territory: 'T9' }).territory_names, 'T9')
  assert.equal(s.territoryMissing([s.toEmpRow({ month: '2026-07-01', box_name: 'B' })]), true)
  assert.equal(s.territoryMissing([]), false)
})

console.log(`${n} tests passed`)
