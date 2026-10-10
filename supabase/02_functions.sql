-- =====================================================================
-- SFE Hub  |  02_functions.sql   (run SECOND, after 01_schema.sql)
-- All "refresh_*" functions are idempotent: they delete + rebuild one month.
-- Typical order after uploads for month M:
--     select refresh_month('2026-10-01');
-- =====================================================================

-- ---------- guards ----------------------------------------------------
-- SQL Editor (postgres) and service role pass; app users must be admin.
create or replace function assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if session_user in ('postgres','supabase_admin') then return; end if;
  if not exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;
end $$;

create or replace function month_end(p_month date) returns date
language sql immutable as $$ select (p_month + interval '1 month' - interval '1 day')::date $$;

-- ---------- calendar --------------------------------------------------
-- AM working days: every day except Friday and public holidays.
-- PM working days: every day except Thursday, Friday and public holidays.
create or replace function working_days(p_shift text, p_from date, p_to date)
returns table(day date)
language sql stable set search_path = public as $$
  select d::date
  from generate_series(p_from, p_to, interval '1 day') d
  where extract(isodow from d) <> 5
    and (p_shift = 'AM' or extract(isodow from d) <> 4)
    and not exists (select 1 from holidays h where h.day = d::date)
$$;

-- Target call rate of a box/shift for a month (latest effective_from <= month)
create or replace function get_target(p_box int, p_shift text, p_month date) returns numeric
language sql stable set search_path = public as $$
  select target from call_rate_targets
  where box_id = p_box and shift = p_shift and effective_from <= p_month
  order by effective_from desc limit 1
$$;

-- ---------- 1) org_month ---------------------------------------------
-- State of the org at the LAST DAY of the month.
-- Vacant box  -> rep_id NULL.  Vacant manager -> manager_id NULL (rolls to NSM).
create or replace function build_org_month(p_month date) returns int
language plpgsql security definer set search_path = public as $$
declare v_end date := month_end(p_month); n int;
begin
  perform assert_admin();
  delete from org_month where month = p_month;
  insert into org_month (month, territory_id, line_id, box_id, rep_id, manager_id, nsm_id)
  select p_month, t.id, t.line_id, bt.box_id, rb.rep_id, mb.manager_id, ln.nsm_id
  from box_territory bt
  join territories t on t.id = bt.territory_id
  left join rep_box rb on rb.box_id = bt.box_id
        and v_end between rb.valid_from and coalesce(rb.valid_to, 'infinity')
  left join manager_box mb on mb.box_id = bt.box_id
        and v_end between mb.valid_from and coalesce(mb.valid_to, 'infinity')
  left join line_nsm ln on ln.line_id = t.line_id
        and v_end between ln.valid_from and coalesce(ln.valid_to, 'infinity')
  where v_end between bt.valid_from and coalesce(bt.valid_to, 'infinity');
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- 2) rep_day_shift (calendar slots, leaves, OW, activities, missing) ----
-- Slot = (rep, day, shift) that is a working day for that shift while the rep covers a box.
-- Status priority (your rule: actual days = working - leave - OW - activity):
--     leave > office_work > activity > worked (visits>0) > missing
-- Leaves expand per day AND per shift: AM / PM / FULL(=both), inclusive of end date,
-- only Approved, then intersect with the slots above (Fri / Thu-PM / holidays vanish).
create or replace function refresh_rep_day_shift(p_month date) returns int
language plpgsql security definer set search_path = public as $$
declare v_end date := month_end(p_month); n int;
begin
  perform assert_admin();
  delete from rep_day_shift where day between p_month and v_end;

  insert into rep_day_shift (rep_id, day, shift, visits, leave, office_work, activity, status)
  with slots as (
    select rb.rep_id, w.day, s.shift
    from rep_box rb
    cross join (values ('AM'),('PM')) s(shift)
    cross join lateral working_days(s.shift,
        greatest(rb.valid_from, p_month), least(coalesce(rb.valid_to, v_end), v_end)) w
    where rb.valid_from <= v_end and coalesce(rb.valid_to, 'infinity') >= p_month
  ),
  v as (
    select rep_id, visit_date as day, shift, count(*) c
    from visits
    where rep_id is not null and visit_date between p_month and v_end
    group by 1,2,3
  ),
  lv as (
    select distinct l.rep_id, d::date as day, x.shift
    from leaves l
    cross join lateral generate_series(l.start_date, l.end_date, interval '1 day') d
    cross join (values ('AM'),('PM')) x(shift)
    where l.rep_id is not null and lower(trim(l.status)) = 'approved'
      and d::date between p_month and v_end
      and (l.shift = 'FULL' or l.shift = x.shift)
  ),
  ow as (
    select distinct o.rep_id, o.day, x.shift
    from office_work o cross join (values ('AM'),('PM')) x(shift)
    where o.rep_id is not null and o.day between p_month and v_end
      and (o.shift = 'FULL' or o.shift = x.shift)
  ),
  ac as (
    select distinct a.rep_id, a.day, x.shift
    from activities a cross join (values ('AM'),('PM')) x(shift)
    where a.rep_id is not null and a.day between p_month and v_end
      and (a.shift = 'FULL' or a.shift = x.shift)
  )
  select s.rep_id, s.day, s.shift,
         coalesce(v.c, 0),
         lv.rep_id is not null, ow.rep_id is not null, ac.rep_id is not null,
         case when lv.rep_id is not null then 'leave'
              when ow.rep_id is not null then 'office_work'
              when ac.rep_id is not null then 'activity'
              when coalesce(v.c,0) > 0   then 'worked'
              else 'missing' end
  from slots s
  left join v  on (v.rep_id, v.day, v.shift)  = (s.rep_id, s.day, s.shift)
  left join lv on (lv.rep_id, lv.day, lv.shift) = (s.rep_id, s.day, s.shift)
  left join ow on (ow.rep_id, ow.day, ow.shift) = (s.rep_id, s.day, s.shift)
  left join ac on (ac.rep_id, ac.day, ac.shift) = (s.rep_id, s.day, s.shift);

  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- 3) rep_month_kpi -----------------------------------------
