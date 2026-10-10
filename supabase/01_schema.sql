-- =====================================================================
-- SFE Hub  |  01_schema.sql   (run FIRST in Supabase SQL Editor)
-- Conventions:
--   * month columns are DATE = first day of the month (CHECK enforced)
--   * dimensions have small integer ids; fact tables store ids, not names
--   * org history is effective-dated (valid_from / valid_to, NULL = open)
--   * every table gets RLS (see 03_rls.sql for policies + grants)
-- =====================================================================

create extension if not exists btree_gist;

-- ---------- helpers ---------------------------------------------------
-- Normalise a name for matching: lower, strip "- " prefix, strip "()" suffix,
-- collapse spaces/punctuation.
create or replace function norm_name(t text) returns text
language sql immutable as $$
  select nullif(trim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(t,'')), '^\s*-\s*', ''),
             '\(\s*\)\s*$', ''),
           '[\s\.\-_]+', ' ', 'g')), '')
$$;

create or replace function is_month_start(d date) returns boolean
language sql immutable as $$ select d is not null and extract(day from d) = 1 $$;

-- =====================================================================
-- 1) DIMENSIONS
-- =====================================================================
create table lines (
  id    smallint generated always as identity primary key,
  name  text not null unique                      -- CIRA 1 / CIRA 2 / CIRA 3
);

create table nsms (                               -- National Sales Manager (= Line Manager)
  id    smallint generated always as identity primary key,
  name  text not null unique
);

create table line_nsm (                           -- who is NSM of a line, over time
  id         int generated always as identity primary key,
  line_id    smallint not null references lines(id),
  nsm_id     smallint references nsms(id),        -- NULL = vacant NSM
  valid_from date not null,
  valid_to   date,
  exclude using gist (line_id with =, daterange(valid_from, valid_to, '[]') with &&)
);

create table managers (                           -- District Managers (DM)
  id      int generated always as identity primary key,
  code    text unique,                            -- employee code (visits file CODE for manager rows)
  name    text not null,
  status  text not null default 'Active' check (status in ('Active','Resigned')),
  hire_date   date,
  resign_date date
);

create table reps (                               -- Medical Reps
  id      int generated always as identity primary key,
  code    text not null unique,                   -- e.g. 1C0813
  name    text not null,
  name_norm text generated always as (norm_name(name)) stored,
  status  text not null default 'Active' check (status in ('Active','Resigned')),
  hire_date   date,
  resign_date date
);

create table boxes (
  id       int generated always as identity primary key,
  line_id  smallint not null references lines(id),
  name     text not null,
  unique (line_id, name)
);

create table territories (                        -- unique only WITHIN a line
  id       int generated always as identity primary key,
  line_id  smallint not null references lines(id),
  name     text not null,
  name_norm text generated always as (norm_name(name)) stored,
  unique (line_id, name),
  unique (line_id, name_norm)
);

create table territory_aliases (                  -- spelling variants seen in uploads
  id           int generated always as identity primary key,
  line_id      smallint references lines(id),     -- NULL = applies to any line
  alias_norm   text not null,
  territory_id int not null references territories(id) on delete cascade,
  unique (line_id, alias_norm)
);

create table products (
  id    int generated always as identity primary key,
  name  text not null unique
);

create table bricks (
  id    int generated always as identity primary key,
  name  text not null unique
);

create table specialities  (id smallint generated always as identity primary key, name text not null unique);
create table account_types (id smallint generated always as identity primary key, name text not null unique);

create table doctors (                            -- one row per (Account ID, Doctor Id) from the list
  id            int generated always as identity primary key,
  account_id    text not null,
  doctor_ext_id text not null,
  doctor_name   text not null,
  account_name  text,
  name_norm     text generated always as (norm_name(doctor_name)) stored,
  account_norm  text generated always as (norm_name(account_name)) stored,
  speciality_id smallint references specialities(id),
  account_type_id smallint references account_types(id),
  unique (account_id, doctor_ext_id)
);
create index doctors_match_ix on doctors (name_norm, account_norm);

