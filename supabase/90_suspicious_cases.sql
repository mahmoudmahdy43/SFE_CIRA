-- =====================================================================
-- SFE Hub | 90_suspicious_cases.sql   (run AFTER 22 and 84; needs visits.dev_lat / dev_lng / acc_lat / acc_lng / deviation_m / visit_time)
-- "Suspicious Cases" report: many different PM clinics (acc types C and PC) of ONE rep that share the same GPS cell of the DEVICE position
-- (p_decimals = 3 -> about 110 m). The report shows data patterns, not proof.
--
--   suspicious_clusters(p_from, p_to, p_min_clinics, p_decimals)   one row per rep and cell
--   suspicious_cluster_detail(p_rep, p_cell_lat, p_cell_lng, p_from, p_to)   one row per clinic of that rep and cell
--
-- Both are SECURITY INVOKER: row level security of visits / reps / org_month applies to the caller. Read-only.
-- p_to is EXCLUSIVE (the first day after the range).
--
-- Definitions
--   PM clinic visit = visits.acc_type_code in ('C','PC'), shift PM (shift_group, else shift), done by a rep (rep_id not null).
--   cell            = round(dev_lat, p_decimals), round(dev_lng, p_decimals) of the position of the DEVICE at the visit (inside Egypt).
--   deviation (m)   = visits.deviation_m (device to registered clinic); when it is null, the distance between the device and acc_lat / acc_lng.
--   registered here = the clinic's average deviation at this cell is <= 300 m   (the clinic itself sits at this point)
--   visit from far  = the clinic's average deviation is  > 300 m                (the clinic is registered elsewhere, the visit was logged here)
--   night visit     = visit_time >= 23:00 or < 06:00
--   other reps      = other reps with 3+ visits at the same cell in the range (a medical building shared by many reps is less suspicious)
--   severity (thresholds are in ONE place, the CASE at the end of suspicious_clusters):
--       High   : at least 25 clinics and no other rep at the point
--       Medium : at least 15 clinics and at most one other rep at the point
--       Low    : the rest
--   line_id / manager_id : from org_month of the month of p_from, else the latest earlier month the rep has a row in.
--   v2: the functions are dropped and recreated (suspicious_clusters now also returns line_id).
-- =====================================================================

drop function if exists suspicious_clusters(date, date, int, int);
drop function if exists suspicious_cluster_detail(int, numeric, numeric, date, date);

create function suspicious_clusters(
  p_from date, p_to date, p_min_clinics int default 10, p_decimals int default 3)
returns table(
  rep_id int, rep_name text, rep_code text, rep_status text, resign_date date, line_id int, manager_id int,
  cell_lat numeric, cell_lng numeric,
  clinics int, visits int, visit_days int, pct_of_rep_pm_visits numeric,
  clinics_registered_here int, clinics_far int, visits_far int, night_visits int, other_reps_at_cell int,
  first_visit date, last_visit date, severity text)