-- Coverage = list doctors visited >=1 / list doctors
-- PCF      = sum over list doctors of min(visits, freq) / ALL rep visits (incl. non-list doctors)
-- Call rate (per shift) = visits in shift / actual days in shift
--     actual days = working days - leave - office work - activity   (= worked + missing slots)
-- Ach CR   = total visits / (target_AM*actual_AM + target_PM*actual_PM)
-- Total    = PCF*50% + Coverage*35% + AchCR*15%
create or replace function refresh_rep_month_kpi(p_month date) returns int
language plpgsql security definer set search_path = public as $$
declare v_end date := month_end(p_month); n int;
begin
  perform assert_admin();
  delete from rep_month_kpi where month = p_month;

  insert into rep_month_kpi (
    month, rep_id, box_id, list_doctors, covered_doctors, total_visits, valid_visits,
    planned_visits, direct_visits, days_am, days_pm, missing_am, missing_pm,
    leave_days, ow_days, activity_days, call_rate_am, call_rate_pm, target_am, target_pm,
    coverage, pcf, ach_cr, total_kpi)
  with reps_m as (
    select distinct rep_id, box_id from org_month where month = p_month and rep_id is not null
  ),
  vis as (                                  -- visits per rep
    select rep_id, count(*) total,
           count(*) filter (where shift='AM') am, count(*) filter (where shift='PM') pm,
           count(*) filter (where lower(visit_root)='planned') planned,
           count(*) filter (where lower(visit_root)='direct')  direct
    from visits where rep_id is not null and visit_date between p_month and v_end
    group by rep_id
  ),
  vdoc as (                                 -- visits per rep+doctor
    select rep_id, doctor_id, count(*) n
    from visits
    where rep_id is not null and doctor_id is not null and visit_date between p_month and v_end
    group by 1,2
  ),
  lst as (
    select l.rep_id, count(*) docs,
           count(*) filter (where d.n >= 1) covered,
           coalesce(sum(least(coalesce(d.n,0), l.freq)), 0) valid
    from list_snapshot l
    left join vdoc d on d.rep_id = l.rep_id and d.doctor_id = l.doctor_id
    where l.month = p_month
    group by l.rep_id
  ),
  days as (
    select rep_id,
      count(*) filter (where shift='AM' and status in ('worked','missing')) act_am,
      count(*) filter (where shift='PM' and status in ('worked','missing')) act_pm,
      count(*) filter (where shift='AM' and status='missing') mis_am,
      count(*) filter (where shift='PM' and status='missing') mis_pm,
      count(distinct day) filter (where leave) lv,
      count(distinct day) filter (where office_work) ow,
      count(distinct day) filter (where activity) ac
    from rep_day_shift where day between p_month and v_end
    group by rep_id
  ),
  x as (
    select r.rep_id, r.box_id,
           coalesce(l.docs,0) docs, coalesce(l.covered,0) covered, coalesce(l.valid,0) valid,
           coalesce(v.total,0) total, coalesce(v.am,0) vam, coalesce(v.pm,0) vpm,
           coalesce(v.planned,0) planned, coalesce(v.direct,0) direct,
           coalesce(d.act_am,0) act_am, coalesce(d.act_pm,0) act_pm,
           coalesce(d.mis_am,0) mis_am, coalesce(d.mis_pm,0) mis_pm,
           coalesce(d.lv,0) lv, coalesce(d.ow,0) ow, coalesce(d.ac,0) ac,
           get_target(r.box_id,'AM',p_month) t_am, get_target(r.box_id,'PM',p_month) t_pm
    from reps_m r
    left join lst  l on l.rep_id = r.rep_id
    left join vis  v on v.rep_id = r.rep_id
    left join days d on d.rep_id = r.rep_id
  )
  select p_month, rep_id, box_id, docs, covered, total, valid, planned, direct,
         act_am, act_pm, mis_am, mis_pm, lv, ow, ac,
         round(vam::numeric / nullif(act_am,0), 2),
         round(vpm::numeric / nullif(act_pm,0), 2),
         t_am, t_pm,
         round(covered::numeric / nullif(docs,0), 4),
         round(valid::numeric   / nullif(total,0), 4),
         round(total::numeric / nullif(coalesce(t_am,0)*act_am + coalesce(t_pm,0)*act_pm, 0), 4),
         round( coalesce(valid::numeric / nullif(total,0), 0)           * 0.50
              + coalesce(covered::numeric / nullif(docs,0), 0)          * 0.35
              + coalesce(total::numeric / nullif(coalesce(t_am,0)*act_am + coalesce(t_pm,0)*act_pm, 0), 0) * 0.15, 4)
  from x;

  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- master refresh -------------------------------------------