-- =====================================================================
-- 2) ORG STRUCTURE OVER TIME  (Territory -> Box -> Rep / Manager -> Line -> NSM)
-- =====================================================================
create table box_territory (                      -- territory belongs to ONE box at a time
  id           int generated always as identity primary key,
  box_id       int not null references boxes(id),
  territory_id int not null references territories(id),
  valid_from   date not null,
  valid_to     date,
  exclude using gist (territory_id with =, daterange(valid_from, valid_to, '[]') with &&)
);

create table rep_box (                            -- who covers a box (no row = VACANT)
  id         int generated always as identity primary key,
  rep_id     int not null references reps(id),
  box_id     int not null references boxes(id),
  valid_from date not null,
  valid_to   date,
  exclude using gist (box_id with =, daterange(valid_from, valid_to, '[]') with &&),
  exclude using gist (rep_id with =, daterange(valid_from, valid_to, '[]') with &&)
);

create table manager_box (                        -- who manages a box (no row = VACANT manager)
  id         int generated always as identity primary key,
  manager_id int not null references managers(id),
  box_id     int not null references boxes(id),
  valid_from date not null,
  valid_to   date,
  exclude using gist (box_id with =, daterange(valid_from, valid_to, '[]') with &&)
);

create table personnel_events (                   -- audit log written by the Personnel page
  id          bigint generated always as identity primary key,
  event_type  text not null check (event_type in
              ('hire','resign','transfer','manager_assign','manager_resign','nsm_change')),
  rep_id      int references reps(id),
  manager_id  int references managers(id),
  box_id      int references boxes(id),
  event_date  date not null,
  notes       text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

-- Flattened org per month: THE join table for sales + KPIs (rebuilt by function)
create table org_month (
  month        date not null check (is_month_start(month)),
  territory_id int  not null references territories(id),
  line_id      smallint not null references lines(id),
  box_id       int  not null references boxes(id),
  rep_id       int  references reps(id),          -- NULL = VACANT box
  manager_id   int  references managers(id),      -- NULL = VACANT manager (rolls up to NSM)
  nsm_id       smallint references nsms(id),
  primary key (month, territory_id)
);
create index org_month_rep_ix on org_month (month, rep_id);
create index org_month_mgr_ix on org_month (month, manager_id);
create index org_month_box_ix on org_month (month, box_id);

-- =====================================================================
-- 3) CALENDAR + TARGETS
-- =====================================================================
create table holidays (
  day   date primary key,
  name  text not null
);
-- Weekly rules (hard-coded in functions): Friday off; PM also off on Thursday.

create table call_rate_targets (                  -- per BOX per shift; latest effective_from <= month applies
  box_id         int not null references boxes(id),
  shift          text not null check (shift in ('AM','PM')),
  effective_from date not null check (is_month_start(effective_from)),
  target         numeric(5,2) not null check (target >= 0),
  primary key (box_id, shift, effective_from)
);

-- =====================================================================
-- 4) UPLOAD TRACKING
-- =====================================================================
create table upload_batches (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in
              ('list','visits','sales','leaves','office_work','activities','coaching')),
  file_name   text,
  months      date[] not null default '{}',
  rows_total  int  not null default 0,
  rows_loaded int  not null default 0,
  rows_rejected int not null default 0,
  status      text not null default 'loaded' check (status in ('loaded','replaced','deleted')),
  created_by  uuid,
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- 5) MONTHLY FACTS (raw, as uploaded)
-- =====================================================================
create table list_snapshot (                      -- target list per month (Freq = target visits)
  month      date not null check (is_month_start(month)),
  doctor_id  int  not null references doctors(id),
  rep_id     int  not null references reps(id),
  line_id    smallint references lines(id),
  brick_id   int  references bricks(id),
  class      text,
  division   text,
  freq       smallint not null default 0,
  active_from date,
  batch_id   bigint references upload_batches(id),
  primary key (month, doctor_id)
);
create index list_snapshot_rep_ix on list_snapshot (month, rep_id);

