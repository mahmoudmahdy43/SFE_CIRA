# PHASE 4 — KPI Dashboard (company → line → manager → rep drill-down)

Read `PROJECT_SPEC.md` (§3 KPIs, §7 UI) first. Copy `supabase/13_kpi_views.sql` into the repo (already applied by the owner; do NOT edit). Use the existing design system, tables (tanstack), charts (Recharts), CSV export, global month picker. **The browser never computes KPIs from raw rows; it only reads the views below.** Ratios shown at any level come from the view (computed from sums, never averages of ratios).

## Data sources (read-only, RLS applies)
- `v_kpi_company(month, …)`, `v_kpi_line(month, line_id, …)`, `v_kpi_manager(month, line_id, manager_id, …)`, `v_kpi_rep(month, rep_id, box_id, line_id, manager_id, nsm_id, …)`.
- Common columns: `reps, list_doctors, covered_doctors, total_visits, valid_visits, planned_visits, direct_visits, days_am, days_pm, missing_am, missing_pm, leave_days, ow_days, activity_days, visits_am, visits_pm, expected_visits, coverage, pcf, ach_cr, call_rate_am, call_rate_pm, total_kpi`. `v_kpi_rep` also has `target_am, target_pm`.
- Names via batched lookups (chunked `in` filters): `reps(code,name)`, `managers`, `lines`, `boxes`.
- Company **unique visits** (Double counted once) comes from `v_visits_months` (do not use sum of rep visits for that card). Note: rep KPIs use rep rows only.
- Vacant boxes have no KPI rows → show a "Vacant boxes" note with a count from `org_month` (rep_id is null) and link to Personnel → Vacancies.

## Dashboard page (`/`)
1. **Header:** month picker (default = latest month with KPIs), small line filter chips (All · CIRA 1 · CIRA 2 · CIRA 3).
2. **KPI cards (company or selected line):** Total KPI, Coverage, PCF, Ach CR, Call Rate AM, Call Rate PM, Total visits (rep) · Unique company visits, Planned vs Direct (donut + %), Missing days (AM+PM) with link to Data Quality → Missing days, Leave / OW / Activity days. Each card shows the formula in a tooltip and "n/a" (not 0) when the denominator is null.
3. **Comparison charts:** bar chart of Total KPI per line; stacked bar for status mix; trend line across months (Total KPI, Coverage, PCF, Ach CR) from `v_kpi_company` over all months that have data.
4. **Drill-down table:** Line → Manager → Rep with expandable rows (or breadcrumb navigation). Columns: name/code, reps, list doctors, coverage, PCF, ach CR, call rate AM/PM (+ target AM/PM at rep level), total visits, planned %, missing AM/PM, total KPI. Sortable, searchable, column toggle, CSV export. KPI cells use a calm color scale (not rainbow) with accessible contrast; null → "—". Managers with `manager_id` null = "Vacant manager".
5. **Rep row click** opens a side drawer (the future 360° page will be richer): the rep's numbers for the month + a small table of the last months from `v_kpi_rep`.
6. **Honest empty/partial states:** if the month has visits for fewer days than its working days, show a visible banner "Partial month: visits cover X of Y working days — KPIs are provisional". If call-rate targets are missing for some boxes, show "Ach CR needs targets for N boxes" with a link to Targets.

## Engineering
- Paginate PostgREST reads (1000-row limit); reps ≈ 82 so `v_kpi_rep` for a month is small. Cache by month in React Query (or equivalent), no refetch storms.
- Keep the page fast: skeletons, no layout shift; works on phone width (cards stack, table scrolls).
- Number formats: percentages with 1 decimal, call rate with 2 decimals, thousands separators.
- Never log data; no sample data in git.
- Tests: pure helper functions (formatting, null handling, tree building) with a small unit test script on synthetic rows; `npm run build` + lint pass. Commit and push, then give me a manual checklist: month with the partial October data (visits 1 day, leaves/OW/activities loaded), line filter, drill-down, null handling when targets are missing, CSV export, empty month.

Stop after Phase 4.
