-- 75_dashboard_fewer_calls.sql
-- ONE call for all KPI building blocks, split by line and month.
-- The front end asks once for [previous period start .. period end] and sums what it needs (company = sum of lines;
-- a line filter = that line only; previous period = its months). This replaces 5+ parallel calls to dash_kpi_months.
create or replace function dash_kpi_months_lines(p_from date, p_to date) returns table (
  month date, line_id smallint, reps int, list_doctors int, covered_doctors int, total_visits int, valid_visits int, planned_visits int, direct_visits int,
  visits_am int, visits_pm int, pharmacy_visits int, days_am int, days_pm int, missing_am int, missing_pm int,
  leave_days int, ow_days int, activity_days int, expected_visits numeric)
language sql stable security definer set search_path = public as $$
  select k.month, k.line_id, count(*)::int, sum(k.list_doctors)::int, sum(k.covered_doctors)::int, sum(k.total_visits)::int, sum(k.valid_visits)::int,
         sum(k.planned_visits)::int, sum(k.direct_visits)::int, sum(k.visits_am)::int, sum(k.visits_pm)::int, sum(k.pharmacy_visits)::int,
         sum(k.days_am)::int, sum(k.days_pm)::int, sum(k.missing_am)::int, sum(k.missing_pm)::int,
         sum(k.leave_days)::int, sum(k.ow_days)::int, sum(k.activity_days)::int, sum(k.expected_visits)
    from v_kpi_rep k
   where is_admin() and k.month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
   group by k.month, k.line_id order by k.month, k.line_id;
$$;
revoke execute on function dash_kpi_months_lines(date, date) from public, anon;
grant execute on function dash_kpi_months_lines(date, date) to authenticated;