language sql stable security invoker set search_path = public as $$
  with pm as (                                   -- every PM clinic visit of a rep in the range
    select v.rep_id, v.visit_date, v.visit_time,
           coalesce(v.account_ext_id, v.doctor_id::text, v.account_raw) as clinic,
           v.dev_lat::numeric as dlat, v.dev_lng::numeric as dlng,
           coalesce(v.deviation_m::numeric,
                    case when v.acc_lat is not null and v.acc_lng is not null and v.dev_lat is not null and v.dev_lng is not null then
                      2 * 6371000 * asin(least(1, sqrt(
                        power(sin(radians(v.acc_lat - v.dev_lat) / 2), 2)
                        + cos(radians(v.dev_lat)) * cos(radians(v.acc_lat)) * power(sin(radians(v.acc_lng - v.dev_lng) / 2), 2)))) end) as dev_m
      from visits v
     where v.visit_date >= p_from and v.visit_date < p_to
       and v.rep_id is not null
       and v.acc_type_code in ('C', 'PC')
       and coalesce(v.shift_group, v.shift) = 'PM'),
  totals as (select rep_id, count(*) as n from pm group by rep_id),
  pos as (                                       -- the visits that have a usable device position (inside Egypt)
    select pm.*, round(dlat, p_decimals) as clat, round(dlng, p_decimals) as clng
      from pm
     where dlat between 21.5 and 31.8 and dlng between 24.5 and 37),
  per_clinic as (
    select rep_id, clat, clng, clinic,
           count(*) as n, avg(dev_m) as avg_dev, count(*) filter (where dev_m > 300) as n_far,
           count(*) filter (where visit_time >= time '23:00' or visit_time < time '06:00') as n_night,
           count(distinct visit_date) as days, min(visit_date) as first_v, max(visit_date) as last_v
      from pos group by rep_id, clat, clng, clinic),
  cell as (
    select rep_id, clat, clng,
           count(*)::int as clinics, sum(n)::int as visits,
           count(*) filter (where coalesce(avg_dev, 0) <= 300)::int as clinics_here,
           count(*) filter (where avg_dev > 300)::int as clinics_far,
           sum(n_far)::int as visits_far, sum(n_night)::int as night_visits,
           min(first_v) as first_visit, max(last_v) as last_visit
      from per_clinic group by rep_id, clat, clng),
  cell_days as (select rep_id, clat, clng, count(distinct visit_date)::int as visit_days from pos group by rep_id, clat, clng),
  cell_reps as (                                 -- reps with 3+ visits at a cell
    select clat, clng, count(*)::int as reps from (select rep_id, clat, clng from pos group by rep_id, clat, clng having count(*) >= 3) x group by clat, clng)
  select c.rep_id, r.name, r.code, r.status, r.resign_date, o.line_id::int, o.manager_id,
         c.clat, c.clng,
         c.clinics, c.visits, cd.visit_days,
         round(100.0 * c.visits / nullif(t.n, 0), 1),
         c.clinics_here, c.clinics_far, c.visits_far, c.night_visits,
         greatest(coalesce(cr.reps, 1) - 1, 0),
         c.first_visit, c.last_visit,
         case
           when c.clinics >= 25 and greatest(coalesce(cr.reps, 1) - 1, 0) = 0 then 'High'
           when c.clinics >= 15 and greatest(coalesce(cr.reps, 1) - 1, 0) <= 1 then 'Medium'
           else 'Low' end
    from cell c
    join reps r on r.id = c.rep_id
    join totals t on t.rep_id = c.rep_id
    join cell_days cd on cd.rep_id = c.rep_id and cd.clat = c.clat and cd.clng = c.clng
    left join cell_reps cr on cr.clat = c.clat and cr.clng = c.clng
    left join lateral (select om.line_id, om.manager_id from org_month om
                        where om.rep_id = c.rep_id and om.month <= date_trunc('month', p_from)::date
                        order by om.month desc, om.territory_id limit 1) o on true
   where c.clinics >= p_min_clinics
   order by c.clinics desc, c.visits desc, c.rep_id
$$;
grant execute on function suspicious_clusters(date, date, int, int) to authenticated;

create function suspicious_cluster_detail(
  p_rep int, p_cell_lat numeric, p_cell_lng numeric, p_from date, p_to date)
returns table(
  account text, acc_type_code text, visits int, first_visit date, last_visit date,
  avg_deviation_m numeric, acc_lat numeric, acc_lng numeric, pattern text, visit_log jsonb)
language sql stable security invoker set search_path = public as $$
  with prm as (select 0.5 * power(10::numeric, -scale(p_cell_lat)) as half),      -- the cell size follows the decimals of the cell passed in
  pm as (
    select v.visit_date, v.visit_time, v.acc_type_code as t,
           coalesce(v.account_ext_id, v.doctor_id::text, v.account_raw) as clinic,
           coalesce(d.account_name, v.account_raw) as acc_name,
           v.acc_lat::numeric as alat, v.acc_lng::numeric as alng,
           coalesce(v.deviation_m::numeric,
                    case when v.acc_lat is not null and v.acc_lng is not null then
                      2 * 6371000 * asin(least(1, sqrt(
                        power(sin(radians(v.acc_lat - v.dev_lat) / 2), 2)
                        + cos(radians(v.dev_lat)) * cos(radians(v.acc_lat)) * power(sin(radians(v.acc_lng - v.dev_lng) / 2), 2)))) end) as dev_m
      from visits v
      left join doctors d on d.id = v.doctor_id
      cross join prm
     where v.rep_id = p_rep
       and v.visit_date >= p_from and v.visit_date < p_to
       and v.acc_type_code in ('C', 'PC')
       and coalesce(v.shift_group, v.shift) = 'PM'
       and v.dev_lat is not null and v.dev_lng is not null
       and v.dev_lat::numeric >= p_cell_lat - prm.half and v.dev_lat::numeric < p_cell_lat + prm.half
       and v.dev_lng::numeric >= p_cell_lng - prm.half and v.dev_lng::numeric < p_cell_lng + prm.half)
  select coalesce(max(acc_name), clinic), max(t), count(*)::int, min(visit_date), max(visit_date),
         round(avg(dev_m), 0), max(alat), max(alng),
         case when coalesce(avg(dev_m), 0) <= 300 then 'registered_here' else 'visit_far' end,
         jsonb_agg(jsonb_build_object('d', visit_date, 't', left(visit_time::text, 5)) order by visit_date, visit_time)
    from pm
   group by clinic
   order by count(*) desc, 1
$$;
grant execute on function suspicious_cluster_detail(int, numeric, numeric, date, date) to authenticated;
