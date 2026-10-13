# SFE Hub — Master Spec (read this first, every phase)

Standalone SFE / CRM analytics system for a pharma field force (Medical Reps → District Managers → National Sales Managers → Company; 3 lines: CIRA 1/2/3, ~82 reps).
Owner = the only Admin for now (SFE analyst). Later: DM portal and Rep portal. Phase order is in §9.
UI language: English labels. The owner chats in Egyptian Arabic, but the app is English.

## 1. Stack (fixed — do not change)
- **Database/Auth:** Supabase (PostgreSQL + Auth + RLS). Project URL `https://rmgqlgirfrqwrcxgeamy.supabase.co`. Publishable (anon) key goes in `VITE_SUPABASE_ANON_KEY`.
- **Frontend:** Vite + React + TypeScript, React Router (**HashRouter**, GitHub Pages), Tailwind CSS, `@supabase/supabase-js`, `xlsx` (SheetJS) for browser-side Excel parsing, a chart lib (Recharts). **Also allowed (design system, Phase 0.5):** shadcn/ui-style components on Radix primitives, `lucide-react`, `class-variance-authority`, `clsx` + `tailwind-merge`, `@tanstack/react-table`, `cmdk`, `sonner`, `@fontsource-variable/inter` + `@fontsource-variable/jetbrains-mono` (self-hosted, no external CDN), `date-fns`, Recharts.
- **Hosting:** GitHub Pages (static) via GitHub Actions. Keep-alive: scheduled GitHub Action calling `rpc/ping`.
- **No custom backend server.** All logic = browser + SQL functions/views.

## 2. Security rules (non-negotiable)
1. The repo is PUBLIC. Never commit data files, Excel files, passwords, or any **secret / service_role** key. Only the URL + publishable key (public by design) are allowed in build config.
2. Security = Supabase Auth + RLS (already written). Never bypass RLS from the frontend. Sign-ups are disabled; the admin creates users in the Supabase dashboard (later: an in-app invite flow via an Edge Function — separate phase).
3. Roles (`user_roles`): `admin` (everything), `dm` (own team), `rep` (own data). The UI must hide admin pages from non-admins, but RLS is the real protection.
4. Add `.gitignore` entries for `*.xlsx`, `*.xls`, `*.csv`, `.env*` (except `.env.example`).

## 3. Database (already built — source of truth)
Files in `/supabase/` of the repo, run in order in Supabase SQL Editor: `01_schema.sql`, `02_functions.sql`, `03_rls.sql`, `04_seed.sql`, `05_ping.sql`.
**Do not redesign tables.** If a change is needed, propose it as a new numbered migration file `06_...sql`, never edit applied files.

Key ideas:
- Dimensions have integer ids; fact tables store ids only (small + fast). Months are `DATE` = first day of month.
- Org history is effective-dated: `rep_box`, `manager_box`, `box_territory`, `line_nsm` (`valid_from`, `valid_to` NULL = open). DB blocks overlaps (one rep per box, one box per rep, one box per territory).
- `org_month` = flattened org at month-end: (month, territory) → line, box, rep, manager, NSM. **Vacant box ⇒ `rep_id` NULL. Vacant manager ⇒ `manager_id` NULL (sales roll up to the NSM).**
- Summaries are pre-computed by SQL: `rep_day_shift`, `rep_month_kpi`. Dashboards read these, not raw visits.
- After ANY upload for month M run: `select refresh_month('M-01')` (idempotent) — via `supabase.rpc('refresh_month', { p_month })`.
- Views (security_invoker): `v_sales_by_box/manager/nsm/company`, `v_missing_days`, `v_dq_visits_unmatched`, `v_dq_visits_on_nonwork`, `v_sales_unmapped`. `list_changes(p_month)` returns added/removed/transferred/freq_changed doctors vs previous month.
- `upload_batches` tracks every upload (kind, months, rows loaded/rejected). Each fact row has `batch_id`, so an upload can be undone/replaced per month.

