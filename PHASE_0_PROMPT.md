# PHASE 0 — Foundation (send this to Antigravity together with PROJECT_SPEC.md and the /supabase SQL files)

You are building Phase 0 of "SFE Hub". **First read `PROJECT_SPEC.md` completely** and follow it (stack, security rules, DB). The Supabase database is ALREADY created and has the schema from `/supabase/01..05*.sql` applied. Do not change the database.

## Goal
A deployed, secure, empty-but-professional web shell: login, role-aware layout, placeholder pages, connection test, CI deploy to GitHub Pages, and a keep-alive job. No business features yet.

## Deliverables

### 1. Repo structure
```
/ (repo root)
  .github/workflows/deploy.yml
  .github/workflows/keepalive.yml
  supabase/01_schema.sql ... 05_ping.sql     (copy the provided files, do not edit)
  PROJECT_SPEC.md                            (copy as provided)
  src/ ...  index.html  vite.config.ts  package.json  tailwind config
  .env.example   .gitignore   README.md
```
`.gitignore` must exclude `node_modules`, `dist`, `.env*` (except `.env.example`), `*.xlsx`, `*.xls`, `*.csv`.

### 2. App (Vite + React + TypeScript + Tailwind + React Router HashRouter)
- `src/lib/supabase.ts`: create the client from `import.meta.env.VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Fail loudly with a clear on-screen message if they are missing.
- **Auth:** email + password login page (no sign-up, no "forgot password" yet). Session persisted; logout button. `AuthProvider` context exposing `session`, `role` (read the user's row from `user_roles` after login), `loading`.
- **Route guard:** unauthenticated → `/login`. Logged in but no row in `user_roles` → friendly "Your account has no role yet — contact the admin" screen with a logout button. `admin` → full app. `dm` / `rep` → a placeholder "Portal coming soon" page only (portals are a later phase).
- **Layout (admin):** left sidebar + top bar. Sidebar items (all routes exist, each a clean placeholder page with title, short description, and an empty-state card): Dashboard, 360° View, Uploads, Personnel, Org & Territories, Targets, Calendar, Data Quality, Settings. Top bar: **month picker** (global state, stored in context; default = current month, as `YYYY-MM-01`), user email, logout.
- **Dashboard page (the only functional one):** a "System status" card that shows (a) Supabase connection OK (call `supabase.rpc('ping')`), (b) logged-in user email + role, (c) row counts of `reps`, `boxes`, `territories` (use `select('id', { count: 'exact', head: true })`). Show friendly errors if a call fails.
- Design: modern, clean, professional (neutral palette, one accent colour, rounded cards, good spacing, readable tables), responsive down to tablet. English UI.
- Quality: TypeScript strict, no `any` unless justified, ESLint passing, `npm run build` passing.

### 3. GitHub Pages deploy (`deploy.yml`)
- Trigger on push to `main` and manual dispatch. Node 20, `npm ci`, `npm run build`, upload `dist` and deploy with the official `actions/upload-pages-artifact` + `actions/deploy-pages`.
- `vite.config.ts` must set `base` correctly for a project page (`/<repo-name>/`) — read the repo name from an env var `VITE_BASE` with a sensible default, and document it in README.
- Build-time env comes from **GitHub repository Variables** (not secrets): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. (They are public by design; the real protection is RLS.)

### 4. Keep-alive (`keepalive.yml`)
- Scheduled every 3 days (`cron`) + manual dispatch.
- Does `curl -fsS -X POST "$SUPABASE_URL/rest/v1/rpc/ping" -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{}'` using the same two repository Variables. Fail the job if the response is not HTTP 200.

### 5. README.md (short, for the owner, non-developer friendly)
Exact click-by-click steps to: create the GitHub repo (public), push the code, add the two repository Variables (Settings → Secrets and variables → Actions → Variables), enable Pages (Settings → Pages → Source: GitHub Actions), run the deploy workflow, open the site URL, and log in with the admin account. Plus a troubleshooting list (blank page, "missing env", login fails, no role).

## Variables to document (do NOT hard-code secrets)
- `VITE_SUPABASE_URL` = `https://rmgqlgirfrqwrcxgeamy.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = the project's publishable key (the owner will paste it; it starts with `sb_publishable_`)
- Never use or ask for the `secret` / `service_role` key anywhere.

## Acceptance checklist (include it at the end of your answer)
1. `npm run build` succeeds locally.
2. Deployed site opens at the GitHub Pages URL with no blank page; refresh on any route works (HashRouter).
3. Login with the admin account works; wrong password shows an error; logout works.
4. Dashboard "System status" shows connection OK, role = admin, and counts (reps = 0 until data is loaded, boxes/territories = 0; lines/NSM seed exist).
5. A user without a `user_roles` row sees the "no role" screen.
6. `keepalive.yml` can be run manually and returns success.
7. No secret key or data file in the repo.

Stop after Phase 0. Do not start Phase 1.
