# CRM discovery (Phase 6A)

Read-only investigation of the company CRM (`https://pulpo-cira.cloud/2026/crm/`, "PulpoPharma CRM", developed by IT Gates)
to see how a nightly job can replace the manual `.xls` uploads. Done on 2026-10-13 from a browser session logged in by the user
(administrator account type). **No credentials appear in this file.** Only GET requests were sent, about 25 in total, one export
of a full month. Nothing was created, edited or deleted.

Legend: **observed** = seen in a real response; **not tested** = deduced or left open.

## 1. Login

| Item | Finding |
|---|---|
| Login page | `GET /2026/crm/` (or `home.php`, which shows the login form when there is no session) |
| Mechanism | **Plain HTML form, server-side PHP.** `POST /2026/crm/index.php`, no `onsubmit` JavaScript |
| Fields | `uname` (text), `upass` (password), `atype` (`admin` / `user` / `hr`), `page` (`0` Home, `1` Events, `2` Message), `button` (submit) |
| CSRF token | **None.** No hidden fields in the form |
| Captcha | **None** (no captcha markup on the page) |
| 2FA | None observed: after the form the user landed straight in the app |
| Cookies | Only `PHPSESSID` (set on the very first GET, before login). Path `/`, `SameSite=Lax`, **not** `Secure`, readable from JavaScript (not HttpOnly) |
| Session lifetime | Cookie expiry is about **4.2 days** after the last response (observed). Server-side idle timeout **not tested** |
| IP restriction | **Not tested.** Everything was done from the user's own network. A GitHub runner has a different IP, so this must be tested once from Actions |
| Server | Responses say `Server: Microsoft-IIS/10.0`, `X-Powered-By: ASP.NET`, but the pages are PHP (`PHPSESSID`). Probably a proxy in front. `Cache-Control: no-store`. **No gzip** (`Content-Encoding` absent) |
| Logout | `logout.php` (never called) |

Account type `user` ("Marketing & Sales") shows the Reports menu used below. `admin` and `hr` have more menus (Settings, Users, Delete Territory Accounts, Import ...). A job should use the least-privileged account that can see the reports.

### Example login flow (placeholders only)

```bash
# 1. get a session cookie
curl -s -c jar.txt -o /dev/null https://pulpo-cira.cloud/2026/crm/

# 2. log in (credentials come from the environment, never from a file)
curl -s -b jar.txt -c jar.txt -o /dev/null \
  --data-urlencode "uname=$CRM_USER" --data-urlencode "upass=$CRM_PASS" \
  --data-urlencode "atype=user" --data-urlencode "page=0" --data-urlencode "button=Login" \
  https://pulpo-cira.cloud/2026/crm/index.php

# 3. use the cookie jar for reports (GET only)
curl -s -b jar.txt "https://pulpo-cira.cloud/2026/crm/report_vacations.php?team=1&emp=0&vtype=&dfrom=2026-09-01&dto=2026-09-30"
```

Not observed (I did not submit the form myself): the exact response to a successful or failed POST (redirect vs. 200) and the text of a wrong-password page. The script must detect "not logged in" by looking for the `uname` field in any response (see section 6).

## 2. Reports

All report forms are **plain `GET` forms** that can be called directly with the `PHPSESSID` cookie. Dates are `yyyy-mm-dd`. The server returns **HTML** (the ".xls" exports are the same HTML table). The "Save" icon on the page either links to `report_export.php?rname=<name>.xls` or builds an `.xlsx` in the browser from the table with SheetJS, so a job can simply parse the HTML of the report URL and skip the export step.

Important gotchas, all observed:

- **Every check-box counts.** A request without the `acctype_*` boxes (or without the specialty boxes on the Doctor List) returns an *empty table with status 200*. Send the boxes that are `checked` by default on the search form.
- **`emp=0` means ALL employees** of the team. A blank `emp` returns nothing.
- **`team` is required**: `team=` (blank) returns an empty table. One request per team: `1` CIRA 1, `3` CIRA 2, `4` CIRA 3 (others: `8` Extra Sales, `9` Momentum, `10` OTC).
- Result pages contain a form with a **`Delete` submit button** (visits report, Doctor List). A job must never POST these forms.
- The HTML is **malformed** (unclosed `<tr>`, `<td>`, `<table>`), so a strict DOM/table parser mis-reads rows. Use a lenient parser or split on row markers.
- Employee lists come from `GET show_data.php?page=teamempandmanagerslist&p1=&p2=teamemp&p3=<team>&p4=&p5=1` (returns `<option value='ID'>Name`; blue = rep, other colours = managers).

### 2.1 Territory Visits (visits, pharmacy visits, office work, activities, events: one request)