create or replace function refresh_month(p_month date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a int; b int; c int;
begin
  perform assert_admin();
  if extract(day from p_month) <> 1 then raise exception 'p_month must be the 1st of a month'; end if;
  a := build_org_month(p_month);
  b := refresh_rep_day_shift(p_month);
  c := refresh_rep_month_kpi(p_month);
  return jsonb_build_object('org_rows', a, 'slots', b, 'kpi_rows', c);
end $$;

-- ---------- list change tracking (month vs previous month) -----------
-- change_type: added | removed | transferred (doctor moved to a different rep) | freq_changed
create or replace function list_changes(p_month date)
returns table (change_type text, doctor_id int, from_rep int, to_rep int, old_freq smallint, new_freq smallint)
language sql stable set search_path = public as $$
  with cur as (select * from list_snapshot where month = p_month),
       prv as (select * from list_snapshot where month = (p_month - interval '1 month')::date)
  select case when prv.doctor_id is null then 'added'
              when cur.doctor_id is null then 'removed'
              when prv.rep_id <> cur.rep_id then 'transferred'
              else 'freq_changed' end,
         coalesce(cur.doctor_id, prv.doctor_id), prv.rep_id, cur.rep_id, prv.freq, cur.freq
  from cur full join prv on prv.doctor_id = cur.doctor_id
  where prv.doctor_id is null or cur.doctor_id is null
     or prv.rep_id <> cur.rep_id or prv.freq <> cur.freq
$$;

-- =====================================================================
-- 4) SALES ROLL-UP VIEWS  (Territory -> Box -> Rep / Manager -> NSM -> Company)
-- security_invoker => RLS of the caller applies.
-- s_* = actual sales, t_* = target.  Vacant box => rep_id NULL; vacant manager => manager_id NULL.
-- =====================================================================
create or replace view v_sales_org with (security_invoker = true) as
select s.id, s.month, s.territory_id, o.line_id, o.box_id, o.rep_id, o.manager_id, o.nsm_id,
       s.product_id, s.s_units, s.t_units, s.s_value, s.t_value
