-- =====================================================================
-- SFE Hub | 97_pharmacy_missing_days.sql   (run after 96)
-- Pharmacy shift gets its own day status: a working slot (not leave / office work / activity) is
--   worked  = the rep made at least one PHARMACY visit that day
--   missing = no pharmacy visit that day
-- Days = slots x 0.5 (AM + PM), exactly like the other shifts. New: rep_day_shift.ph_status, v_call_rate_report.worked_ph / missing_ph.
-- After running:  select refresh_month(date '2026-09-01');  select refresh_month(date '2026-10-01');
-- =====================================================================
alter table rep_day_shift add column if not exists ph_status text;

create or replace function refresh_rep_day_shift(p_month date) returns int
language plpgsql security definer set search_path = public as $$
declare v_end date := month_end(p_month); n int;
  v_cap date := (now() at time zone 'Africa/Cairo')::date;   -- no slots after today
begin
  perform assert_admin();
  delete from rep_day_shift where day between p_month and v_end;

  insert into rep_day_shift (rep_id, day, shift, visits, leave, office_work, activity, status, ph_status)
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
  phd as (   -- days on which the rep made at least one pharmacy visit
    select distinct rep_id, visit_date as day
    from visits
    where rep_id is not null and shift_group = 'PHARMACY' and visit_date between p_month and v_end
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
              else 'missing' end,
         -- Pharmacy shift: leave / office work / activity slots are not pharmacy slots; otherwise the day is worked
         -- when the rep made any pharmacy visit that day, missing when not.
         case when lv.rep_id is not null or ow.rep_id is not null or ac.rep_id is not null then null
              when phd.rep_id is not null then 'worked'
              else 'missing' end
  from slots s
  left join v  on (v.rep_id, v.day, v.shift)  = (s.rep_id, s.day, s.shift)
  left join lv on (lv.rep_id, lv.day, lv.shift) = (s.rep_id, s.day, s.shift)
  left join ow on (ow.rep_id, ow.day, ow.shift) = (s.rep_id, s.day, s.shift)
  left join ac on (ac.rep_id, ac.day, ac.shift) = (s.rep_id, s.day, s.shift)
  left join phd on (phd.rep_id, phd.day) = (s.rep_id, s.day);

  get diagnostics n = row_count;
  return n;
end $$;


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
         count(*) filter (where shift = 'PM' and status = 'missing')     as missing_pm,
         count(*) filter (where ph_status = 'worked')                    as worked_ph,
         count(*) filter (where ph_status = 'missing')                   as missing_ph
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
       round((coalesce(v.visits_am, 0) + coalesce(v.visits_pm, 0))::numeric / nullif(s.field_am + s.field_pm, 0), 2) as call_rate_total,
       coalesce(v.visits_pharmacy, 0) as visits_pharmacy,
       round((s.field_am + s.field_pm)::numeric / 2, 1) as field_days,
       round(coalesce(v.visits_pharmacy, 0)::numeric / nullif((s.field_am + s.field_pm)::numeric / 2, 0), 2) as call_rate_pharmacy,
       s.worked_ph, s.missing_ph
from s
join reps r on r.id = s.rep_id
left join v_rep_org_month o on o.month = s.month and o.rep_id = s.rep_id
left join v_rep_visits_shift v on v.month = s.month and v.rep_id = s.rep_id;


notify pgrst, 'reload schema';