| Item | Value |
|---|---|
| Search page | `report_ter_visits_search.php` |
| Request | `GET report_ter_visits.php` |
| Parameters | `team` (1/3/4), `emp` (0 = all), `wteam` (blank), `dfrom`, `dto`, `vtype` (`1` Actual, 2 Planned, 3 Actual without plan, 4 Plan without actual), `vmembers` (blank / 0 Single / 1 Double), `spoint`, `specialty`, `clarification` (all blank), `shift` (blank / `1` AM / `2` PM), and `acctype_1`..`acctype_6`, `acctype_-1`, `acctype_-2`, `acctype_-3` (value = the number itself) |
| Format | HTML, five sections in one response, each with its own `<legend>` |
| Direct call with cookie | Yes |
| Row limit / pagination | **None seen.** September CIRA 1 returned 7,182 + 2,376 + 161 + 34 rows in one response, complete (`</html>` present) |
| Size / time | One day, one team: about 400 KB, 1 s. **One month, one team: 8.0 MB, 40 s** |
| Rows (Sep 2026, CIRA 1) | Visits 7,182 · Pharmacies Visits 2,376 · Office Work 161 · Activities 34 · Events 0 |

Sections and columns:

| Section | Columns |
|---|---|
| Visits (clinics, hospitals, AM Center, poly clinics) | `#`, Territory (+ brick), Visit Type (`S`/`D`), Acc. Type (`C`, `PC`, `H`, `AM`, `A`), Acc. Name, Doctor Name, Spec., Class, Date (+ time), Products, Samples, Members, Notes, Visit Root (Planned/Direct), No. of Docs, Source (`App`...). Row checkbox `actual_<visit id>`; the Acc. Name cell links to `user.visit.php?action=view&id=<visit id>` |
| Pharmacies Visits | `#`, Territory, Visit Type, Acc. Type (`P`), Acc. Name, Doctor Name, Spec., Class, Date (+ time), Products, Last Order, Current Stock, Current Order, Members, Notes (visit id in the same link) |
| Office Work / Activities | `#`, ID, Territory, Type (e.g. "Healthy Day"), Shift, Date, Time, Members, Comments, Source |
| Events | `#`, ID, Line, Type, Event, Date From ... (empty in the test month) |

What is **not** in the list rows: Account ID, Doctor ID, rep CODE (territory name and members only), and a shift column for visits.

Shift: `shift=1` / `shift=2` filters work (14 Sep, CIRA 1: AM 90 + PM 263 = 353 = all clinic rows). **With a shift filter the pharmacy, office-work and activity rows mostly disappear** (463 rows unfiltered, 94 AM, 264 PM), so those rows have no shift value. Pharmacy/Office Work/Activities must be read from an unfiltered request.

### 2.2 Visit detail

| Item | Value |
|---|---|
| Page | `user.visit.php?action=view&id=<id>` shows only a search form and then loads the detail through AJAX |
| Real request | `GET user.visit_view.php?id=<visit id>` (HTML fragment, about 9 KB, 0.2 s) |
| **Account ID / Doctor ID** | **Yes.** Fields `Account` ("1436 <account name>") and `Doctor` ("21967 <doctor name>"), where the number is the Account ID / Doctor ID |
| Other fields | ID, Territory, Account Type (word), Specialty, Visit Type (Single/Double + members), Date, Time, **Visit Time (AM/PM)**, Waiting Time, Face Time, Visit Complete, Medical Magazine, By (user + timestamp), Location (lat/long in the map link), Giveaways, Products (samples, avg sales, comments, market feedback, follow-up, last order, stock, order) |
| Cost | One request per visit. Not tested at volume |

Hidden inputs in the fragment (`c_id`, `action`, `vdate`, `shift`, `vtype`, `members*`) belong to an admin edit form. Only read the fragment, never submit it.

### 2.3 Doctor List (master list per employee)

| Item | Value |
|---|---|
| Search page | `report_territory_accounts_emp_search.php` (also "Master List" `report_territory_accounts_main_search.php`, per brick, not tested) |
| Request | `GET report_territory_accounts_emp.php` |
| Parameters | `team`, `emp` (employee id), `aactive` (`1` = active only, blank = all), `acctype_1..6`, and every `specialty_<id>` box checked on the search form (26 checked boxes by default; without them the result is empty) |
| Format | HTML table, caption "Accounts Report <employee>" |
| Columns | `#`, Type, **Acc.ID**, HR Code, Employee, Manager, Territory, Name, Active From, Doctor Name, **Doctor ID**, Class, Specialty, Brick, Address, Tel, Mobile, Fax, Email |
| Size / time | Esraa Ahmed Mohamed: 213 rows, 145 KB, 0.5 s |
| Date coverage | **None. There is no month parameter: it always returns the list as it is today.** `Active From` is the only history |
| Not tested | Whether `emp=0` returns the whole team in one call (the page loops per employee otherwise: about 82 calls, about 40 s) |

