# PHASE 2 — Uploads framework + Monthly Target List upload + List changes

Read `PROJECT_SPEC.md` first (esp. §2 security, §5 upload specs, §8). Use the existing design system. The Supabase functions in `supabase/08_list_upload.sql` are already applied by the owner; copy that file into the repo's `supabase/` folder (do not edit it). **All heavy logic is in SQL — the browser only parses Excel, validates lightly, and sends chunks.** Never write to `doctors` / `list_snapshot` directly from the client.

## RPCs you will use (all admin-only)
- `start_upload(p_kind text, p_file text)` → batch id
- `clear_list_month(p_month date)` → rows deleted (use only when the owner chose "Replace" for a month)
- `load_list_chunk(p_batch bigint, p_rows jsonb)` → `{loaded, rejected_count, rejected:[{i, reason}…first 200]}` where `i` is the 0-based index inside the chunk. Row keys (exact): `month` (`YYYY-MM-DD`, first of month), `line`, `emp_code`, `account_id`, `doctor_id`, `account_name`, `doctor_name`, `account_type`, `speciality`, `class`, `brick`, `division`, `freq` (number), `active_from` (`YYYY-MM-DD` or null). Send chunks of **2000 rows**.
- `finish_upload(p_batch, p_total, p_loaded, p_rejected, p_months date[])` → rebuilds org/KPIs for those months
- `undo_batch(p_batch)` → deletes everything loaded by that batch and refreshes the months
- `list_changes(p_month date)` → rows `{change_type: added|removed|transferred|freq_changed, doctor_id, from_rep, to_rep, old_freq, new_freq}` comparing the month with the previous month
- View `v_list_months` (month, rows, reps, doctors, total_freq, last_batch) and table `upload_batches`.

## 1) Uploads page (`/uploads`) — tabs: Upload · History · Months & changes
**Upload tab:** a card grid of the 6 upload types (Target List, Visits, Sales, Leaves, Office Work, Activities). **Only Target List is active in this phase**; the others are visibly "Coming soon" (disabled, with a short description each from PROJECT_SPEC §5). Build the wizard as a **generic, reusable framework** (`src/features/uploads/…`: `UploadWizard`, step components, a `UploadTypeConfig` interface with `columns`, `parseRow`, `validateRow`, `loadRows`) so later phases only add a config. Keep the code typed and tested by running it on a synthetic workbook (no real data in git).

### Wizard steps — Target List
1. **Choose file** (drag & drop or picker; `.xlsx`/`.xls`). Also a **"Download template"** button that generates an empty `.xlsx` with the exact headers in the browser.
2. **Parse in a Web Worker** (SheetJS) so the UI never freezes on files with 150k+ rows; show a progress indicator. Sheet picker if several sheets (default = first). Header matching is tolerant: case-insensitive, trims spaces/dots (`Freq.`, `freq`, ` Freq `). Required: `Month`, `Line`, `Emp. Code`, `Account ID`, `Doctor Id`, `Doctor Name`, `Freq.`. Optional/used: `Account Name`, `Account Type`, `Speciality`, `Class`, `Brick`, `Division`, `Active From`. **Ignored on purpose:** `USERNAME`, `District`, `DM`, `Emp. Name`, `No of Visits`. If a required column is missing, stop with a clear message listing found vs expected headers.
3. **Value normalisation (must be exact):**
   - `Month` may be an Excel date serial, a real date, `YYYY-MM`, `YYYY-MM-DD`, or text like `Oct-2026`/`October 2026` → always normalise to the **first day of the month** as a plain `YYYY-MM-DD` string. Never use local-time `Date` conversion that can shift a day (use the serial number arithmetic / UTC parts).
   - `Account ID`, `Doctor Id`: may be numbers → convert to strings without `.0`/exponent; keep leading zeros if the cell is text.
   - `Freq.` → integer ≥ 0 (blank = 0, non-numeric = error row).
   - `Active From` → date string or null. Strings are trimmed; empty → null.
   - **Division corruption:** if a `Division` cell is a date type (Excel auto-converted something like "1-2"), use the cell's displayed text (`cell.w`) instead of the date and count these rows for a warning ("N Division values looked like dates — original text kept as displayed").
