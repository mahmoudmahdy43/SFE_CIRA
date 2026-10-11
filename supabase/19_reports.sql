-- =====================================================================
-- SFE Hub | 19_reports.sql  (run NINETEENTH)
-- Two reports, one row per rep per month, read-only views (RLS applies via security_invoker):
--   v_coverage_report   : Box, Rep, DM, hire date, List, fully / partially / not visited, coverage %
--   v_call_rate_report  : Box, Rep, DM, hire date, working / field days, leave, OW, activity, visits, call rate  (AM + PM)
--   v_coverage_doctors  : doctor-level drill-down behind the coverage report
-- Definitions (same as the KPI engine, so numbers always agree with the Dashboard):
--   fully covered     = visits to the doctor by this rep in the month >= Freq
--   partially covered = 1 <= visits < Freq
--   not visited       = 0 visits
--   Coverage %        = (fully + partially) / List        (= Dashboard Coverage)
--   Working days      = every working slot of the rep (calendar days x shift, minus holidays, within employment)
--   Field days        = working slots that are NOT leave / office work / activity  (= worked + missing)
--   Call rate (shift) = visits in shift / field days in shift   (= Dashboard Call Rate AM / PM)
-- =====================================================================

-- per rep-month: box names + manager names (a rep can sit in two boxes / have two DMs during a month)
create or replace view v_rep_org_month with (security_invoker = true) as
select o.month, o.rep_id,
       string_agg(distinct b.name, ' + ' order by b.name) as box,
       string_agg(distinct m.name, ' + ' order by m.name) as manager,
       min(o.line_id) as line_id, min(o.manager_id) as manager_id
from org_month o
join boxes b on b.id = o.box_id
left join managers m on m.id = o.manager_id
where o.rep_id is not null
group by o.month, o.rep_id;

-- doctor level: one row per list doctor per month
create or replace view v_coverage_doctors with (security_invoker = true) as
with vdoc as (
  select date_trunc('month', visit_date)::date as month, rep_id, doctor_id, count(*) as n
  from visits
  where rep_id is not null and doctor_id is not null
  group by 1, 2, 3
)
select l.month, l.rep_id, l.doctor_id, d.doctor_name, d.account_name, l.class, l.freq,
       coalesce(v.n, 0) as visits,
       case when coalesce(v.n, 0) = 0 then 'not_visited'
            when v.n >= l.freq        then 'fully'
            else 'partially' end as status
from list_snapshot l
join doctors d on d.id = l.doctor_id
left join vdoc v on v.month = l.month and v.rep_id = l.rep_id and v.doctor_id = l.doctor_id;

-- Coverage report
create or replace view v_coverage_report with (security_invoker = true) as
with c as (
  select month, rep_id,
         count(*)                                   as list_doctors,
         count(*) filter (where status = 'fully')       as fully_covered,
         count(*) filter (where status = 'partially')   as partially_covered,
         count(*) filter (where status = 'not_visited') as not_visited
  from v_coverage_doctors
  group by month, rep_id
)
select c.month, o.line_id, o.manager_id,
       o.box, r.code as rep_code, r.name as rep_name, o.manager, r.hire_date,
       c.rep_id, c.list_doctors, c.fully_covered, c.partially_covered, c.not_visited,
       round((c.fully_covered + c.partially_covered)::numeric / nullif(c.list_doctors, 0), 4) as coverage
from c
join reps r on r.id = c.rep_id
left join v_rep_org_month o on o.month = c.month and o.rep_id = c.rep_id;

-- Call rate report (AM + PM + total)
create or replace view v_call_rate_report with (security_invoker = true) as
with s as (
  select date_trunc('month', day)::date as month, rep_id,
         count(*) filter (where shift = 'AM')                                   as working_am,
         count(*) filter (where shift = 'PM')                                   as working_pm,
         count(*) filter (where shift = 'AM' and status in ('worked','missing')) as field_am,
         count(*) filter (where shift = 'PM' and status in ('worked','missing')) as field_pm,
         count(*) filter (where shift = 'AM' and status = 'leave')       as leave_am,
         count(*) filter (where shift = 'PM' and status = 'leave')       as leave_pm,
         count(*) filter (where shift = 'AM' and status = 'office_work') as ow_am,
         count(*) filter (where shift = 'PM' and status = 'office_work') as ow_pm,
         count(*) filter (where shift = 'AM' and status = 'activity')    as activity_am,
         count(*) filter (where shift = 'PM' and status = 'activity')    as activity_pm,
         count(*) filter (where shift = 'AM' and status = 'missing')     as missing_am,
         count(*) filter (where shift = 'PM' and status = 'missing')     as missing_pm
  from rep_day_shift
  group by 1, 2
)
select s.month, o.line_id, o.manager_id,
       o.box, r.code as rep_code, r.name as rep_name, o.manager, r.hire_date, s.rep_id,
       s.working_am, s.working_pm, s.working_am + s.working_pm as working_total,
       s.field_am,   s.field_pm,   s.field_am + s.field_pm     as field_total,
       s.leave_am,   s.leave_pm,   s.leave_am + s.leave_pm     as leave_total,
       s.ow_am,      s.ow_pm,      s.ow_am + s.ow_pm           as ow_total,
       s.activity_am, s.activity_pm, s.activity_am + s.activity_pm as activity_total,
       s.missing_am, s.missing_pm, s.missing_am + s.missing_pm as missing_total,
       coalesce(v.visits_am, 0) as visits_am, coalesce(v.visits_pm, 0) as visits_pm,
       coalesce(v.visits_am, 0) + coalesce(v.visits_pm, 0) as visits_total,
       round(coalesce(v.visits_am, 0)::numeric / nullif(s.field_am, 0), 2) as call_rate_am,
       round(coalesce(v.visits_pm, 0)::numeric / nullif(s.field_pm, 0), 2) as call_rate_pm,
       round((coalesce(v.visits_am, 0) + coalesce(v.visits_pm, 0))::numeric / nullif(s.field_am + s.field_pm, 0), 2) as call_rate_total
from s
join reps r on r.id = s.rep_id
left join v_rep_org_month o on o.month = s.month and o.rep_id = s.rep_id
left join v_rep_visits_shift v on v.month = s.month and v.rep_id = s.rep_id;

grant select on v_rep_org_month, v_coverage_doctors, v_coverage_report, v_call_rate_report to authenticated;
