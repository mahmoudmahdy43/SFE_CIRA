-- =====================================================================
-- SFE Hub | 85_monthly_plan.sql   (run AFTER 84_doctor_last_geo.sql)
-- Monthly visit plan (PM only = Clinics + Poly Clinics):
--   plan_requests      : days the rep cannot visit (PM activity / training / other) - entered per rep + month
--   monthly_plans      : one plan per rep + month (draft / approved) with the warnings summary
--   monthly_plan_days  : the plan rows (day, doctor, order, planned time)
--   plan_inputs()      : everything the planner needs in ONE call (capacity, working days, doctors, GPS, usual time)
--   save_plan()        : saves a generated plan (replaces the rep's plan of that month)
--   plan_actuals()     : actual visits of the rep in a month (for backtesting a plan against history)
-- The planning algorithm itself runs in the app (TypeScript), see MSG_MONTHLY_PLAN.md.
-- =====================================================================

create table if not exists plan_requests (
  id         bigint generated always as identity primary key,
  rep_id     int  not null references reps(id) on delete cascade,
  month      date not null check (month = date_trunc('month', month)::date),
  day        date not null,
  kind       text not null default 'activity' check (kind in ('activity','training','other')),
  shift      text not null check (shift in ('AM','PM','FULL')),
  note       text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (date_trunc('month', day)::date = month),
  unique (rep_id, day, kind, shift)
);
-- a request closes the PM when its shift is PM or FULL; an AM request does not touch the PM
create index if not exists plan_requests_rep_ix on plan_requests (rep_id, month);

create table if not exists monthly_plans (
  id           bigint generated always as identity primary key,
  rep_id       int  not null references reps(id) on delete cascade,
  month        date not null check (month = date_trunc('month', month)::date),
  status       text not null default 'draft' check (status in ('draft','approved')),
  params       jsonb not null default '{}'::jsonb,   -- {coverage_day:15, min_cov:0.9, max_day:13 ...}
  summary      jsonb not null default '{}'::jsonb,   -- warnings, cov_day15, pcf, capacity, over days ...
  generated_by uuid default auth.uid(),
  generated_at timestamptz not null default now(),
  approved_by  uuid,
  approved_at  timestamptz,
  unique (rep_id, month)
);

create table if not exists monthly_plan_days (
  plan_id      bigint not null references monthly_plans(id) on delete cascade,
  day          date not null,
  seq          smallint not null,                    -- order inside the day
  doctor_id    int  not null references doctors(id),
  planned_time time,
  fixed        boolean not null default false,       -- true = confirmed time (usual day + hour)
  visit_no     smallint not null default 1,          -- 1st / 2nd / ... visit of this doctor in the month
  note         text,
  primary key (plan_id, day, seq)
);
create index if not exists monthly_plan_days_doc_ix on monthly_plan_days (plan_id, doctor_id);

alter table plan_requests     enable row level security;
alter table monthly_plans     enable row level security;
alter table monthly_plan_days enable row level security;
do $$ declare t text; begin
  foreach t in array array['plan_requests','monthly_plans','monthly_plan_days'] loop
    execute format('drop policy if exists admin_all on %I', t);
    execute format('create policy admin_all on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
    execute format('drop policy if exists read_all on %I', t);
    execute format('create policy read_all on %I for select to authenticated using (true)', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- plan_inputs(rep, month): one JSON with all the planner needs
-- ---------------------------------------------------------------------
create or replace function plan_inputs(p_rep int, p_month date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date;
  v_list  date;
  v_box   int;
  v_target numeric;
  v_out   jsonb;
begin
  -- list month: the same month if uploaded, otherwise the latest earlier one
  select max(month) into v_list from list_snapshot where rep_id = p_rep and month <= v_month;
  select box_id into v_box from org_month where rep_id = p_rep and month <= v_month order by month desc limit 1;
  v_target := get_target(v_box, 'PM', v_month);

  select jsonb_build_object(
    'rep',        (select jsonb_build_object('id', r.id, 'name', r.name, 'code', r.code) from reps r where r.id = p_rep),
    'month',      v_month,
    'list_month', v_list,
    'box_id',     v_box,
    'daily_target', v_target,                        -- Target Call Rate PM of the box (8 / 9 / 10)
    -- PM working days (no Thu / Fri / holidays) with the reason a day is closed
    'days', (select coalesce(jsonb_agg(jsonb_build_object(
                'day', w.day,
                'isodow', extract(isodow from w.day)::int,
                'closed', (rq.kinds is not null or lv.l is not null),
                'reason', coalesce(rq.kinds, case when lv.l is not null then 'leave' end)
             ) order by w.day), '[]'::jsonb)
             from working_days('PM', v_month, v_end) w
             left join lateral (
               select string_agg(distinct q.kind, ',') as kinds
                 from plan_requests q
                where q.rep_id = p_rep and q.day = w.day and q.shift in ('PM','FULL')) rq on true
             left join lateral (
               select true as l from leaves l
                where l.rep_id = p_rep and w.day between l.start_date and l.end_date and l.shift in ('PM','FULL') limit 1) lv on true),
    -- the rep's PM list (Clinics + Poly Clinics) with frequency, last known GPS and usual day / hour
    'doctors', (select coalesce(jsonb_agg(jsonb_build_object(
                  'doctor_id', s.doctor_id, 'name', d.doctor_name, 'account', d.account_name,
                  'account_type', at.name, 'freq', s.freq, 'brick', b.name, 'division', s.division,
                  'lat', g.lat, 'lng', g.lng, 'pos_source', g.pos_source,
                  'usual_isodow', u.usual_isodow, 'usual_hour', u.usual_hour, 'n_visits', u.n_visits
                ) order by d.doctor_name), '[]'::jsonb)
                from list_snapshot s
                join doctors d on d.id = s.doctor_id
                join account_types at on at.id = d.account_type_id and at.name in ('Clinics','Poly Clinics')
                left join bricks b on b.id = s.brick_id
                left join v_doctor_last_geo g on g.doctor_id = s.doctor_id
                left join v_doctor_usual_time u on u.doctor_id = s.doctor_id
               where s.month = v_list and s.rep_id = p_rep and s.freq > 0)
  ) into v_out;
  return v_out;
end $$;
grant execute on function plan_inputs(int, date) to authenticated;

-- ---------------------------------------------------------------------
-- save_plan(rep, month, params, summary, rows): rows = [{day, seq, doctor_id, planned_time, fixed, visit_no, note}]
-- replaces the rep's plan of that month (an approved plan is kept: returns null)
-- ---------------------------------------------------------------------
create or replace function save_plan(p_rep int, p_month date, p_params jsonb, p_summary jsonb, p_rows jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', p_month)::date; v_id bigint; v_status text;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select id, status into v_id, v_status from monthly_plans where rep_id = p_rep and month = v_month;
  if v_status = 'approved' then return null; end if;
  if v_id is null then
    insert into monthly_plans(rep_id, month, params, summary) values (p_rep, v_month, coalesce(p_params,'{}'), coalesce(p_summary,'{}'))
    returning id into v_id;
  else
    update monthly_plans set params = coalesce(p_params,'{}'), summary = coalesce(p_summary,'{}'),
           generated_by = auth.uid(), generated_at = now() where id = v_id;
    delete from monthly_plan_days where plan_id = v_id;
  end if;
  insert into monthly_plan_days(plan_id, day, seq, doctor_id, planned_time, fixed, visit_no, note)
  select v_id, (r->>'day')::date, (r->>'seq')::smallint, (r->>'doctor_id')::int,
         nullif(r->>'planned_time','')::time, coalesce((r->>'fixed')::boolean, false),
         coalesce((r->>'visit_no')::smallint, 1), nullif(r->>'note','')
    from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r;
  return v_id;
end $$;
grant execute on function save_plan(int, date, jsonb, jsonb, jsonb) to authenticated;

-- approve a plan (locks it)
create or replace function approve_plan(p_plan bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  update monthly_plans set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_plan;
end $$;
grant execute on function approve_plan(bigint) to authenticated;

-- ---------------------------------------------------------------------
-- plan_actuals(rep, month): what the rep really did (PM) - to backtest a plan against history
-- ---------------------------------------------------------------------
create or replace function plan_actuals(p_rep int, p_month date)
returns table(day date, doctor_id int, visit_time time)
language sql stable security definer set search_path = public as $$
  select v.visit_date, v.doctor_id, v.visit_time
    from visits v
   where v.rep_id = p_rep and v.doctor_id is not null and v.acc_type_code in ('C','PC')
     and v.visit_date >= date_trunc('month', p_month)::date
     and v.visit_date <  (date_trunc('month', p_month) + interval '1 month')::date
   order by 1, 3
$$;
grant execute on function plan_actuals(int, date) to authenticated;
