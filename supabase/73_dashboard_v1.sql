-- 73_dashboard_v1.sql -- Dashboard V1: sales linked to field KPIs. Everything is computed LIVE from the data (no cache, no refresh step):
-- add Oct / Nov / Dec sales + visits + list and the dashboard simply includes them.
-- Anchor = Territory (Line + Territory = Box) per month. PM shift only (Clinic + Poly Clinic visits / list doctors).
-- Needs list_snapshot.territory_id (run backfill_list_box(month) once for the old months Jan-Sep if a month shows no list).
-- All functions are admin only (is_admin()).

-- ===== 1) base: one row per Territory x Month ======================================================================
create or replace function dash_territory_month(p_from date, p_to date) returns table (
  month date, line_id smallint, line_name text, territory_id int, territory_name text, box_id int, box_name text,
  rep_id int, rep_name text, manager_id int, manager_name text, vacant boolean,
  s_value numeric, s_units numeric, t_value numeric, t_units numeric, ach numeric,
  list_doctors int, covered int, fully int, coverage numeric, pcf numeric, visits int, visits_per_doctor numeric)
language sql stable security definer set search_path = public as $$
  with a as (select date_trunc('month', p_from)::date as m1, date_trunc('month', p_to)::date as m2),
  sl as (
    select s.month, s.territory_id, sum(s.s_value) sv, sum(s.s_units) su, sum(s.t_value) tv, sum(s.t_units) tu
      from sales s, a where s.month between a.m1 and a.m2 group by 1, 2),
  vd as (
    select date_trunc('month', v.visit_date)::date as month, v.doctor_id, count(distinct v.visit_key) as n
      from visits v, a
     where v.rep_id is not null and v.doctor_id is not null and v.acc_type_code in ('C','PC')
       and v.visit_date between a.m1 and month_end(a.m2)
     group by 1, 2),
  cv as (
    select l.month, l.territory_id,
           count(*) as ln,
           count(*) filter (where coalesce(vd.n,0) > 0) as cov,
           count(*) filter (where coalesce(vd.n,0) >= greatest(l.freq,1)) as full_n,
           coalesce(sum(least(coalesce(vd.n,0), greatest(l.freq,1))),0) as valid,
           coalesce(sum(vd.n),0) as vis
      from list_snapshot l
      join a on l.month between a.m1 and a.m2
      join doctors d on d.id = l.doctor_id and d.account_type_id in (acct_type_id('C'), acct_type_id('PC'))
      left join vd on vd.month = l.month and vd.doctor_id = l.doctor_id
     where l.territory_id is not null
     group by 1, 2),
  k as (select coalesce(sl.month, cv.month) as month, coalesce(sl.territory_id, cv.territory_id) as tid,
               sl.sv, sl.su, sl.tv, sl.tu, cv.ln, cv.cov, cv.full_n, cv.valid, cv.vis
          from sl full join cv on cv.month = sl.month and cv.territory_id = sl.territory_id)
  select k.month, t.line_id, ln.name, t.id, t.name, om.box_id, b.name, om.rep_id, r.name, om.manager_id, mg.name, (om.rep_id is null),
         coalesce(k.sv,0), coalesce(k.su,0), coalesce(k.tv,0), coalesce(k.tu,0),
         round(k.sv / nullif(k.tv,0), 4),
         coalesce(k.ln,0)::int, coalesce(k.cov,0)::int, coalesce(k.full_n,0)::int,
         round(k.cov::numeric / nullif(k.ln,0), 4),
         round(k.valid::numeric / nullif(k.vis,0), 4),
         coalesce(k.vis,0)::int, round(k.vis::numeric / nullif(k.ln,0), 2)
    from k
    join territories t on t.id = k.tid
    left join lines ln on ln.id = t.line_id
    left join org_month om on om.month = k.month and om.territory_id = k.tid
    left join boxes b on b.id = om.box_id
    left join reps r on r.id = om.rep_id
    left join managers mg on mg.id = om.manager_id
   where is_admin() and p_from <= p_to
   order by ln.name, t.name, k.month;
$$;

-- ===== 2) Territory 360: one row per territory over the range ======================================================
create or replace function dash_territory_summary(p_from date, p_to date, p_line smallint default null) returns table (
  line_id smallint, line_name text, territory_id int, territory_name text, box_name text, rep_name text, manager_name text,
  vacant_months int, months int,
  list_doctors int, list_share numeric, coverage numeric, pcf numeric, visits int, visits_per_doctor numeric,
  s_value numeric, t_value numeric, ach numeric, sales_share numeric, share_index numeric, sales_per_doctor numeric, growth numeric)