from sales s
left join org_month o on o.month = s.month and o.territory_id = s.territory_id;

create or replace view v_sales_unmapped with (security_invoker = true) as
select * from v_sales_org where box_id is null;

create or replace view v_sales_by_box with (security_invoker = true) as
select month, line_id, box_id, rep_id, manager_id, nsm_id,
       sum(s_units) s_units, sum(t_units) t_units, sum(s_value) s_value, sum(t_value) t_value,
       round(sum(s_value) / nullif(sum(t_value),0), 4) ach_value
from v_sales_org where box_id is not null
group by month, line_id, box_id, rep_id, manager_id, nsm_id;

create or replace view v_sales_by_manager with (security_invoker = true) as
select month, line_id, nsm_id, manager_id,           -- manager_id NULL = vacant manager (belongs to NSM)
       sum(s_units) s_units, sum(t_units) t_units, sum(s_value) s_value, sum(t_value) t_value,
       round(sum(s_value) / nullif(sum(t_value),0), 4) ach_value
from v_sales_org where box_id is not null
group by month, line_id, nsm_id, manager_id;

create or replace view v_sales_by_nsm with (security_invoker = true) as
select month, line_id, nsm_id,
       sum(s_units) s_units, sum(t_units) t_units, sum(s_value) s_value, sum(t_value) t_value,
       round(sum(s_value) / nullif(sum(t_value),0), 4) ach_value
from v_sales_org where box_id is not null
group by month, line_id, nsm_id;

create or replace view v_sales_company with (security_invoker = true) as
select month,
       sum(s_units) s_units, sum(t_units) t_units, sum(s_value) s_value, sum(t_value) t_value,
       round(sum(s_value) / nullif(sum(t_value),0), 4) ach_value
from sales group by month;           -- straight from sales: includes unmapped rows

-- =====================================================================
-- 5) DATA-QUALITY VIEWS
-- =====================================================================
create or replace view v_missing_days with (security_invoker = true) as
select r.code, r.name, d.rep_id, d.day, d.shift
from rep_day_shift d join reps r on r.id = d.rep_id
where d.status = 'missing';

-- visits recorded on a slot that is leave / office work / activity
create or replace view v_dq_visits_on_nonwork with (security_invoker = true) as
select r.code, r.name, d.rep_id, d.day, d.shift, d.visits, d.status
from rep_day_shift d join reps r on r.id = d.rep_id
where d.visits > 0 and d.status <> 'worked';

create or replace view v_dq_visits_unmatched with (security_invoker = true) as
select visit_date, shift, owner_code, doctor_raw, account_raw, match_status
from visits where match_status <> 'matched';