## 4. Business rules (implemented in SQL — the UI must display them consistently)
- **Working days:** AM = every day except Friday and public holidays. PM = every day except Thursday, Friday and public holidays. Holidays are in `holidays` (admin page).
- **Actual days (per shift)** = working days − leave − office work − activity (slots with status worked or missing).
- **Slot status priority:** leave > office_work > activity > worked (visits>0) > missing. **Missing day** = a working slot with none of them.
- **Leaves:** inclusive date range (7→7 = 1 day, 7→8 = 2 days); shift AM / PM / FULL applied per day; only `Approved` counts; intersected with the working calendar. A person can have PM on day 7 and FULL on day 8 as two rows.
- **Call Rate** = visits ÷ actual days, **AM and PM separately**. Target is per **box per shift** (`call_rate_targets`, latest `effective_from` ≤ month applies).
- **Coverage** = list doctors visited ≥1 ÷ list doctors. **PCF** = valid_visits ÷ target_visits, where target_visits = Σ Freq over the rep's C/PC list doctors and valid_visits = Σ min(visits_i, freq_i) per doctor (visits to non-list doctors are in neither).
- **Ach CR** = total visits ÷ (target_AM × actual_AM + target_PM × actual_PM). **Total KPI** = PCF×50% + Coverage×35% + AchCR×15%.
- **Visit types:** `Single` or `Double` (with manager). A Double appears twice in the file (rep row + manager row): rep gets 1 visit, manager gets 1 visit, **company total = count(distinct visit_key)**. Also `visit_root` Planned vs Direct (important KPI: planned vs direct split).
- **Sales:** territory-level only. Key = (Line, Territory). Roll-up: Territory → Box → Rep / Manager → NSM → Company via `org_month`. Manager sales = whole team incl. vacant territories. Vacant box = shown as `Vacant – <box name>`, has no KPIs, its sales go to the manager. Vacant manager = `Vacant – <region>`, sales go to the NSM.
- **Resignation / hire mid-month:** box becomes Vacant from the resignation date; days are counted only while the rep covers the box (`rep_box` dates). Handled from the Personnel page, which writes `personnel_events` + updates `rep_box` / `manager_box` / `reps`.
- Names must be normalised before matching (`norm_name()` in SQL; same logic in JS: lowercase, strip leading "- ", strip trailing "()", collapse spaces/dots/dashes).

## 5. Excel upload specs (browser-side parse → staging preview → load)
General flow for every upload: choose file → parse with SheetJS → **map/validate columns** → show a preview report (rows, months detected, rejected rows + reason) → user confirms → insert in chunks (≈1000 rows) with a new `upload_batches` row → for already-loaded months ask "Replace month X?" (delete old rows of that month/kind first) → call `refresh_month` for each affected month → show summary. Dates: accept Excel serial numbers AND real dates AND strings; store as plain `DATE` (no timezone shifting; Cairo). Shift: `AM`/`PM`; leaves/OW/activities also `FULL` (normalise `Full`→`FULL`).

| Upload | Columns (as in the company system export) | Month comes from | Notes |
|---|---|---|---|
| **Target List** | Line, USERNAME, District, Division, Brick, Account Type, Account ID, Account Name, Doctor Id, Doctor Name, Speciality, Class, Emp. Code, Emp. Name, Active From, DM, No of Visits, Freq., **Month** | `Month` column (owner adds it; historical Jan–Sep in ONE sheet) | Upsert `doctors` by (Account ID, Doctor Id); one `list_snapshot` row per (month, doctor); `Emp. Code` → rep; `Freq.` = target visits. Division text may be corrupt in old data — store as text. After load show `list_changes` (added/removed/transferred). |
| **Visits** | Territory, CODE, SHIFT, Visit Type, Acc. Type, **Account ID, Doctor ID**, Acc. Name, Doctor Name, Date, Members, Notes, Visit Root, Source (ignored: Link status, Time, Spec., Class, No. of Docs, Visit ID, Brick, Owner Name) | `Date` | Link key = **Account Type + Account ID + Doctor ID** against the Target List tables (not names). Visits without Doctor ID or whose IDs are not found are *unlinked*: stored as visits outside the list — counted in Total Visits / Call Rate, no Coverage / PCF (see Data Quality → Visits not linked). Upload finish runs one request per step: `finish_upload_nr` → `process_visits_month` per month → `refresh_month` per month (never the all-in-one `finish_upload`), with per-step retry. CODE is a rep OR manager code. Compute `visit_key` (Double: same key for rep+manager rows). **Ignore `No. of Docs`.** Dates mix Excel serials and datetimes. |

**KPI by Rep report (Reports → KPI by Rep).** One row per rep from `v_kpi_rep` (PM shift only = Clinic + Poly Clinic): Coverage = covered ÷ list, PCF = valid ÷ target visits (target = Σ Freq of the C/PC list; a Target Visits column sits before Valid Visits; roll-ups divide the sums), Ach CR = total visits ÷ expected (target PM × days PM), Total KPI = PCF×50% + Coverage×35% + Ach CR×15%, Call Rate PM = visits PM ÷ days PM (AM call rate is information only). The user can **exclude reps** (picker or per-row button); excluded reps leave the table and every total, and the choice is kept per user in `localStorage`. Totals, roll-ups by DM and by Line are recomputed in the app from sums of the remaining reps (never an average of ratios). Total KPI colour uses `kpiTone` like the Dashboard. Export includes what is on screen (plus an Excluded column when excluded reps are shown).

