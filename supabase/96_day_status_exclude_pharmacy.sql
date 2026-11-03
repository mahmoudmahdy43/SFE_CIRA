-- =====================================================================
-- SFE Hub | 96_day_status_exclude_pharmacy.sql
-- AM / PM slot status ignores PHARMACY visits: a rep whose only visits in a shift are pharmacies is "missing" for that
-- AM/PM slot. Pharmacy visits still count in the Pharmacy shift report (visits / pharmacy call rate), which reads visits directly.
-- After running:  select refresh_month(date '2026-09-01');  (and every other loaded month, e.g. 2026-10-01)
-- =====================================================================
create or replace function refresh_rep_day_shift(p_month date) returns int
language plpgsql security definer set search_path = public as $$
declare v_end date := month_end(p_month); n int;
  v_cap date := (now() at time zone 'Africa/Cairo')::date;   -- no slots after today
begin
  perform assert_admin();
  delete from rep_day_shift where day between p_month and v_end;

  insert into rep_day_shift (rep_id, day, shift, visits, leave, office_work, activity, status)
  with slots as (
    select rb.rep_id, w.day, s.shift
    from rep_box rb
    cross join (values ('AM'),('PM')) s(shift)
    cross join lateral working_days(s.shift,
        greatest(rb.valid_from, p_month), least(coalesce(rb.valid_to, v_end), v_end, v_cap)) w
    where rb.valid_from <= v_end and coalesce(rb.valid_to, 'infinity') >= p_month
    union
    -- OPTION: an off-day PM slot (Thu PM / Fri / holiday) opens as a worked day when the rep made >= N clinic /
    -- polyclinic visits that day, and has no approved leave / office work / activity on it.
    select rb.rep_id, d::date, 'PM'
    from rep_box rb
    cross join lateral generate_series(greatest(rb.valid_from, p_month)::timestamp,
                                       least(coalesce(rb.valid_to, v_end), v_end, v_cap)::timestamp, interval '1 day') d
    where offday_pm_enabled()
      and rb.valid_from <= v_end and coalesce(rb.valid_to, 'infinity') >= p_month
      and not exists (select 1 from working_days('PM', d::date, d::date))
      and (select count(distinct v3.visit_key) from visits v3
            where v3.rep_id = rb.rep_id and v3.visit_date = d::date and v3.shift = 'PM'
              and v3.acc_type_code in ('C','PC')) >= offday_pm_min_visits()
      and not exists (select 1 from leaves l where l.rep_id = rb.rep_id and lower(trim(l.status)) = 'approved'
                        and d::date between l.start_date and l.end_date and l.shift in ('PM','FULL'))
      and not exists (select 1 from office_work o where o.rep_id = rb.rep_id and o.day = d::date and o.shift in ('PM','FULL'))
      and not exists (select 1 from activities a where a.rep_id = rb.rep_id and a.day = d::date and a.shift in ('PM','FULL'))
  ),
  v as (
    select rep_id, visit_date as day, shift, count(*) c
    from visits
    where rep_id is not null and visit_date between p_month and v_end
      and shift_group <> 'PHARMACY'      -- pharmacy visits never make an AM/PM slot "worked"
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

