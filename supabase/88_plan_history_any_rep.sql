-- =====================================================================
-- SFE Hub | 88_plan_history_any_rep.sql   (run AFTER 85, 86 and 87)
-- The history of a DOCTOR does not depend on which rep visited him: a new rep still inherits the doctors' usual days and hours.
--   plan_history_info()        -> one JSON: how much history the rep's list has (decides History / Geography / No plan)
--   plan_doctor_history()      -> the PM visits of the rep's list doctors by ANY rep (usual weekday + hours of each doctor)
--   plan_brick_pairs_any()     -> like plan_brick_pairs (86) but from the history of ANY rep who worked the rep's list bricks
--   plan_brick_repeats_any()   -> like plan_brick_repeats (87) but from the history of ANY rep
-- The rep's list = the same list plan_inputs() uses: the list of the month, or the latest earlier one.
-- Only the PM shift (Clinics + Poly Clinics) counts for doctor history, as in plan_actuals().
-- =====================================================================

-- the doctors of the rep's list (PM account types) with their brick, for the planning month
create or replace function plan_list_doctors(p_rep int, p_month date)
returns table(doctor_id int, brick text)
language sql stable security definer set search_path = public as $$
  with lm as (
    select max(month) as m from list_snapshot where rep_id = p_rep and month <= date_trunc('month', p_month)::date
  )
  select s.doctor_id, b.name
    from list_snapshot s
    join lm on s.month = lm.m
    join doctors d on d.id = s.doctor_id
    join account_types at on at.id = d.account_type_id and at.name in ('Clinics','Poly Clinics')
    left join bricks b on b.id = s.brick_id
   where s.rep_id = p_rep and s.freq > 0
$$;
grant execute on function plan_list_doctors(int, date) to authenticated;

-- ---------------------------------------------------------------------
-- plan_history_info: counts that decide the planning mode
--   list_doctors        doctors of the rep's PM list
--   doctors_with_any    of them, doctors with at least one PM visit by any rep in the window
--   doctors_with_time_any  of them, doctors with at least one PM visit that has a visit time
--   visits_own          PM visits of THIS rep in the last 3 months (decides whose brick history is used)
--   doctors_with_own    of them, doctors visited by this rep in the window
--   doctors_with_gps    of them, doctors with a known location (v_doctor_last_geo)
-- ---------------------------------------------------------------------
create or replace function plan_history_info(p_rep int, p_month date, p_months_back int default 6)
returns jsonb
language sql stable security definer set search_path = public as $$
  with ld as (select * from plan_list_doctors(p_rep, p_month)),
  hv as (
    select v.doctor_id, v.rep_id, v.visit_time
      from visits v
      join ld on ld.doctor_id = v.doctor_id
     where v.acc_type_code in ('C','PC')
       and v.visit_date >= (date_trunc('month', p_month) - make_interval(months => p_months_back))::date
       and v.visit_date <  date_trunc('month', p_month)::date
  )
  select jsonb_build_object(
    'list_doctors',          (select count(*) from ld),
    'doctors_with_any',      (select count(distinct doctor_id) from hv),
    'doctors_with_time_any', (select count(distinct doctor_id) from hv where visit_time is not null),
    'visits_own',            (select count(*) from visits v
                               where v.rep_id = p_rep and v.doctor_id is not null and v.acc_type_code in ('C','PC')
                                 and v.visit_date >= (date_trunc('month', p_month) - interval '3 months')::date
                                 and v.visit_date <  date_trunc('month', p_month)::date),
    'doctors_with_own',      (select count(distinct doctor_id) from hv where rep_id = p_rep),
    'doctors_with_gps',      (select count(*) from ld join v_doctor_last_geo g on g.doctor_id = ld.doctor_id)
  )
$$;
grant execute on function plan_history_info(int, date, int) to authenticated;

-- ---------------------------------------------------------------------
-- plan_doctor_history: one row per PM visit of a list doctor by any rep (by_rep = the rep who made it)
-- ---------------------------------------------------------------------
create or replace function plan_doctor_history(p_rep int, p_month date, p_months_back int default 6)
returns table(doctor_id int, visit_date date, visit_time time, by_rep int)
language sql stable security definer set search_path = public as $$
  select v.doctor_id, v.visit_date, v.visit_time, v.rep_id
    from visits v
    join plan_list_doctors(p_rep, p_month) ld on ld.doctor_id = v.doctor_id
   where v.acc_type_code in ('C','PC')
     and v.visit_date >= (date_trunc('month', p_month) - make_interval(months => p_months_back))::date
     and v.visit_date <  date_trunc('month', p_month)::date
   order by v.doctor_id, v.visit_date, v.visit_time
