# PHASE 1 — Master Data, Personnel, Targets, Calendar

Read `PROJECT_SPEC.md` first and use the existing design system (Phase 0.5 components, tokens, DataTable, PageHeader, FilterBar, EmptyState, toasts). Do not change tables from `01_schema.sql`. The new SQL file `supabase/06_personnel.sql` (already applied by the owner in Supabase) provides RPC functions — **all personnel changes MUST go through these RPCs, never direct table writes**, because they update org_month/KPIs atomically:

`hire_rep(p_code, p_name, p_box, p_date)` → rep id · `resign_rep(p_rep, p_last_day)` · `transfer_rep(p_rep, p_new_box, p_first_day)` · `create_manager(p_code, p_name, p_hire)` · `assign_manager(p_manager, p_box, p_first_day)` · `unassign_manager(p_box, p_last_day)` · `resign_manager(p_manager, p_last_day)` · `set_nsm(p_line, p_nsm, p_first_day, p_new_name)` · `rebuild_org_from(p_date)` · and from `07_territory_move.sql`: `move_territory(p_territory, p_new_box, p_first_day)`.
Errors raised by them are human-readable messages — show them as-is in the UI (toast/inline). Semantics: resignation date = LAST day on the box; hire/transfer/assign date = FIRST day on the new box.

Existing facts: lines (CIRA 1/2/3) and the CIRA 1 NSM are already seeded. Each box has at most one rep at a time; each territory belongs to one box at a time within its line; territory names repeat across lines so a territory is identified by (line, name).

## A) Org & Territories page (`/org`) — tabs: Boxes · Territories · Aliases · Import
1. **Import tab (initial load, one-time but safe to re-run):** the owner uploads the workbook `Rep_Data_Entry_System.xlsx` (parsed in the browser with SheetJS; never sent anywhere else, never committed). Use ONLY these sheets/columns and **ignore every other column — in particular any `Password` column must never be read, stored, logged or displayed**:
   - `Managers`: Username→code, Manager Name→name, Status, Hire Date, Resignation Date.
   - `Reps`: Username→code, Name, Line, Box, Status, Hire Date, Resignation Date.
   - `Box_Manager_Map`: Line, Box, Manager Name (blank / "Vacant" / unknown name ⇒ no manager).
   - `Box_Territory_Map`: Line, Box, Territory.
   Steps: parse → **preview report** (counts per entity; warnings listed: boxes that have territories but no rep and no manager; manager names not found in Managers; reps whose Box isn't in the maps; duplicate territory in a line; names that differ only by case/spacing) → owner confirms → write in this order with upserts keyed by natural keys: managers (by code) → boxes (line+name) → territories (line+name, case-insensitive match using the same normalisation as SQL `norm_name`) → box_territory (valid_from 2026-01-01) → reps (by code) → rep_box (valid_from = max(hire date, 2026-01-01); valid_to = resignation date for Resigned reps; skip + report rows that violate the overlap rule) → manager_box (valid_from 2026-01-01). Insert in chunks of 500. Finally call `rebuild_org_from('2026-01-01')` and show the summary. Dates in the file may be Excel serials or ISO strings; hire dates carry a 03:00 time artifact — take the calendar date only (no timezone shifting).
   Do **not** invent defaults for the boxes without rep/manager: leave them Vacant and list them so the owner can decide.
2. **Boxes tab:** table (Line, Box, #Territories, Current rep (or `Vacant`), Current manager (or `Vacant`), NSM, AM/PM target). Row click → side sheet with: territories in the box, rep history timeline, manager history timeline, and quick actions (Hire into box, Resign rep, Transfer, Assign/Unassign manager). Create / rename box. Filter by line, vacancy.
3. **Territories tab:** table (Line, Territory, Box, current rep, manager). Create territory, move territory to another box from a date (never as two client-side writes — use the already-provided RPC `move_territory(p_territory, p_new_box, p_first_day)` from `supabase/07_territory_move.sql` (closes/opens atomically, checks the box is in the same line, rebuilds the org). Include rename.
4. **Aliases tab:** manage `territory_aliases` (alias text → territory, optionally per line); the stored `alias_norm` must be computed with the same normalisation as SQL `norm_name` (lowercase, strip leading "- ", strip trailing "()", collapse spaces/dots/dashes). Show "unresolved territory names" later phases will push here (empty state now).

## B) Personnel page (`/personnel`) — tabs: Reps · Managers · NSMs · History · Vacancies
- **Reps:** table (Code, Name, Line, Box, Status pill Active/Resigned/Vacant-box, Hire date, Resign date). Search by name/code. Actions: **Hire rep** dialog (code, name, box picker filtered to boxes that are vacant on the chosen date, first day), **Resign** (last day), **Transfer** (new box, first day). Row detail: assignment history.
- **Managers:** table with their boxes; create manager; assign to box(es); resign (their boxes become "Vacant manager" and roll up to the NSM); unassign a box.
- **NSMs:** one card per line (CIRA 1/2/3) with current NSM or `Vacant`; "Change NSM" (pick existing or type a new name, first day; or set Vacant).
- **History:** `personnel_events` table (date, type, person, box, notes, who), newest first, filter by type/month.
- **Vacancies:** two lists — boxes with no rep, boxes with no manager — each with the quick action to fill them.
- After every action: toast with result, refetch, and show a small notice "Org and KPIs were rebuilt from <date>".

## C) Targets page (`/targets`) — Call-rate targets per BOX per SHIFT
- Month = the global month picker. Matrix: rows = boxes (filters: line, manager, vacancy), columns = AM target, PM target, plus "Effective since" and a history popover. Show the **effective** target for the selected month = latest `call_rate_targets` row with `effective_from <= month` (use the SQL function `get_target(box, shift, month)` via RPC or an equivalent query — do not re-implement differently).
- Inline edit a cell → upserts a row `(box, shift, effective_from = selected month first day, target)`; label clearly "applies from this month onwards, until changed". Numeric validation (0–50, step 0.5).
- Bulk tools: "Set for all boxes in a line" (AM x, PM y); **Excel import** (columns: Line, Box, AM, PM — preview, then upsert); **Copy previous month** button (inserts rows for the selected month only where the effective value would change — i.e. normally nothing, since targets carry forward; explain this in a tooltip).
- Vacant boxes are shown dimmed (targets can still be set).
- After saving, call `refresh_month(selected month)` and report success.

## D) Calendar page (`/calendar`)
- Month grid for the selected month, two rows per day (AM, PM) coloured by status: Working · Weekly off (Fri; PM also Thu) · Public holiday. Use the SQL function `working_days(shift, from, to)` via RPC for the truth (do not duplicate the weekday rules in two places; a tiny client-side mirror used only for painting is OK if you verify it matches the RPC and add a comment).
- Header cards: AM working days, PM working days, holidays count for the month.
- **Holidays manager:** table of `holidays` (date, name) with add / edit / delete, add a range (e.g. a 3-day Eid) as separate rows. After any change: call `refresh_month` for every affected month (show progress) and toast the result.

## Quality bar
Design-system consistency, skeletons + empty/error states, keyboard accessible dialogs, all lists paginated (PostgREST 1000-row cap), `npm run build` + lint pass. Admin-only routes. No secrets, no data files in git (add `*.xlsx` to .gitignore if not already). Commit, then give me the push commands and a manual test checklist covering: import with the real workbook, hire/resign/transfer a rep, assign/unassign a manager, set an NSM, edit a target, add a holiday and see working days change.

Stop after Phase 1.