language sql stable security definer set search_path = public as $$
  with b as (select * from dash_territory_month(p_from, p_to) x where p_line is null or x.line_id = p_line),
  lastm as (select max(month) as m from b where list_doctors > 0),
  per as (
    select b.line_id, b.line_name, b.territory_id, b.territory_name,
           (array_agg(b.box_name order by b.month desc))[1] as box_name,
           (array_agg(b.rep_name order by b.month desc) filter (where b.rep_name is not null))[1] as rep_name,
           (array_agg(b.manager_name order by b.month desc) filter (where b.manager_name is not null))[1] as manager_name,
           count(*) filter (where b.vacant)::int as vacant_months, count(*)::int as months,
           coalesce(max(b.list_doctors) filter (where b.month = (select m from lastm)), 0)::int as list_n,
           sum(b.covered) as cov, sum(b.list_doctors) as lsum,
           sum(b.pcf * b.visits) as valid_w, sum(b.visits) as vis,
           sum(b.s_value) as sv, sum(b.t_value) as tv,
           sum(b.s_value) filter (where b.month > (p_from + (p_to - p_from)/2)) as s2,
           sum(b.s_value) filter (where b.month <= (p_from + (p_to - p_from)/2)) as s1
      from b group by 1, 2, 3, 4),
  tot as (select line_id, sum(list_n) as ll, sum(sv) as ss from per group by 1)
  select per.line_id, per.line_name, per.territory_id, per.territory_name, per.box_name, per.rep_name, per.manager_name,
         per.vacant_months, per.months, per.list_n,
         round(per.list_n::numeric / nullif(tot.ll,0), 4),
         round(per.cov::numeric / nullif(per.lsum,0), 4),
         round(per.valid_w / nullif(per.vis,0), 4),
         per.vis::int, round(per.vis::numeric / nullif(per.lsum,0), 2),
         per.sv, per.tv, round(per.sv / nullif(per.tv,0), 4),
         round(per.sv / nullif(tot.ss,0), 4),
         round((per.sv / nullif(tot.ss,0)) / nullif(per.list_n::numeric / nullif(tot.ll,0), 0), 2),
         round(per.sv / nullif(per.list_n,0), 0),
         round(per.s2 / nullif(per.s1,0) - 1, 4)
    from per join tot on tot.line_id is not distinct from per.line_id
   where is_admin()
   order by per.line_name, per.sv desc;
$$;

-- ===== 3) Reps matrix: effort (visits vs expected) x result (sales vs target) ======================================
create or replace function dash_effort_matrix(p_from date, p_to date, p_effort numeric default 85, p_sales numeric default 90,
                                              p_line smallint default null) returns table (
  rep_id int, rep_name text, line_id smallint, line_name text, manager_name text, territories text,
  visits int, days_pm int, call_rate_pm numeric, target_pm numeric, effort_pct numeric,
  s_value numeric, t_value numeric, ach_pct numeric, grp text)
language sql stable security definer set search_path = public as $$
  with kpi as (
    select k.rep_id, sum(k.total_visits) as vis, sum(k.days_pm) as dys,
           sum(coalesce(k.target_pm,0) * coalesce(k.days_pm,0)) as expv
      from rep_month_kpi k where k.month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date group by 1),
  sal as (
    select c.rep_id, (array_agg(c.line_id order by c.month desc))[1] as line_id, (array_agg(c.manager_id order by c.month desc))[1] as mgr,
           sum(c.s_value) as sv, sum(c.t_value) as tv,
           string_agg(distinct t.name, ', ') as terrs
      from v_sales_cube c join territories t on t.id = c.territory_id
     where c.rep_id is not null and c.month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
     group by 1),
  x as (
    select r.id, r.name, sal.line_id, sal.mgr, sal.terrs, coalesce(kpi.vis,0) as vis, coalesce(kpi.dys,0) as dys, kpi.expv,
           sal.sv, sal.tv,
           round(kpi.vis::numeric / nullif(kpi.dys,0), 2) as cr,
           round(kpi.expv / nullif(kpi.dys,0), 2) as tgt,
           round(kpi.vis::numeric / nullif(kpi.expv,0) * 100, 1) as eff,
           round(sal.sv / nullif(sal.tv,0) * 100, 1) as ach
      from reps r join sal on sal.rep_id = r.id left join kpi on kpi.rep_id = r.id)
  select x.id, x.name, x.line_id, ln.name, coalesce(m.name, 'Vacant manager'), x.terrs,
         x.vis::int, x.dys::int, x.cr, x.tgt, x.eff, x.sv, x.tv, x.ach,
         case when x.eff is null or x.ach is null then 'NO_DATA'
              when x.eff >= p_effort and x.ach >= p_sales then 'STAR'
              when x.eff >= p_effort and x.ach <  p_sales then 'NOT_CONVERTING'
              when x.eff <  p_effort and x.ach >= p_sales then 'EFFICIENT'
              else 'INTERVENTION' end
    from x left join lines ln on ln.id = x.line_id left join managers m on m.id = x.mgr
   where is_admin() and (p_line is null or x.line_id = p_line)
   order by 15, x.ach desc nulls last;