$$;
grant execute on function plan_doctor_history(int, date, int) to authenticated;

-- ---------------------------------------------------------------------
-- plan_brick_pairs_any: bricks worked in the same day by the same rep, for the bricks of the rep's list, from any rep's history
-- ---------------------------------------------------------------------
create or replace function plan_brick_pairs_any(p_rep int, p_month date, p_months_back int default 6)
returns table(brick_a text, brick_b text, pm_days_together int, any_days_together int, last_day date)
language sql stable security definer set search_path = public as $$
  with mine as (select distinct brick from plan_list_doctors(p_rep, p_month) where brick is not null),
  vb as (
    select v.rep_id, v.visit_date as day, v.shift_group,
           coalesce(b.name, nullif(trim(v.brick_raw), '')) as brick
      from visits v
      left join list_snapshot s on s.doctor_id = v.doctor_id
                               and s.month = date_trunc('month', v.visit_date)::date
      left join bricks b on b.id = s.brick_id
     where v.visit_date >= (date_trunc('month', p_month) - make_interval(months => p_months_back))::date
       and v.visit_date <  date_trunc('month', p_month)::date
       and v.acc_type_code in ('C','PC','H','AM','A')
  ),
  d as (select distinct rep_id, day, shift_group, brick from vb where brick in (select brick from mine)),
  any_p as (
    select x.brick as a, y.brick as b, count(distinct (x.rep_id, x.day)) as n, max(x.day) as last_day
      from d x join d y on y.rep_id = x.rep_id and y.day = x.day and y.brick > x.brick
     group by 1, 2),
  pm_p as (
    select x.brick as a, y.brick as b, count(distinct (x.rep_id, x.day)) as n
      from d x join d y on y.rep_id = x.rep_id and y.day = x.day and y.shift_group = x.shift_group and y.brick > x.brick
     where x.shift_group = 'PM'
     group by 1, 2)
  select a.a, a.b, coalesce(p.n, 0)::int, a.n::int, a.last_day
    from any_p a left join pm_p p on p.a = a.a and p.b = a.b
   order by coalesce(p.n, 0) desc, a.n desc
$$;
grant execute on function plan_brick_pairs_any(int, date, int) to authenticated;

-- ---------------------------------------------------------------------
-- plan_brick_repeats_any: same brick on two PM working days in a row, for the bricks of the rep's list, summed over any rep
-- ---------------------------------------------------------------------
create or replace function plan_brick_repeats_any(p_rep int, p_month date, p_months_back int default 6)
returns table(brick text, repeat_days int, brick_days int, last_repeat date)
language sql stable security definer set search_path = public as $$
  with mine as (select distinct brick from plan_list_doctors(p_rep, p_month) where brick is not null),
  wd as (
    select w.day, row_number() over (order by w.day) as n
      from working_days('PM',
                        (date_trunc('month', p_month) - make_interval(months => p_months_back))::date,
                        (date_trunc('month', p_month) - interval '1 day')::date) w
  ),
  vb as (
    select distinct v.rep_id, v.visit_date as day, coalesce(b.name, nullif(trim(v.brick_raw), '')) as brick
      from visits v
      left join list_snapshot s on s.doctor_id = v.doctor_id
                               and s.month = date_trunc('month', v.visit_date)::date
      left join bricks b on b.id = s.brick_id
     where v.shift_group = 'PM'
       and v.acc_type_code in ('C','PC')
       and v.visit_date >= (date_trunc('month', p_month) - make_interval(months => p_months_back))::date
       and v.visit_date <  date_trunc('month', p_month)::date
  ),
  d as (select vb.rep_id, vb.brick, wd.n, wd.day from vb join wd on wd.day = vb.day where vb.brick in (select brick from mine))
  select a.brick,
         (count(distinct (a.rep_id, a.day)) filter (where b.n is not null))::int as repeat_days,
         count(distinct (a.rep_id, a.day))::int as brick_days,
         max(a.day) filter (where b.n is not null) as last_repeat
    from d a
    left join d b on b.rep_id = a.rep_id and b.brick = a.brick and b.n = a.n + 1
   group by a.brick
   order by 2 desc, 3 desc
$$;
grant execute on function plan_brick_repeats_any(int, date, int) to authenticated;
