/**
 * List Cleaning: checks the Account Name / Doctor Name the reps typed in the Target List.
 * Pure functions (no I/O) so they can be tested: scripts/listCleaning.test.mjs.
 *
 * Severity (one row can have several issues, the row takes the highest):
 *   High   = Latin letters in a name, a Doctor Name that is not a full (two-word) name or not the required form,
 *            an Account Name that is empty or not an accepted name (unknown distributor, "صيدلية" alone ...).
 *   Medium = a title (د. / دكتور ...) in a name, or the required Account word is missing (عيادة / مستشفى / تعاقد / صيدلية).
 *   Low    = small deviations: the Account Name does not repeat the doctor / place, type word without a name, long spaces.
 */

export type Severity = 'High' | 'Medium' | 'Low'
export const SEVERITIES: Severity[] = ['High', 'Medium', 'Low']
const RANK: Record<Severity, number> = { High: 3, Medium: 2, Low: 1 }

export interface Issue {
  severity: Severity
  field: 'Account Name' | 'Doctor Name'
  message: string
}

export type AccountKind = 'clinic' | 'hospital' | 'am_center' | 'polyclinic' | 'pharmacy' | 'distributor' | 'other'

/** Distributors the company works with (normalised form, see `norm`). */
export const DISTRIBUTORS = ['فارما اوفرسيز', 'ابن سينا', 'المتحده', 'المصريه']