4. **Preview report (before anything is written):** total rows; **months detected** with row counts; distinct reps (`Emp. Code`) and doctors; duplicates (same Account ID + Doctor Id in the same month — last occurrence wins, show count); rows with blank required values; **unknown rep codes** (fetch `reps` once and check client-side — list the codes and how many rows each); lines not in `lines`. Show a sample table of the first 20 rows. Show an overview comparing each detected month with what already exists (`v_list_months`: rows now vs rows in file).
5. **Decide per month:** for months that already exist choose **Replace** (default off — require an explicit choice) or **Skip**; new months are loaded. Show a final summary line ("Load 9 months · 156,159 rows · replace Oct 2026") and a confirm button. Rows that fail client-side validation are excluded and listed, not silently dropped.
6. **Load:** `start_upload('list', fileName)` → for each Replace month `clear_list_month` → for each chunk call `load_list_chunk` (sequentially, with a progress bar showing rows/total and current month; retry a failed chunk once; on a hard failure stop and show where it stopped, and offer **Undo this batch**) → `finish_upload` with the months actually loaded. The upload must be safe to cancel before step 6 (nothing written).
7. **Result screen:** loaded vs rejected counts; rejected rows table (Excel row number = chunk offset + `i` + header offset, reason) with **Download rejected rows as CSV**; then for each loaded month a **List changes** summary using `list_changes(month)` (counts of added / removed / transferred / freq changed) with a "View details" link to the Months & changes tab; a note "Org and KPIs refreshed for N months"; buttons: Undo this upload · Upload another.

## 2) History tab
Table from `upload_batches` (newest first, paginated): date, type, file name, months, loaded / rejected, status pill (loaded / deleted), who (first 8 chars of user id is fine). Row action **Undo** (confirm dialog explaining exactly what will be removed; calls `undo_batch`; refetch). Deleted batches stay in the list, greyed.

## 3) Months & changes tab
- Card/table from `v_list_months`: month, rows, reps, doctors, total target visits; click a month to open its details.
- **List changes:** pick a month → call `list_changes(month)`; show four count cards (Added · Removed · Transferred · Freq changed) and a DataTable of the details. Resolve doctor names and rep codes/names with batched lookups (`doctors`, `reps` by id — chunk the `in` filters; PostgREST URL limit!) and show: doctor, account, change type pill, from rep → to rep, old → new freq. Filters by type and by rep; CSV export; empty state when the month has no previous month ("First month loaded — nothing to compare").

## Engineering notes
- Memory/speed: process rows in the worker, transfer typed arrays/JSON in slices; never keep the raw sheet and all derived rows twice if avoidable. A 9-month file (~156k rows × 19 cols) must work in a modern browser.
- PostgREST returns at most 1000 rows per request: paginate everything you read.
- The Excel file never leaves the browser except as the cleaned row chunks sent to the RPCs; never log row contents; never commit sample data (`*.xlsx` stays in `.gitignore`).
- All errors from RPCs are shown as written (plain English).
- Tests you must run yourself on a **synthetic** workbook generated by a script (not committed): month parsing (serial, `YYYY-MM`, `Oct-2026`, real date), id normalisation, duplicate handling, header tolerance, missing-column error, Division-as-date handling, chunking boundaries (e.g. 2001 rows → 2 chunks), and the error-row offsets.
- `npm run build` + lint pass. Commit and give me the push commands plus a manual test checklist covering: download template, upload the owner's real October list after adding a `Month` column (expect 17,351 rows, 77 reps), preview numbers, replace flow, a deliberately wrong rep code, undo, History, List changes with two months loaded.

Stop after Phase 2.