**Pharmacy shift.** `visits.shift_group` = `AM` | `PM` | `PHARMACY` (Acc. Type `P` → PHARMACY; `C`/`PC` = PM; AM Center / `A` / `H` = AM, set in the file). Pharmacy is **outside** Total Visits, Call Rate AM/PM/Total, Ach CR, Coverage, PCF and the Total KPI. It is reported separately on the Call Rate report as Field Days (`(field_am + field_pm) / 2`), Pharmacy Visits and Pharmacy Call Rate (`visits_pharmacy / field_days`). Roll-up rows (Total / Manager / Line / Company) divide the sums, never average rep rates. The Call Rate report has an `All | AM | PM | Pharmacy` shift filter; Coverage / PCF hide it (pharmacy does not apply). Uploads → Months shows "Pharmacy visits: N" per month.
| **Sales** | CODE, MONTH, Territory, Product, MD Name, S. Units, T. Units, % Units, S. Value, T. Value, % Value | `MONTH` (a month-END date, e.g. 2026-09-30 ⇒ September; derive month key carefully) | No Line column: resolve Territory from CODE (rep's line, or manager's boxes' lines) + normalised name + `territory_aliases`. Unresolvable rows → rejected list. S = actual, T = target. |
| **Leaves** | CODE, Line, Employee, Type, Shift, Start Date, End Date, Notes, STATUS, ... (ignore Flow/DIRECT MANAGER/APPROVAL DATE/Insertion Date) | Start/End dates | Store as-is (expansion happens in SQL). Only `Approved` counts. |
| **Office Work** | CODE, Type, Shift, Date, Members, Comments | `Date` | |
| **Activities** | CODE, Type, Shift, Date, Time, Members, Comments | `Date` | `Time` is a fraction of day → store `at_time`. |
| **Coaching** | defined in its own phase | | |

## 6. Admin pages (final scope)
Dashboard (company → line → manager → rep drill-down) · **360° Rep/Manager/Box view with search** (hire date, visits, days worked, leave, OW, activity, missing days, KPIs, sales, list changes, planned vs direct, AM/PM call rate) · Uploads (6 types + history + undo) · **Personnel** (hire / resign / transfer reps, assign managers, NSM per line) · Org & Territories (boxes, territories, aliases) · **Targets** (call rate per box per shift) · Calendar (holidays, working days per month/shift) · Data Quality (unmatched visits, visits on leave, unmapped sales, missing days) · Users (later).

## 7. UI guidelines
Professional admin look: left sidebar, top bar with month picker (default = latest month with data), KPI cards, sortable/filterable tables with CSV export, charts, skeleton loaders, empty states, responsive. Light/dark optional. Every table query must filter by month and select only needed columns (performance): never fetch raw visits to compute KPIs in the browser.

## 7b. Design system
- Tokens live as CSS variables in `src/index.css` (light + dark; theme persisted in localStorage, default = system). Use semantic Tailwind colours (`bg-card`, `text-muted-foreground`, `text-success`...), never raw hex in components.
- One accent (indigo). Radius 10px cards / 8px controls; 4px spacing grid; 1px low-contrast borders; shadows only on popovers/menus.
- Numbers use tabular figures (`.tnum`). KPI status colour comes only from `kpiTone(value, target)` (>=100% green, 80-99% amber, <80% red).
- Reusable components: `src/components/ui` (primitives) and `src/components/app` (PageHeader, KpiCard, DataTable, ChartCard, FilterBar, ...). Mock data appears only on `/design` and must carry a "Sample data" badge.
- Everything keyboard-accessible with focus rings; respect `prefers-reduced-motion`.

## 8. Engineering rules
- TypeScript strict. Small components. Data access in `src/lib/api/*.ts`. Supabase pagination: PostgREST returns max 1000 rows per request — page with `.range()` or use SQL views/RPC.
- Errors shown to the user in plain English; never swallow errors silently.
- Each phase ends with: it builds (`npm run build`), deploys, and a short manual test checklist the owner can run.
- Do not add libraries beyond §1 without asking.

## 9. Phases
0 Foundation (this prompt first) → 1 Master data & Personnel & Targets & Calendar → 2 Target List upload + change detection → 3 Visits upload + data quality → 4 KPI dashboard (reads `rep_month_kpi`) → 5 Leaves / OW / Activities upload + Missing Days → 6 Sales upload + roll-up reports → 7 360° view → 8 Coaching → 9 DM & Rep portals → 10 migrate the CRM Requests workflow from the old Google Apps Script system (out of scope until then).

## 10. Known data facts (for realism in tests)
~82 reps (79 active), 90 boxes in maps (8 boxes exist only in the territory map with no rep/manager yet — treat as Vacant), 444 territories across 3 lines (names repeat across lines), 17 managers, NSM of CIRA 1 = Botros Alfons (CIRA 2/3 NSM vacant). Example volumes: list ≈17k rows/month, visits ≈10k/month, sales ≈900 rows/month.
