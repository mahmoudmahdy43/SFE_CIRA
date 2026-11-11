// Run: npm run test:list-cleaning   (Node >= 22.18 strips TypeScript types natively)
// List Cleaning: Account Name / Doctor Name rules per account type, severity High / Medium / Low.
import assert from 'node:assert/strict'
import { checkRow, classify, norm, hasTitle, nameWords, worstSeverity } from '../src/features/listCleaning/cleaningRules.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }
const sev = (type, acc, doc) => worstSeverity(checkRow(type, acc, doc))
const msgs = (type, acc, doc) => checkRow(type, acc, doc).map((i) => i.message).join(' | ')

t('norm unifies spelling', () => {
  assert.equal(norm('مستشفى'), norm('مستشفي'))
  assert.equal(norm('صيدلية'), norm('صيدليه'))
  assert.equal(norm('إبن  سينا'), 'ابن سينا')
})
t('titles and word count', () => {
  for (const s of ['د. احمد علي', 'د احمد علي', 'دكتور احمد علي', 'دكتورة هند علي', 'د/احمد علي', 'أ.د احمد علي']) assert.ok(hasTitle(s), s)
  assert.ok(!hasTitle('احمد علي'))
  assert.equal(nameWords('د. احمد علي'), 2)
  assert.equal(nameWords('احمد'), 1)
})

// ---- Clinics
t('clinic: clean row has no issue', () => assert.equal(sev('Clinics', 'عيادة احمد علي', 'احمد علي'), null))
t('clinic: English letter in doctor = High', () => assert.equal(sev('Clinics', 'عيادة احمد علي', 'Ahmed علي'), 'High'))
t('clinic: one-word doctor = High', () => assert.equal(sev('Clinics', 'عيادة احمد', 'احمد'), 'High'))
t('clinic: title = Medium', () => {
  assert.equal(sev('Clinics', 'عيادة د. احمد علي', 'د. احمد علي'), 'Medium')
  assert.equal(sev('Clinics', 'عيادة احمد علي', 'دكتور احمد علي'), 'Medium')
})
t('clinic: account without عيادة = Medium', () => assert.equal(sev('Clinics', 'احمد علي', 'احمد علي'), 'Medium'))
t('clinic: account differs from doctor = Low', () => assert.equal(sev('Clinics', 'عيادة محمد حسن', 'احمد علي'), 'Low'))

// ---- Hospital
t('hospital: accepted forms', () => {
  assert.equal(sev('Hospital', 'مستشفى المطرية التعليمي', 'عيادة الباطنة مستشفى المطرية التعليمي'), null)
  assert.equal(sev('Hospital', 'مستشفي المطرية التعليمي', 'عيادة الباطنة مستشفى المطرية التعليمي'), null)
  assert.equal(sev('Hospital', 'مستشفى المطرية التعليمي', 'احمد علي'), null) // two-word doctor name is fine
})
t('hospital: wrong forms', () => {
  assert.equal(sev('Hospital', 'المطرية التعليمي', 'احمد علي'), 'Medium')
  assert.equal(sev('Hospital', 'مستشفى المطرية', 'عيادة الباطنة'), 'High')
  assert.equal(sev('Hospital', 'مستشفى المطرية', 'عيادة الباطنة مستشفى الهرم'), 'High')
  assert.equal(sev('Hospital', 'مستشفى المطرية', 'باطنة'), 'High')
  assert.equal(sev('Hospital', 'Matareya Hospital', 'عيادة الباطنة مستشفى المطرية'), 'High')
})

// ---- AM Center
t('am center', () => {
  assert.equal(sev('AM Center', 'تعاقد كهرباء مدينة نصر', 'احمد علي'), null)
  assert.equal(sev('AM Center', 'تعاقد كهرباء مدينة نصر', 'عيادة الباطنة تعاقد كهرباء مدينة نصر'), null)
  assert.equal(sev('AM Center', 'تعاقد كهرباء مدينة نصر', 'عيادة الباطنة'), 'High')
  assert.equal(sev('AM Center', 'كهرباء مدينة نصر', 'احمد علي'), 'Medium')
  assert.equal(sev('AM Center', 'تعاقد كهرباء مدينة نصر', 'احمد'), 'High')
})

// ---- Polyclinics
t('polyclinic', () => {
  assert.equal(sev('Poly Clinics', 'مركز النور الطبي', 'احمد علي'), null)
  assert.equal(sev('Poly Clinics', 'عيادات الشفاء', 'احمد علي'), null)
  assert.equal(sev('Poly Clinics', 'مركز النور الطبي', 'عيادة الباطنة'), 'High')
  assert.equal(sev('Poly Clinics', 'مركز النور الطبي', 'احمد'), 'High')
  assert.equal(sev('Poly Clinics', 'Al Nour Center', 'احمد علي'), 'High')
  assert.equal(sev('Poly Clinics', 'مركز', 'احمد علي'), 'Medium')
})

// ---- Pharmacy
t('pharmacy', () => {
  assert.equal(sev('Pharmacy', 'صيدلية النور', 'صيدلية النور'), null)
  assert.equal(sev('Pharmacy', 'صيدليه النور', 'x'), null)
  assert.equal(sev('Pharmacy', 'ص النور', 'ص النور'), 'Medium')
  assert.equal(sev('Pharmacy', 'النور', 'النور'), 'Medium')
  assert.equal(sev('Pharmacy', 'صيدلية', 'صيدلية'), 'High')
  assert.equal(sev('Pharmacy', 'صيدلية Nour', 'x'), 'High')
})

// ---- Distributor
t('distributor', () => {
  assert.equal(sev('Distributors', 'فارما اوفرسيز فرع الهرم', ''), null)
  assert.equal(sev('Distributors', 'إبن سينا فرع المنصورة', ''), null)
  assert.equal(sev('Distributors', 'المتحدة فرع طنطا', ''), null)
  assert.equal(sev('Distributors', 'المصرية فرع اسيوط', ''), null)
  assert.equal(sev('Distributors', 'فارما اوفرسيز', ''), 'Medium')
  assert.equal(sev('Distributors', 'الاهرام للتوزيع', ''), 'High')
})

t('classify keeps only rows with issues, worst first, and carries the report columns', () => {
  const base = { month: '2026-11-01', line: 'CIRA 1', manager: 'M', box: 'B', rep_code: '1', rep_name: 'R', account_id: '1', doctor_id: '1', territory: 'T', brick: 'K', speciality: 'S' }
  const rows = classify([
    { ...base, account_type: 'Clinics', account_name: 'عيادة احمد علي', doctor_name: 'احمد علي' },
    { ...base, account_type: 'Clinics', account_name: 'عيادة د احمد علي', doctor_name: 'د احمد علي' },
    { ...base, account_type: 'Pharmacy', account_name: 'ص النور', doctor_name: 'x' },
    { ...base, account_type: 'Clinics', account_name: 'عيادة احمد', doctor_name: 'Ahmed' },
  ])
  assert.deepEqual(rows.map((r) => r.severity), ['High', 'Medium', 'Medium'])
  assert.ok(rows[0].issues.includes('English'))
})
console.log(`\n${n} tests passed`)