create table visits (
  id            bigint generated always as identity primary key,
  batch_id      bigint references upload_batches(id),
  visit_date    date not null,
  shift         text not null check (shift in ('AM','PM')),
  owner_code    text not null,                    -- CODE column (rep OR manager)
  rep_id        int references reps(id),
  manager_id    int references managers(id),
  territory_id  int references territories(id),
  territory_raw text,
  visit_type    text,                             -- Single / Double ...
  visit_root    text,                             -- Planned / Direct source
  source        text,
  doctor_id     int references doctors(id),       -- NULL if not matched
  match_status  text not null default 'unmatched'
                check (match_status in ('matched','unmatched','not_in_list')),
  doctor_raw    text,
  account_raw   text,
  members       text,
  notes         text,
  visit_key     text not null,                    -- same for the rep row + manager row of a Double
  check ((rep_id is not null) <> (manager_id is not null))
);
create index visits_rep_ix   on visits (rep_id, visit_date);
create index visits_mgr_ix   on visits (manager_id, visit_date);
create index visits_date_ix  on visits (visit_date, shift);
create index visits_key_ix   on visits (visit_key);
create index visits_doc_ix   on visits (doctor_id) where doctor_id is not null;

create table leaves (                             -- one row per file row; expanded to day/shift by function
  id         bigint generated always as identity primary key,
  batch_id   bigint references upload_batches(id),
  code       text not null,
  rep_id     int references reps(id),
  manager_id int references managers(id),
  leave_type text,
  shift      text not null check (shift in ('AM','PM','FULL')),
  start_date date not null,
  end_date   date not null,
  status     text,
  notes      text,
  check (end_date >= start_date)
);
create index leaves_rep_ix on leaves (rep_id, start_date, end_date);

create table office_work (
  id         bigint generated always as identity primary key,
  batch_id   bigint references upload_batches(id),
  code       text not null,
  rep_id     int references reps(id),
  manager_id int references managers(id),
  ow_type    text,
  shift      text not null check (shift in ('AM','PM','FULL')),
  day        date not null,
  members    text,
  comments   text
);
create index office_work_ix on office_work (rep_id, day);

create table activities (
  id         bigint generated always as identity primary key,
  batch_id   bigint references upload_batches(id),
  code       text not null,
  rep_id     int references reps(id),
  manager_id int references managers(id),
  act_type   text,
  shift      text not null check (shift in ('AM','PM','FULL')),
  day        date not null,
  at_time    time,
  members    text,
  comments   text
);
create index activities_ix on activities (rep_id, day);

create table sales (                              -- territory-level, line comes from territory
  id           bigint generated always as identity primary key,
  batch_id     bigint references upload_batches(id),
  month        date not null check (is_month_start(month)),
  territory_id int not null references territories(id),
  product_id   int not null references products(id),
  source_code  text,                              -- CODE as uploaded (audit only; NOT used for roll-up)
  md_name      text,
  s_units numeric, t_units numeric, s_value numeric, t_value numeric
);
create index sales_ix on sales (month, territory_id);

-- =====================================================================
-- 6) DERIVED / SUMMARY TABLES  (filled by functions in 02_functions.sql)
-- =====================================================================
create table rep_day_shift (                      -- one row per working slot of an employed rep
  rep_id       int  not null references reps(id),
  day          date not null,
  shift        text not null check (shift in ('AM','PM')),
  visits       int  not null default 0,
  leave        boolean not null default false,
  office_work  boolean not null default false,
  activity     boolean not null default false,
  status       text not null check (status in ('worked','leave','office_work','activity','missing')),
  primary key (rep_id, day, shift)
);
create index rep_day_shift_ix on rep_day_shift (day, status);

create table rep_month_kpi (
  month          date not null check (is_month_start(month)),
  rep_id         int  not null references reps(id),
  box_id         int  references boxes(id),
  list_doctors   int, covered_doctors int,
  total_visits   int, valid_visits int,
  planned_visits int, direct_visits int,
  days_am int, days_pm int,                       -- actual days per shift
  missing_am int, missing_pm int,
  leave_days int, ow_days int, activity_days int,
  call_rate_am numeric(6,2), call_rate_pm numeric(6,2),
  target_am numeric(5,2),    target_pm numeric(5,2),
  coverage numeric(6,4), pcf numeric(6,4), ach_cr numeric(6,4), total_kpi numeric(6,4),
  primary key (month, rep_id)
);

-- =====================================================================
-- 7) USERS / ROLES  (links Supabase Auth users to a role)
-- =====================================================================
create table user_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin','dm','rep')),
  rep_id     int references reps(id),
  manager_id int references managers(id)
);

-- RLS on everything (policies come in 03_rls.sql)
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;