/** Arabic-insensitive form: no tashkeel/tatweel, alef/ya/ta-marbuta unified, lower-case, single spaces. */
export function norm(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function accountKind(accountType: string | null | undefined): AccountKind {
  const t = String(accountType ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (t === 'clinics' || t === 'clinic') return 'clinic'
  if (t === 'hospital' || t === 'hospitals') return 'hospital'
  if (t === 'amcenter' || t === 'amcenters') return 'am_center'
  if (t === 'polyclinics' || t === 'polyclinic') return 'polyclinic'
  if (t === 'pharmacy' || t === 'pharmacies') return 'pharmacy'
  if (t === 'distributors' || t === 'distributor') return 'distributor'
  return 'other'
}

const hasLatin = (s: string) => /[A-Za-z]/.test(s)

/** Titles the reps must not write: د / د. / د/ / دكتور / دكتورة / أ.د / استاذ / بروفيسور / Dr */
const TITLE_TOKENS = new Set(['د', 'دكتور', 'دكتوره', 'دكاتره', 'اد', 'ا د', 'استاذ', 'استاذه', 'بروفيسور', 'بروف', 'دr', 'dr'])
function tokens(n: string): string[] {
  return n.replace(/[./\\\-_,:;()،]+/g, ' ').split(' ').filter(Boolean)
}
export function hasTitle(s: string): boolean {
  const n = norm(s)
  if (!n) return false
  if (/^(د|ا\.?د)[./\\]/.test(n)) return true // "د.احمد", "د/احمد", "أ.د احمد"
  return tokens(n).some((t) => TITLE_TOKENS.has(t))
}
function stripTitles(s: string): string[] {
  return tokens(norm(s)).filter((t) => !TITLE_TOKENS.has(t))
}
/** Number of words of a person name once titles are removed. */
export function nameWords(s: string): number {
  return stripTitles(s).length
}

const startsWithWord = (n: string, words: string[]) => words.some((w) => n === w || n.startsWith(w + ' '))
const restAfter = (n: string, words: string[]) => {
  for (const w of words) if (n === w) return ''
  for (const w of words) if (n.startsWith(w + ' ')) return n.slice(w.length + 1).trim()
  return null
}

const CLINIC = ['عياده']
const HOSPITAL = ['مستشفي']
const AM = ['تعاقد']
const PHARMACY = ['صيدليه']
const POLY_TYPES = ['مستشفي', 'مركز', 'عيادات', 'عياده', 'مجمع']

function add(out: Issue[], severity: Severity, field: Issue['field'], message: string) {
  out.push({ severity, field, message })
}

/** Checks shared by every name: empty, English letters, double spaces. Returns true when the name is usable for further checks. */
function basic(out: Issue[], field: Issue['field'], raw: string | null | undefined): boolean {
  const s = String(raw ?? '')
  if (!s.trim()) { add(out, 'High', field, `${field} is empty`); return false }
  if (hasLatin(s)) add(out, 'High', field, `${field} contains English letters`)
  if (/\s{2,}/.test(s) || s !== s.trim()) add(out, 'Low', field, `${field} has extra spaces`)
  return true
}

/** A person name: Arabic only, no title, at least two words. */
function personName(out: Issue[], raw: string): void {
  if (hasTitle(raw)) add(out, 'Medium', 'Doctor Name', 'Doctor Name has a title (د. / دكتور)')
  if (nameWords(raw) < 2) add(out, 'High', 'Doctor Name', 'Doctor Name must be at least two words (first + second name)')
}

/** Account Name must start with a required word followed by a name. */
function prefixed(out: Issue[], account: string, words: string[], label: string, shortWords?: string[]): string | null {
  const n = norm(account)
  const rest = restAfter(n, words)
  if (rest === null) {
    if (shortWords && startsWithWord(n, shortWords)) add(out, 'Medium', 'Account Name', `Account Name must start with the full word "${label}" (not an abbreviation)`)
    else add(out, 'Medium', 'Account Name', `Account Name must start with "${label}"`)
    return null
  }
  if (!rest) { add(out, 'High', 'Account Name', `Account Name is only "${label}" without a name`); return '' }
  return rest
}

export function checkRow(accountType: string | null | undefined, accountName: string | null | undefined, doctorName: string | null | undefined): Issue[] {
  const out: Issue[] = []
  const kind = accountKind(accountType)
  const accOk = basic(out, 'Account Name', accountName)
  const docRaw = String(doctorName ?? '')
  const docOk = kind === 'pharmacy' || kind === 'distributor' || kind === 'other' ? true : basic(out, 'Doctor Name', doctorName)
  const acc = norm(accountName)
  const doc = norm(docRaw)

  switch (kind) {
    case 'clinic': {
      if (accOk) {
        if (hasTitle(acc)) add(out, 'Medium', 'Account Name', 'Account Name has a title (د. / دكتور)')
        const rest = prefixed(out, acc, CLINIC, 'عيادة')
        if (rest && docOk && !hasTitle(docRaw) && rest !== stripTitles(doc).join(' ')) add(out, 'Low', 'Account Name', 'Account Name is not "عيادة + Doctor Name"')
      }
      if (docOk) personName(out, docRaw)
      break
    }
    case 'hospital': {
      let place = ''
      if (accOk) place = prefixed(out, acc, HOSPITAL, 'مستشفى') ?? ''
      if (docOk) {
        if (startsWithWord(doc, CLINIC)) {
          // عيادة + speciality + hospital name
          const rest = restAfter(doc, CLINIC) ?? ''
          const needsMore = rest.split(' ').filter(Boolean).length < 2
          const hospitalInDoc = place ? doc.includes(place) : true
          if (needsMore || !hospitalInDoc) add(out, 'High', 'Doctor Name', 'Doctor Name must be "عيادة + speciality + hospital name" (e.g. عيادة الباطنة مستشفى المطرية التعليمي) or a two-word doctor name')
        } else {
          personName(out, docRaw)
        }
      }
      break
    }
    case 'am_center': {
      let place = ''
      if (accOk) place = prefixed(out, acc, AM, 'تعاقد') ?? ''
      if (docOk) {
        if (startsWithWord(doc, CLINIC)) {
          if (!doc.includes('تعاقد')) add(out, 'High', 'Doctor Name', 'Doctor Name must be a two-word doctor name or "عيادة + speciality + تعاقد + place"')
          else if (place && !doc.includes(place)) add(out, 'Low', 'Doctor Name', 'The place in Doctor Name differs from the Account Name')
        } else {
          personName(out, docRaw)
        }
      }
      break
    }
    case 'polyclinic': {
      if (accOk) {
        const first = tokens(acc)[0] ?? ''
        const words = tokens(acc).length
        if (!POLY_TYPES.includes(first)) add(out, 'Low', 'Account Name', 'Account Name should be "مستشفى / مركز / عيادات + place name"')
        else if (words < 2) add(out, 'Medium', 'Account Name', 'Account Name has the type word but no place name')
      }
      if (docOk) {
        if (startsWithWord(doc, CLINIC) || /^(عياده|عيادات)\b/.test(doc)) add(out, 'High', 'Doctor Name', 'Doctor Name is a clinic name, it must be the doctor name (two words)')
        else personName(out, docRaw)
      }
      break
    }
    case 'pharmacy': {
      if (accOk) prefixed(out, acc, PHARMACY, 'صيدلية', ['ص'])
      break
    }
    case 'distributor': {
      if (accOk) {
        const d = DISTRIBUTORS.find((x) => acc === x || acc.startsWith(x + ' ') || acc.replace(/^(شركه|الشركه) /, '').startsWith(x))
        if (!d) add(out, 'High', 'Account Name', 'Distributor is not one of: فارما اوفرسيز / ابن سينا / المتحدة / المصرية')
        else if (acc === d) add(out, 'Medium', 'Account Name', 'Distributor name without the branch (Distributor + branch)')
      }
      break
    }
    default:
      break
  }
  return out
}

export function worstSeverity(issues: Issue[]): Severity | null {
  let best: Severity | null = null
  for (const i of issues) if (!best || RANK[i.severity] > RANK[best]) best = i.severity
  return best
}

export interface ListRow {
  month: string
  line: string
  manager: string
  box: string
  rep_code: string
  rep_name: string
  account_type: string
  account_name: string
  account_id: string
  doctor_name: string
  doctor_id: string
  territory: string
  brick: string
  speciality: string
}
export interface CleaningRow extends ListRow {
  severity: Severity
  issues: string
}

/** Rows with at least one issue, worst first. */
export function classify(rows: ListRow[]): CleaningRow[] {
  const out: CleaningRow[] = []
  for (const r of rows) {
    const issues = checkRow(r.account_type, r.account_name, r.doctor_name)
    const severity = worstSeverity(issues)
    if (!severity) continue
    out.push({ ...r, severity, issues: issues.sort((a, b) => RANK[b.severity] - RANK[a.severity]).map((i) => `[${i.severity}] ${i.message}`).join(' | ') })
  }
  return out.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.line.localeCompare(b.line) || a.manager.localeCompare(b.manager) || a.rep_name.localeCompare(b.rep_name))
}