### 2.4 Vacations (leaves)

| Item | Value |
|---|---|
| Search page | `report_vacations_search.php` |
| Request | `GET report_vacations.php?team=1&emp=0&vtype=&dfrom=2026-09-01&dto=2026-09-30` |
| Parameters | `team`, `emp` (0 = all), `vtype` (blank all; 2 Annual, 3 Sick, 4 Emergency, 8 Unpaid, 11 Compensatory), `dfrom`, `dto` |
| Format | HTML table; the approval chain is a nested table in the `Flow` cell (name, `Approved`, date) |
| Columns | `#`, ID, Line, Employee (name only, **no code**), Type, Shift (`Full` / `AM` / `PM`), Start Date, End Date, Notes, Flow, Insertion Date |
| Size / time | September CIRA 1: 71 rows, 45 KB, 0.25 s |
| Limits | None seen |

### 2.5 Office Work and Activities

Both come back **inside the Territory Visits response** (section 2.1, via `acctype_-1` Office Work and `acctype_-2` Activities, `acctype_-3` Events), with Type, Shift, Date, Time and Members. The separate page `user.activities.php` exists but was not needed. Pharmacy visits also come from the same response (`acctype_2`).

### 2.6 Looked at but not used

- Customer Visits (`report_territory_accounts_main_visits_search.php`): the first request I tried (one day, blank territory) **did not return, and the session stayed blocked for more than 5 minutes afterwards (every other request on the same cookie timed out), see risks. Not retried; a second login (new session) was not tried.
- Other reports exist (Missing Days, Period Call Rate, Doctor Data, Unlinked Doctors, Double Visits...). Not opened.

## 3. Date coverage and volume

- One request returns **one full month** (no pagination), but only **one team at a time** (`team=` blank returns nothing). A month for all three lines is 3 requests of about 8 MB, about 40 s each, roughly 2 minutes in total, plus the AM/PM requests below.
- Because visits have no shift column, AM/PM needs `shift=1` and `shift=2` requests for the clinic rows, plus one unfiltered request for pharmacy / office work / activities (or detail pages for "Visit Time").
- Nightly incremental option: request one day at a time (about 1 s and 0.4 MB per team per request). Re-pulling the last 3 days is about 27 small requests.
- Linking visits to doctors by ID needs the detail fragment (2.2): about 1,270 visits per day across all lines, so about 5 to 20 minutes per night at 1 to 4 requests per second.

## 4. What would break a nightly job

- **Session**: cookie lives about 4 days, but the server idle timeout is unknown. Log in at the start of every run (the job never needs a long-lived session) and re-login if a response contains the login form.
- **Session lock**: after one slow request (the Customer Visits probe) every other request on the same session hung for more than 5 minutes. PHP serialises requests per session, so the job must be **strictly sequential** with a long timeout, and must never start two requests at once on one cookie.
- **Empty results look like success**: a missing check-box or `emp=` returns 200 with an empty table. The job must compare row counts with the last run and fail loudly on 0 rows for a working day.
- **Malformed HTML and layout changes**: no API, no versioning. Validate the expected header row on every response.
- **Size**: 8 MB per team-month without compression. Fine for Actions, but keep requests per team per day or per month, not "all months".
- Rate limits, maintenance windows and IP allow-lists: **not observed, not tested.** No 429 or block page was seen at about 1 request per 3 seconds.

## 5. Recommendation

**Plain HTTP requests (no headless browser).** Everything needed is server-rendered HTML behind a normal cookie, with no captcha, CSRF token, 2FA or JavaScript to run. Playwright would add 300+ MB of browser and minutes of start-up per run for no benefit.

Suggested shape (Node 20 or Python in a scheduled GitHub Action):

1. Read `CRM_USER` / `CRM_PASS` from Actions secrets, log in, keep the cookie jar in memory only.
2. Visits: per team, per day (last 3 days, plus a monthly full re-pull on the 1st), three requests (AM, PM, unfiltered for pharmacy/OW/activities). Parse with a lenient HTML parser.
3. New visit ids only: fetch `user.visit_view.php?id=` (Account ID, Doctor ID, AM/PM) sequentially at 2 to 4 requests per second, and cache by id.
4. Vacations: per team for the current and previous month.
5. Doctor List: snapshot nightly into a dated table (see risk 1).
6. Load through the existing `load_*_chunk` / `finish_upload_nr` / `process_visits_month` / `refresh_month` RPCs, one request per step.
7. First run: do one test from a GitHub runner to rule out IP restrictions before building anything else.

Ask IT Gates / IT for: a read-only account limited to reports, confirmation that scripted access is allowed, the idle session timeout, any rate limits, and a maintenance window to avoid.
