-- =====================================================================
-- SFE Hub | 86_plan_brick_pairs.sql   (run AFTER 85_monthly_plan.sql)
-- Which Bricks did the rep REALLY work in the same day before? (decides if two bricks may share a planned day)
--   plan_brick_pairs(rep, month, months_back) -> one row per pair of bricks:
--     pm_days_together  = days where BOTH bricks were visited in the PM shift (C + PC)
--     any_days_together = days where both were visited in any shift (e.g. AM hospital in brick X, PM clinics in brick Y)
--     doctors_a / doctors_b = how many doctors per brick in the rep's list (to see small bricks)
-- The brick of a visit = the brick of the doctor in the list of the visit's month (fallback: brick_raw of the CRM).
-- =====================================================================
create or replace function plan_brick_pairs(p_rep int, p_month date, p_months_back int default 6)
returns table(brick_a text, brick_b text, pm_days_together int, any_days_together int, last_day date)
language sql stable security definer set search_path = public as $$
  with vb as (
    select v.visit_date as day, v.shift_group,
           coalesce(b.name, nullif(trim(v.brick_raw), '')) as brick
      from visits v
      left join list_snapshot s on s.doctor_id = v.doctor_id
                               and s.month = date_trunc('month', v.visit_date)::date
      left join bricks b on b.id = s.brick_id
     where v.rep_id = p_rep
       and v.visit_date >= (date_trunc('month', p_month) - make_interval(months => p_months_back))::date
       and v.visit_date <  date_trunc('month', p_month)::date
       and v.acc_type_code in ('C','PC','H','AM','A')
  ),
  d as (select distinct day, shift_group, brick from vb where brick is not null),
  any_p as (
    select x.brick as a, y.brick as b, count(distinct x.day) as n, max(x.day) as last_day
      from d x join d y on y.day = x.day and y.brick > x.brick
     group by 1, 2),
  pm_p as (
    select x.brick as a, y.brick as b, count(distinct x.day) as n
      from d x join d y on y.day = x.day and y.shift_group = x.shift_group and y.brick > x.brick
     where x.shift_group = 'PM'
     group by 1, 2)
  select a.a, a.b, coalesce(p.n, 0)::int, a.n::int, a.last_day
    from any_p a left join pm_p p on p.a = a.a and p.b = a.b
   order by coalesce(p.n, 0) desc, a.n desc
$$;
grant execute on function plan_brick_pairs(int, date, int) to authenticated;
