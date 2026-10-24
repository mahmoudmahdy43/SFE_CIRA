-- =====================================================================
-- SFE Hub | 87_plan_brick_repeats.sql   (run AFTER 85_monthly_plan.sql)
-- Did the rep REALLY work the same Brick on two PM working days in a row before?
-- The planner never puts the same brick on consecutive working days, except where this history says the rep did it
-- (repeat_days >= 2), and then only a few times as a last resort.
--   plan_brick_repeats(rep, month, months_back) -> one row per brick:
--     brick_days   = PM days the rep visited the brick (C + PC)
--     repeat_days  = of those, days where the brick was visited again on the NEXT PM working day
--                    (Thursday, Friday and holidays do not count: working_days('PM') decides)
--     last_repeat  = the latest such day
-- The brick of a visit = the brick of the doctor in the list of the visit's month (fallback: brick_raw of the CRM).
-- =====================================================================
create or replace function plan_brick_repeats(p_rep int, p_month date, p_months_back int default 6)
returns table(brick text, repeat_days int, brick_days int, last_repeat date)
language sql stable security definer set search_path = public as $$
  with wd as (
    select w.day, row_number() over (order by w.day) as n
      from working_days('PM',
                        (date_trunc('month', p_month) - make_interval(months => p_months_back))::date,
                        (date_trunc('month', p_month) - interval '1 day')::date) w
  ),
  vb as (
    select distinct v.visit_date as day, coalesce(b.name, nullif(trim(v.brick_raw), '')) as brick
      from visits v
      left join list_snapshot s on s.doctor_id = v.doctor_id
                               and s.month = date_trunc('month', v.visit_date)::date
      left join bricks b on b.id = s.brick_id
     where v.rep_id = p_rep
       and v.shift_group = 'PM'
       and v.acc_type_code in ('C','PC')
       and v.visit_date >= (date_trunc('month', p_month) - make_interval(months => p_months_back))::date
       and v.visit_date <  date_trunc('month', p_month)::date
  ),
  d as (select vb.brick, wd.n, wd.day from vb join wd on wd.day = vb.day where vb.brick is not null)
  select a.brick,
         (count(distinct a.day) filter (where b.n is not null))::int as repeat_days,
         count(distinct a.day)::int as brick_days,
         max(a.day) filter (where b.n is not null) as last_repeat
    from d a
    left join d b on b.brick = a.brick and b.n = a.n + 1
   group by a.brick
   order by 2 desc, 3 desc
$$;
grant execute on function plan_brick_repeats(int, date, int) to authenticated;