$$;

-- ===== 4) How strongly is each KPI linked with sales? ===============================================================
-- y = sales index of the territory (sales / that territory's own average), so big and small territories are comparable.
-- r_across = same-month comparison between territories (month average removed).
-- r_within = the territory against ITSELF over time (territory average and month average both removed) - the fairest one.
-- lag = 0: KPI and sales in the same month; lag = 1: KPI of the month before.
create or replace function dash_correlations(p_from date, p_to date, p_line smallint default null) returns table (
  metric text, lag int, n int, r_across numeric, r_within numeric)
language sql stable security definer set search_path = public as $$
  with b as (
    select x.*, x.s_value / nullif(avg(x.s_value) over (partition by x.territory_id), 0) as yi
      from dash_territory_month((date_trunc('month', p_from) - interval '1 month')::date, p_to) x
     where not x.vacant and x.list_doctors > 0 and x.s_value > 0 and (p_line is null or x.line_id = p_line)),
  mt as (select 'visits'::text as metric, 1 as o union all select 'coverage', 2 union all select 'pcf', 3),
  lg as (select 0 as lag union all select 1),
  pr as (
    select mt.metric, lg.lag, y.territory_id, y.month, y.yi as y,
           case mt.metric when 'visits' then xx.visits_per_doctor when 'coverage' then xx.coverage else xx.pcf end as x
      from b y join lg on true join mt on true
      join b xx on xx.territory_id = y.territory_id and xx.month = (y.month - (lg.lag || ' month')::interval)::date
     where y.month >= date_trunc('month', p_from)::date),
  pw as (
    select *, x - avg(x) over (partition by metric, lag, month) as xa, y - avg(y) over (partition by metric, lag, month) as ya,
           x - avg(x) over (partition by metric, lag, territory_id) as xt, y - avg(y) over (partition by metric, lag, territory_id) as yt
      from pr where x is not null),
  pw2 as (
    select *, xt - avg(xt) over (partition by metric, lag, month) as xw, yt - avg(yt) over (partition by metric, lag, month) as yw from pw)
  select metric, lag, count(*)::int, round(corr(xa, ya)::numeric, 3), round(corr(xw, yw)::numeric, 3)
    from pw2 where is_admin() group by metric, lag order by metric, lag;
$$;

-- ===== 5) Coverage bands -> results ======================================================================================
create or replace function dash_coverage_bands(p_from date, p_to date, p_line smallint default null) returns table (
  band text, territory_months int, territories int, ach numeric, growth numeric)
language sql stable security definer set search_path = public as $$
  with b as (
    select x.*, x.s_value / nullif(lag(x.s_value) over (partition by x.territory_id order by x.month), 0) - 1 as g
      from dash_territory_month((date_trunc('month', p_from) - interval '1 month')::date, p_to) x
     where p_line is null or x.line_id = p_line),
  c as (
    select *, case when coverage < 0.70 then '1. Below 70%' when coverage < 0.85 then '2. 70% to < 85%' else '3. 85% and above' end as band
      from b where not vacant and list_doctors > 0 and coverage is not null and month >= date_trunc('month', p_from)::date)
  select band, count(*)::int, count(distinct territory_id)::int, round(sum(s_value) / nullif(sum(t_value),0), 4), round(avg(g)::numeric, 4)
    from c where is_admin() group by band order by band;
$$;

