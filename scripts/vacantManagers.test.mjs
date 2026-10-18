// Run: npm run test:vacancies   (Node >= 22.18 strips TypeScript types natively)
import assert from 'node:assert/strict'
import { groupVacantManagerBoxes, districtLabel } from '../src/pages/personnel/vacantManagers.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }
const row = (box_id, box_name, line_name, district, district_manager) => ({ box_id, box_name, line_name, district, district_manager })

t('null / blank district manager -> grouped under its district; others stay flat', () => {
  const v = groupVacantManagerBoxes([
    row(1, 'Nasr 2', 'CIRA 1', 'East', null),
    row(2, 'Nasr 1', 'CIRA 1', 'East', null),
    row(3, 'Giza 1', 'CIRA 1', 'West', 'Dr Hany'),
    row(4, 'Maadi', 'CIRA 2', 'South', '  '),
    row(5, 'Heliopolis', 'CIRA 1', 'North', null),
  ])
  assert.deepEqual(v.vacantDistricts.map((g) => [g.line, g.district, g.boxes.map((b) => b.box_name)]), [
    ['CIRA 1', 'East', ['Nasr 1', 'Nasr 2']], // boxes sorted inside the group
    ['CIRA 1', 'North', ['Heliopolis']],
    ['CIRA 2', 'South', ['Maadi']],
  ])
  assert.deepEqual(v.withManager.map((r) => r.box_name), ['Giza 1'])
})
t('count badge = boxes listed (groups + flat rows)', () => {
  const rows = [row(1, 'A', 'L1', 'D1', null), row(2, 'B', 'L1', 'D1', null), row(3, 'C', 'L1', 'D2', 'M')]
  const v = groupVacantManagerBoxes(rows)
  assert.equal(v.total, 3)
  assert.equal(v.vacantDistricts.reduce((a, g) => a + g.boxes.length, 0) + v.withManager.length, v.total)
})
t('same district name in two lines are two groups', () => {
  const v = groupVacantManagerBoxes([row(1, 'A', 'CIRA 1', 'East', null), row(2, 'B', 'CIRA 2', 'East', null)])
  assert.equal(v.vacantDistricts.length, 2)
})
t('duplicate box rows are counted once; null district gets a label; empty list', () => {
  const v = groupVacantManagerBoxes([row(1, 'A', 'L1', null, null), row(1, 'A', 'L1', null, null)])
  assert.equal(v.total, 1); assert.equal(districtLabel(v.vacantDistricts[0].district), 'No district')
  assert.deepEqual(groupVacantManagerBoxes([]), { vacantDistricts: [], withManager: [], total: 0 })
})
t('natural ordering (District 2 before District 10)', () => {
  const v = groupVacantManagerBoxes([row(1, 'A', 'L1', 'District 10', null), row(2, 'B', 'L1', 'District 2', null)])
  assert.deepEqual(v.vacantDistricts.map((g) => g.district), ['District 2', 'District 10'])
})
console.log(`\n${n} tests passed`)
