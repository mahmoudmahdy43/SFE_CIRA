-- =====================================================================
-- SFE Hub | 13_kpi_views.sql  (run THIRTEENTH)
-- KPI roll-ups for the dashboard. Ratios are ALWAYS recomputed from sums (never averages of ratios):
--   Coverage = sum(covered)/sum(list)   PCF = sum(valid)/sum(total)
--   AchCR    = sum(total)/sum(expected) with expected = target_am*days_am + target_pm*days_pm
--   Total    = PCF*50% + Coverage*35% + AchCR*15%
--   Call rate AM/PM = sum(visits in shift)/sum(actual days in shift)  (needs am/pm visit counts -> derived below)
-- security_invoker => the caller's RLS applies (admin sees all, DM/rep scoped).
-- =====================================================================

-- AM / PM visit counts per rep-month (rep rows only)
create or replace view v_rep_visits_shift with (security_invoker = true) as
select date_trunc('month', visit_date)::date as month, rep_id,
       count(*) filter (where shift = 'AM') as visits_am,
       count(*) filter (where shift = 'PM') as visits_pm
from visits where rep_id is not null group by 1, 2;

-- one row per rep-month with org info and expected visits
create or replace view v_kpi_rep with (security_invoker = true) as
select k.*,
       o.line_id, o.manager_id, o.nsm_id,
       coalesce(vs.visits_am, 0) as visits_am, coalesce(vs.visits_pm, 0) as visits_pm,
       coalesce(k.target_am, 0) * coalesce(k.days_am, 0) + coalesce(k.target_pm, 0) * coalesce(k.days_pm, 0) as expected_visits
from rep_month_kpi k
left join (select distinct on (month, rep_id) month, rep_id, line_id, manager_id, nsm_id
             from org_month where rep_id is not null order by month, rep_id) o
       on o.month = k.month and o.rep_id = k.rep_id
left join v_rep_visits_shift vs on vs.month = k.month and vs.rep_id = k.rep_id;

-- generic roll-up (group key: line_id / manager_id / nsm_id / none)
create or replace view v_kpi_manager with (security_invoker = true) as
select month, line_id, manager_id,
       count(*) as reps, sum(list_doctors) as list_doctors, sum(covered_doctors) as covered_doctors,
       sum(total_visits) as total_visits, sum(valid_visits) as valid_visits,
       sum(planned_visits) as planned_visits, sum(direct_visits) as direct_visits,
       sum(days_am) as days_am, sum(days_pm) as days_pm, sum(missing_am) as missing_am, sum(missing_pm) as missing_pm,
       sum(leave_days) as leave_days, sum(ow_days) as ow_days, sum(activity_days) as activity_days,
       sum(visits_am) as visits_am, sum(visits_pm) as visits_pm, sum(expected_visits) as expected_visits,
       round(sum(covered_doctors)::numeric / nullif(sum(list_doctors), 0), 4) as coverage,
       round(sum(valid_visits)::numeric / nullif(sum(total_visits), 0), 4) as pcf,
       round(sum(total_visits)::numeric / nullif(sum(expected_visits), 0), 4) as ach_cr,
       round(sum(visits_am)::numeric / nullif(sum(days_am), 0), 2) as call_rate_am,
       round(sum(visits_pm)::numeric / nullif(sum(days_pm), 0), 2) as call_rate_pm,
       round(coalesce(sum(valid_visits)::numeric / nullif(sum(total_visits), 0), 0) * 0.50
           + coalesce(sum(covered_doctors)::numeric / nullif(sum(list_doctors), 0), 0) * 0.35
           + coalesce(sum(total_visits)::numeric / nullif(sum(expected_visits), 0), 0) * 0.15, 4) as total_kpi
from v_kpi_rep group by month, line_id, manager_id;

create or replace view v_kpi_line with (security_invoker = true) as
select month, line_id,
       count(*) as reps, sum(list_doctors) as list_doctors, sum(covered_doctors) as covered_doctors,
       sum(total_visits) as total_visits, sum(valid_visits) as valid_visits,
       sum(planned_visits) as planned_visits, sum(direct_visits) as direct_visits,
       sum(days_am) as days_am, sum(days_pm) as days_pm, sum(missing_am) as missing_am, sum(missing_pm) as missing_pm,
       sum(leave_days) as leave_days, sum(ow_days) as ow_days, sum(activity_days) as activity_days,
       sum(visits_am) as visits_am, sum(visits_pm) as visits_pm, sum(expected_visits) as expected_visits,
       round(sum(covered_doctors)::numeric / nullif(sum(list_doctors), 0), 4) as coverage,
       round(sum(valid_visits)::numeric / nullif(sum(total_visits), 0), 4) as pcf,
       round(sum(total_visits)::numeric / nullif(sum(expected_visits), 0), 4) as ach_cr,
       round(sum(visits_am)::numeric / nullif(sum(days_am), 0), 2) as call_rate_am,
       round(sum(visits_pm)::numeric / nullif(sum(days_pm), 0), 2) as call_rate_pm,
       round(coalesce(sum(valid_visits)::numeric / nullif(sum(total_visits), 0), 0) * 0.50
           + coalesce(sum(covered_doctors)::numeric / nullif(sum(list_doctors), 0), 0) * 0.35
           + coalesce(sum(total_visits)::numeric / nullif(sum(expected_visits), 0), 0) * 0.15, 4) as total_kpi
from v_kpi_rep group by month, line_id;

create or replace view v_kpi_company with (security_invoker = true) as
select month,
       count(*) as reps, sum(list_doctors) as list_doctors, sum(covered_doctors) as covered_doctors,
       sum(total_visits) as total_visits, sum(valid_visits) as valid_visits,
       sum(planned_visits) as planned_visits, sum(direct_visits) as direct_visits,
       sum(days_am) as days_am, sum(days_pm) as days_pm, sum(missing_am) as missing_am, sum(missing_pm) as missing_pm,
       sum(leave_days) as leave_days, sum(ow_days) as ow_days, sum(activity_days) as activity_days,
       sum(visits_am) as visits_am, sum(visits_pm) as visits_pm, sum(expected_visits) as expected_visits,
       round(sum(covered_doctors)::numeric / nullif(sum(list_doctors), 0), 4) as coverage,
       round(sum(valid_visits)::numeric / nullif(sum(total_visits), 0), 4) as pcf,
       round(sum(total_visits)::numeric / nullif(sum(expected_visits), 0), 4) as ach_cr,
       round(sum(visits_am)::numeric / nullif(sum(days_am), 0), 2) as call_rate_am,
       round(sum(visits_pm)::numeric / nullif(sum(days_pm), 0), 2) as call_rate_pm,
       round(coalesce(sum(valid_visits)::numeric / nullif(sum(total_visits), 0), 0) * 0.50
           + coalesce(sum(covered_doctors)::numeric / nullif(sum(list_doctors), 0), 0) * 0.35
           + coalesce(sum(total_visits)::numeric / nullif(sum(expected_visits), 0), 0) * 0.15, 4) as total_kpi
from v_kpi_rep group by month;

grant select on v_rep_visits_shift, v_kpi_rep, v_kpi_manager, v_kpi_line, v_kpi_company to authenticated;