-- ===== 6) Monthly overview (sales + KPIs) ==================================================================================
create or replace function dash_overview(p_from date, p_to date, p_line smallint default null) returns table (
  month date, s_value numeric, t_value numeric, ach numeric, list_doctors int, covered int, coverage numeric, pcf numeric,
  visits int, days_pm int, call_rate_pm numeric)
language sql stable security definer set search_path = public as $$
  with m as (select generate_series(date_trunc('month', p_from)::date, date_trunc('month', p_to)::date, interval '1 month')::date as month),
  sl as (select s.month, sum(s.s_value) sv, sum(s.t_value) tv
           from sales s join territories t on t.id = s.territory_id
          where s.month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date and (p_line is null or t.line_id = p_line)
          group by 1),
  kp as (select k.month, sum(k.list_doctors) l, sum(k.covered_doctors) c, sum(k.valid_visits) vv, sum(k.total_visits) tv, sum(k.days_pm) d
           from rep_month_kpi k
           left join (select distinct on (month, rep_id) month, rep_id, line_id from org_month where rep_id is not null order by month, rep_id) o
                  on o.month = k.month and o.rep_id = k.rep_id
          where k.month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date and (p_line is null or o.line_id = p_line)
          group by 1)
  select m.month, coalesce(sl.sv,0), coalesce(sl.tv,0), round(sl.sv / nullif(sl.tv,0), 4),
         coalesce(kp.l,0)::int, coalesce(kp.c,0)::int, round(kp.c::numeric / nullif(kp.l,0), 4), round(kp.vv::numeric / nullif(kp.tv,0), 4),
         coalesce(kp.tv,0)::int, coalesce(kp.d,0)::int, round(kp.tv::numeric / nullif(kp.d,0), 2)
    from m left join sl on sl.month = m.month left join kp on kp.month = m.month
   where is_admin() order by m.month;
$$;

-- ===== 7) Cost of absence + vacant vs filled (estimates, PM shift) ============================================================
create or replace function dash_absence_cost(p_from date, p_to date, p_line smallint default null) returns table (
  kind text, label text, days numeric, lost_visits numeric, est_lost_sales numeric, territories int, avg_ach numeric)
language sql stable security definer set search_path = public as $$
  with k as (
    select k.rep_id, k.month, k.missing_pm, k.leave_days, k.ow_days, k.activity_days, k.total_visits, k.days_pm,
           o.line_id
      from rep_month_kpi k
      left join (select distinct on (month, rep_id) month, rep_id, line_id from org_month where rep_id is not null order by month, rep_id) o
             on o.month = k.month and o.rep_id = k.rep_id
     where k.month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date and (p_line is null or o.line_id = p_line)),
  agg as (select sum(missing_pm) mis, sum(leave_days) lv, sum(ow_days) ow, sum(activity_days) ac,
                 sum(total_visits)::numeric / nullif(sum(days_pm),0) as cr, sum(total_visits) as vis from k),
  sv as (select sum(s.s_value) as sv
           from sales s join territories t on t.id = s.territory_id
          where s.month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date and (p_line is null or t.line_id = p_line)),
  spv as (select sv.sv / nullif((select vis from agg), 0) as v from sv),
  tm as (select * from dash_territory_month(p_from, p_to) x where p_line is null or x.line_id = p_line)
  select kind, label, days, round(days * (select cr from agg), 0), round(days * (select cr from agg) * (select v from spv), 0), null::int, null::numeric
    from (select 'absence'::text as kind, 'Missing days (PM)'::text as label, (select mis from agg)::numeric as days
          union all select 'absence', 'Leave days', (select lv from agg)
          union all select 'absence', 'Office work days', (select ow from agg)
          union all select 'absence', 'Activity days', (select ac from agg)) z
   where is_admin()
  union all
  select 'vacancy', case when vacant then 'Vacant territory-months' else 'Filled territory-months' end,
         null, null, case when vacant then sum(s_value) end, count(distinct territory_id)::int, round(sum(s_value) / nullif(sum(t_value),0), 4)
    from tm where is_admin() group by vacant;
$$;

do $$ declare f text; begin
  foreach f in array array['dash_territory_month(date,date)','dash_territory_summary(date,date,smallint)',
    'dash_effort_matrix(date,date,numeric,numeric,smallint)','dash_correlations(date,date,smallint)',
    'dash_coverage_bands(date,date,smallint)','dash_overview(date,date,smallint)','dash_absence_cost(date,date,smallint)'] loop
    execute 'revoke execute on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop; end $$;
