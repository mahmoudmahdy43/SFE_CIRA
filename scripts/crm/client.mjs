/**
 * Read-only CRM client (Node >= 20, built-in fetch, no browser).
 * - GET only: there is no code path that sends another method except the single login POST.
 * - One request at a time (PHP locks the session), 3 s pause between requests, 120 s timeout, one retry on network errors.
 * - The session cookie lives in memory only. Nothing sensitive is ever logged.
 */

const LOGIN_TIMEOUT_MS = 60_000
const REQUEST_TIMEOUT_MS = 120_000
const PAUSE_MS = 3_000

/** Pages the job may read. Anything else is refused before a request is made. */
const ALLOWED_PATHS = new Set([
  'home.php',
  'reports.php',
  'report_ter_visits.php',
  'report_vacations.php',
  'report_territory_accounts_emp.php',
  'show_data.php',
  'user.visit_view.php',
])
const FORBIDDEN = ['delete', 'remove', 'action=del']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class CrmError extends Error {
  constructor(message, kind = 'error') {
    super(message)
    this.kind = kind
  }
}

export function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n] || process.env[n].trim() === '')
  if (missing.length > 0) {
    throw new CrmError(`Missing GitHub secret(s): ${missing.join(', ')}. Add them in Settings > Secrets and variables > Actions.`, 'config')
  }
}

export function createClient({ baseUrl, user, pass }) {
  const base = new URL(baseUrl.trim().endsWith('/') ? baseUrl.trim() : `${baseUrl.trim()}/`)
  if (base.protocol !== 'https:') throw new CrmError('CRM_BASE_URL must start with https://', 'config')
  let sid = null
  let lastEnd = 0

  const takeCookie = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const m = /^PHPSESSID=([^;]*)/.exec(c)
      if (m) sid = m[1]
    }
  }

  async function paced(fn) {
    const wait = lastEnd + PAUSE_MS - Date.now()
    if (wait > 0) await sleep(wait)
    try {
      return await fn()
    } finally {
      lastEnd = Date.now()
    }
  }

  const isLoginPage = (html) => /name=["']uname["']/i.test(html)
  const cookieHeader = () => ({ cookie: `PHPSESSID=${sid}` })

  async function login() {
    // 1. the first GET hands out the PHPSESSID cookie
    const first = await paced(() => fetch(base, { redirect: 'manual', signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS) }))
    if (first.status >= 400) throw new CrmError(`Login page returned HTTP ${first.status} (blocked or down?)`, 'blocked')
    takeCookie(first)
    const firstHtml = await first.text()
    if (/captcha/i.test(firstHtml)) throw new CrmError('Login page now shows a captcha', 'blocked')
    if (!sid) throw new CrmError('Login page did not set a session cookie', 'blocked')

    // 2. the single POST: the plain login form (no CSRF token exists)
    const body = new URLSearchParams({ uname: user, upass: pass, atype: 'user', page: '0', button: 'Login' })
    const post = await paced(() =>
      fetch(new URL('index.php', base), {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...cookieHeader() },
        body,
        signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
      }),
    )
    takeCookie(post)
    if (post.status === 403 || post.status === 429) throw new CrmError(`Login refused with HTTP ${post.status} (IP block or rate limit?)`, 'blocked')
    if (post.status >= 500) throw new CrmError(`Login failed with HTTP ${post.status}`, 'blocked')
    await post.arrayBuffer()

    // 3. prove the session is logged in: a protected page must not show the login form
    const check = await paced(() => fetch(new URL('reports.php', base), { redirect: 'manual', headers: cookieHeader(), signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS) }))
    takeCookie(check)
    const html = await check.text()
    if (check.status >= 400) throw new CrmError(`Protected page returned HTTP ${check.status} after login`, 'blocked')
    if (isLoginPage(html) || /captcha/i.test(html)) throw new CrmError('Login was not accepted (wrong credentials, captcha, or the account/IP is blocked)', 'login')
  }

  function buildUrl(path, params) {
    if (!ALLOWED_PATHS.has(path)) throw new CrmError(`Path not on the read-only allow-list: ${path}`, 'guard')
    const url = new URL(path, base)
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v))
    const lowered = decodeURIComponent(url.pathname + url.search).toLowerCase()
    const bad = FORBIDDEN.find((w) => lowered.includes(w))
    if (bad) throw new CrmError(`Refusing URL containing "${bad}"`, 'guard')
    return url
  }

  /** GET one allow-listed page. Returns { status, text, bytes, seconds }. */
  async function get(path, params) {
    const url = buildUrl(path, params)
    if (!sid) throw new CrmError('Not logged in', 'login')
    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now()
      try {
        const res = await paced(() => fetch(url, { redirect: 'manual', headers: cookieHeader(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }))
        takeCookie(res)
        const buf = Buffer.from(await res.arrayBuffer())
        const text = buf.toString('utf8')
        if (isLoginPage(text)) throw new CrmError('Session is no longer logged in', 'login')
        return { status: res.status, text, bytes: buf.length, seconds: (Date.now() - t0) / 1000 }
      } catch (e) {
        if (e instanceof CrmError) throw e
        if (attempt >= 1) throw new CrmError(`Network error on ${path}: ${e?.name ?? 'error'}`, 'network')
      }
    }
  }

  /** Ends the CRM session. Returns true when a follow-up read shows the login form again. */
  async function logout() {
    if (!sid) return false
    try {
      await paced(() => fetch(new URL('logout.php', base), { redirect: 'manual', headers: cookieHeader(), signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS) }).then((r) => r.arrayBuffer()))
      const check = await paced(() => fetch(new URL('reports.php', base), { redirect: 'manual', headers: cookieHeader(), signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS) }))
      return isLoginPage(await check.text())
    } catch {
      return false
    } finally {
      sid = null
    }
  }

  return { login, get, logout, buildUrl }
}
