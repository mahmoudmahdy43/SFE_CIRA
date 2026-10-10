# PHASE 5 — Leaves / Office Work / Activities uploads + Missing Days

Read `PROJECT_SPEC.md` (§4 leave rules, §5 upload specs). **Reuse the Phase 2/3 generic upload wizard** — add three `UploadTypeConfig`s (Leaves, Office Work, Activities) and enable their cards (Sales stays "Coming soon"). Existing design system. Copy `supabase/11_absence_upload.sql` into the repo (already applied by the owner; do NOT edit). Also copy the owner's updated `10_visits_upload.sql` if it differs. All logic is in SQL; the browser parses, validates lightly, sends chunks.

## RPCs (admin-only)
- `start_upload(kind, file)` with kind `leaves` | `office_work` | `activities`.
- `clear_leaves_range(from,to)` (deletes by START date), `clear_office_work_range(from,to)`, `clear_activities_range(from,to)` → rows deleted. Used only when the owner chooses Replace.
- `load_leaves_chunk(batch, rows)` keys: `code, leave_type, shift, start_date, end_date, status, notes`.
- `load_office_work_chunk(batch, rows)` keys: `code, ow_type, shift, day, members, comments`.
- `load_activities_chunk(batch, rows)` keys: `code, act_type, shift, day, at_time, members, comments`.
- All return `{loaded, rejected_count, rejected:[{i, reason}…200]}`; chunks of 2000.
- `finish_upload(batch,total,loaded,rejected,months[])` → refreshes KPIs. **Months = every month touched**: for office work/activities the months of `Date`; for leaves every month between `Start Date` and `End Date` (a leave 30 Oct → 2 Nov touches Oct and Nov).
- `undo_batch(batch)` already supports these kinds.
- Views: `v_leaves_months` (month, rows, approved, not_approved, reps, first_day, last_day), `v_office_work_months`, `v_activities_months` (month, rows, reps, days, first_day, last_day), `v_dq_absence_without_box` (kind, id, rep_id, day, shift, type), plus existing `v_missing_days`, `v_dq_visits_on_nonwork`.

## Columns (tolerant header matching as before)
- **Leaves**: required `CODE`, `Shift`, `Start Date`, `End Date`, `STATUS`; optional `Type`, `Notes`. Ignored: `Line`, `Employee`, `Flow`, `DIRECT MANAGER`, `APPROVAL DATE`, `Insertion Date`.
- **Office Work**: required `CODE`, `Shift`, `Date`; optional `Type`, `Members`, `Comments`.
- **Activities**: required `CODE`, `Shift`, `Date`; optional `Type`, `Time`, `Members`, `Comments`. `Time` is a fraction of a day (0.9458 = 22:41:00) → send `at_time` as `HH:MM:SS` (null if blank).
- **IMPORTANT — CODE column is an Excel formula in the owner's files (XLOOKUP to an external workbook).** Read the **cached value** (SheetJS `cell.v`, not the formula `cell.f`). If a CODE cell has no cached value / is an error (`#REF!`, `#N/A`) → error row "CODE missing/formula error" and count them in the preview with a warning ("N rows have no usable CODE — paste values in Excel first"). Never evaluate formulas.
- Shift: `AM`/`PM`/`Full` (any case; also `Full Day`) → send as-is trimmed; SQL normalises to `FULL`. Anything else is rejected by SQL.
- Dates: Excel serial numbers (integer part) / real dates / text → `YYYY-MM-DD`, calendar parts only, no timezone shift (same helper as Visits). Leave `Start/End` handled the same.
- Leave `STATUS`: send as written. **Only `Approved` counts in KPIs** — in the preview show counts per status and a warning "N rows are not Approved and will be stored but ignored".

## Wizard per type
1. File → parse in worker → preview: rows, date range / months touched, distinct CODEs, per-type counts (leave/OW/activity types), per-shift counts (AM/PM/Full), per-status counts (leaves), rows per day (small bar chart), **unknown CODEs** (check client-side against `reps` + `managers` codes: code + row count), bad shift/date/formula-CODE rows, 20-row sample.
2. Safety: for each month touched, show existing rows from the matching `v_*_months` view vs rows in file; warn if the visits/list for that month isn't loaded (informational). Leaves with `end_date` in a later month → show "touches 2 months".
3. Decide per detected range: **Replace dates <first>–<last>** (explicit, default off when data exists) or **Skip**. New → load. Same wizard behaviour/phases/retry/undo as Visits.
4. Load: `start_upload` → clear ranges → chunks → `finish_upload(months touched)`. Progress phases: loading rows / refreshing KPIs.
5. Result: loaded / rejected (CSV with Excel row numbers + reason); per month card (rows, reps, days); notes "KPIs refreshed for N months"; links to Data Quality (Missing days). Undo / Upload another.

## Data Quality (`/data-quality`) additions
- Keep Missing days (per rep summary + day drill-down, line/manager filters, CSV) — now that leaves/OW/activities exist, make sure it clearly shows the status mix per rep: worked / leave / office work / activity / missing (AM and PM separate).
- New section **Absence without a box** from `v_dq_absence_without_box` (resolve rep codes/names with chunked lookups).
- Existing **Visits on non-working slots** now becomes meaningful (visits on leave days) — keep.

## Months & changes tab
Add three blocks (Leaves / Office Work / Activities) from the new views: month cards (rows, reps, days or first–last day; for leaves approved vs not approved). Informational "partial month" flag like Visits.

## Tests (synthetic workbook generated by a script, not committed)
Formula CODE cells with cached values and with errors; serial dates with time artifacts; `Full`/`full day`/`AM`/`PM`/bad shift; leave spanning two months → months touched = 2; end before start; non-Approved status counts; Time fraction → `HH:MM:SS`; 2001-row chunk boundary; header tolerance; missing-column error; one-range replace. `npm run build` + lint pass. Commit and push, then give me a manual checklist: upload the owner's real VACATIONS.xlsx (13 rows, 2026-10-03→10-07), OW.xls.xlsx (22 rows, Oct 1–7), ACTIVITES.xls.xlsx (4 rows); replace flow; wrong CODE; Undo; Missing days after loading (Oct 7: reps with visits and no OW/leave are `worked`); KPI refresh.

Stop after Phase 5.
