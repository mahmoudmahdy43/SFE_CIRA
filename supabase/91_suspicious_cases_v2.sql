-- =====================================================================
-- SFE Hub | 91_suspicious_cases_v2.sql   (run AFTER 90_suspicious_cases.sql; the v1 functions are left untouched)
-- "Suspicious Cases" v2: the unit is the ACCOUNT (clinic, hospital, polyclinic), the AM shift is selectable, and every visit is Double or Single.
-- The report shows data patterns, not proof.
--
--   suspicious_clusters_v2(p_from, p_to, p_min_accounts, p_shifts, p_decimals)               one row per rep and cell
--   suspicious_cluster_detail_v2(p_rep, p_cell_lat, p_cell_lng, p_from, p_to, p_shifts, p_visit_filter)   one row per account of that rep and cell
--
-- SECURITY INVOKER (row level security of visits / managers / reps / org_month applies to the caller). Read-only. p_to is EXCLUSIVE.
--
-- Definitions
--   visit           = a rep row of visits (rep_id not null) with shift_group in p_shifts ('PM', 'AM'); pharmacies (shift_group PHARMACY) stay out.
--   account key     = account_type_id + account_ext_id (the Account ID); when account_ext_id is null: the account name (lower, trimmed).
--   cell            = round(dev_lat, p_decimals), round(dev_lng, p_decimals) of the DEVICE position at the visit (inside Egypt).
--   Double visit    = a manager row (manager_id not null) with the same visit_key and visit_date exists. Single = no such row.
--   registered here = the account's average deviation at the cell is <= 300 m; from far = > 300 m.
--   night visit     = visit_time >= 23:00 or < 06:00.
--   other reps      = other reps with 3+ visits at the same cell in the range.
--   severity (ONE place: the CASE at the end of suspicious_clusters_v2), on ACCOUNTS:
--       High   : at least 25 accounts and no other rep at the point
--       Medium : at least 15 accounts and at most one other rep at the point
--       Low    : the rest
--   line_id / manager_id: org_month of the month of p_from, else the latest earlier month the rep has a row in.
-- =====================================================================

drop function if exists suspicious_clusters_v2(date, date, int, text[], int);
drop function if exists suspicious_cluster_detail_v2(int, numeric, numeric, date, date, text[], text);

create function suspicious_clusters_v2(
  p_from date, p_to date, p_min_accounts int default 10, p_shifts text[] default array['PM','AM'], p_decimals int default 3)
returns table(
  rep_id int, rep_name text, rep_code text, rep_status text, resign_date date, manager_id int, line_id int,
  cell_lat numeric, cell_lng numeric,
  accounts int, accounts_pm int, accounts_am int, doctors int, visits int, visit_days int,
  double_visits int, single_visits int, pct_of_rep_visits numeric,
  accounts_registered_here int, accounts_far int, visits_far int, night_visits int, other_reps_at_cell int,
  first_visit date, last_visit date, managers_joined text, severity text)
language sql stable security invoker set search_path = public as $$
  with dbl as (                                  -- manager rows: who joined which visit
    select v.visit_key, v.visit_date, array_agg(distinct m.name order by m.name) as mgrs
      from visits v
      left join managers m on m.id = v.manager_id
     where v.manager_id is not null and v.visit_date >= p_from and v.visit_date < p_to
     group by v.visit_key, v.visit_date),
  pm as (                                        -- every visit of a rep in the range and shifts
    select v.rep_id, v.visit_date, v.visit_time, v.shift_group,
           coalesce(v.account_type_id::text || '|' || v.account_ext_id, 'N|' || lower(btrim(coalesce(d.account_name, v.account_raw, '')))) as acct,
           coalesce(v.doctor_id::text, lower(btrim(v.doctor_raw))) as doc,
           (b.visit_key is not null) as is_double, b.mgrs,
           v.dev_lat::numeric as dlat, v.dev_lng::numeric as dlng,
           coalesce(v.deviation_m::numeric,
                    case when v.acc_lat is not null and v.acc_lng is not null and v.dev_lat is not null and v.dev_lng is not null then
                      2 * 6371000 * asin(least(1, sqrt(
                        power(sin(radians(v.acc_lat - v.dev_lat) / 2), 2)
                        + cos(radians(v.dev_lat)) * cos(radians(v.acc_lat)) * power(sin(radians(v.acc_lng - v.dev_lng) / 2), 2)))) end) as dev_m
      from visits v
      left join doctors d on d.id = v.doctor_id
      left join dbl b on b.visit_key = v.visit_key and b.visit_date = v.visit_date
     where v.visit_date >= p_from and v.visit_date < p_to
       and v.rep_id is not null
       and v.shift_group = any(p_shifts)
       and v.shift_group in ('AM', 'PM')),
  totals as (select rep_id, count(*) as n from pm group by rep_id),
  pos as (
    select pm.*, round(dlat, p_decimals) as clat, round(dlng, p_decimals) as clng
      from pm
     where dlat between 21.5 and 31.8 and dlng between 24.5 and 37),
  per_acct as (
    select rep_id, clat, clng, acct,
           count(*) as n, avg(dev_m) as avg_dev, count(*) filter (where dev_m > 300) as n_far,
           count(*) filter (where visit_time >= time '23:00' or visit_time < time '06:00') as n_night,
           count(*) filter (where is_double) as n_dbl,
           bool_or(shift_group = 'PM') as has_pm, bool_or(shift_group = 'AM') as has_am,
           min(visit_date) as first_v, max(visit_date) as last_v
      from pos group by rep_id, clat, clng, acct),
  cell as (
    select rep_id, clat, clng,
           count(*)::int as accounts, sum(n)::int as visits, sum(n_dbl)::int as dbl_visits,
           count(*) filter (where has_pm)::int as acc_pm, count(*) filter (where has_am)::int as acc_am,
           count(*) filter (where coalesce(avg_dev, 0) <= 300)::int as acc_here,
           count(*) filter (where avg_dev > 300)::int as acc_far,
           sum(n_far)::int as visits_far, sum(n_night)::int as night_visits,
           min(first_v) as first_visit, max(last_v) as last_visit
      from per_acct group by rep_id, clat, clng),
  cell_x as (
    select rep_id, clat, clng, count(distinct visit_date)::int as visit_days, count(distinct doc)::int as doctors
      from pos group by rep_id, clat, clng),
  cell_mgrs as (
    select p.rep_id, p.clat, p.clng, string_agg(distinct mg, ', ' order by mg) as joined
      from pos p, unnest(p.mgrs) mg where p.is_double group by p.rep_id, p.clat, p.clng),
  cell_reps as (
    select clat, clng, count(*)::int as reps from (select rep_id, clat, clng from pos group by rep_id, clat, clng having count(*) >= 3) x group by clat, clng)
  select c.rep_id, r.name, r.code, r.status, r.resign_date, o.manager_id, o.line_id::int,
         c.clat, c.clng,
         c.accounts, c.acc_pm, c.acc_am, cx.doctors, c.visits, cx.visit_days,
         c.dbl_visits, c.visits - c.dbl_visits,
         round(100.0 * c.visits / nullif(t.n, 0), 1),
         c.acc_here, c.acc_far, c.visits_far, c.night_visits,
         greatest(coalesce(cr.reps, 1) - 1, 0),
         c.first_visit, c.last_visit, coalesce(cm.joined, ''),
         case
           when c.accounts >= 25 and greatest(coalesce(cr.reps, 1) - 1, 0) = 0 then 'High'
           when c.accounts >= 15 and greatest(coalesce(cr.reps, 1) - 1, 0) <= 1 then 'Medium'
           else 'Low' end
    from cell c
    join reps r on r.id = c.rep_id
    join totals t on t.rep_id = c.rep_id
    join cell_x cx on cx.rep_id = c.rep_id and cx.clat = c.clat and cx.clng = c.clng
    left join cell_mgrs cm on cm.rep_id = c.rep_id and cm.clat = c.clat and cm.clng = c.clng
    left join cell_reps cr on cr.clat = c.clat and cr.clng = c.clng
    left join lateral (select om.line_id, om.manager_id from org_month om
                        where om.rep_id = c.rep_id and om.month <= date_trunc('month', p_from)::date
                        order by om.month desc, om.territory_id limit 1) o on true
   where c.accounts >= p_min_accounts
   order by c.accounts desc, c.visits desc, c.rep_id
$$;
grant execute on function suspicious_clusters_v2(date, date, int, text[], int) to authenticated;

create function suspicious_cluster_detail_v2(
  p_rep int, p_cell_lat numeric, p_cell_lng numeric, p_from date, p_to date,
  p_shifts text[] default array['PM','AM'], p_visit_filter text default 'all')
returns table(
  account_key text, account_ext_id text, account_name text, acc_type_code text, shift_group text, doctors int,
  visits int, double_visits int, single_visits int, first_visit date, last_visit date,
  avg_deviation_m numeric, acc_lat numeric, acc_lng numeric, pattern text, visit_log jsonb)
language sql stable security invoker set search_path = public as $$
  with prm as (select 0.5 * power(10::numeric, -scale(p_cell_lat)) as half),      -- the cell size follows the decimals of the cell passed in
  dbl as (
    select v.visit_key, v.visit_date, string_agg(distinct m.name, ', ' order by m.name) as mgr
      from visits v
      left join managers m on m.id = v.manager_id
     where v.manager_id is not null and v.visit_date >= p_from and v.visit_date < p_to
     group by v.visit_key, v.visit_date),
  pm as (
    select v.visit_date, v.visit_time, v.acc_type_code as t, v.shift_group as sg, v.account_ext_id as ext,
           coalesce(v.account_type_id::text || '|' || v.account_ext_id, 'N|' || lower(btrim(coalesce(d.account_name, v.account_raw, '')))) as acct,
           coalesce(d.account_name, v.account_raw) as acc_name,
           coalesce(v.doctor_id::text, lower(btrim(v.doctor_raw))) as doc,
           (b.visit_key is not null) as is_double, b.mgr,
           v.acc_lat::numeric as alat, v.acc_lng::numeric as alng,
           coalesce(v.deviation_m::numeric,
                    case when v.acc_lat is not null and v.acc_lng is not null then
                      2 * 6371000 * asin(least(1, sqrt(
                        power(sin(radians(v.acc_lat - v.dev_lat) / 2), 2)
                        + cos(radians(v.dev_lat)) * cos(radians(v.acc_lat)) * power(sin(radians(v.acc_lng - v.dev_lng) / 2), 2)))) end) as dev_m
      from visits v
      left join doctors d on d.id = v.doctor_id
      left join dbl b on b.visit_key = v.visit_key and b.visit_date = v.visit_date
      cross join prm
     where v.rep_id = p_rep
       and v.visit_date >= p_from and v.visit_date < p_to
       and v.shift_group = any(p_shifts)
       and v.shift_group in ('AM', 'PM')
       and v.dev_lat is not null and v.dev_lng is not null
       and v.dev_lat::numeric >= p_cell_lat - prm.half and v.dev_lat::numeric < p_cell_lat + prm.half
       and v.dev_lng::numeric >= p_cell_lng - prm.half and v.dev_lng::numeric < p_cell_lng + prm.half),
  f as (select * from pm where p_visit_filter = 'all' or (p_visit_filter = 'double' and is_double) or (p_visit_filter = 'single' and not is_double))
  select acct, max(ext), coalesce(max(acc_name), acct), max(t),
         case when count(distinct sg) > 1 then 'PM/AM' else max(sg) end,
         count(distinct doc)::int, count(*)::int, (count(*) filter (where is_double))::int, (count(*) filter (where not is_double))::int,
         min(visit_date), max(visit_date),
         round(avg(dev_m), 0), max(alat), max(alng),
         case when coalesce(avg(dev_m), 0) <= 300 then 'registered_here' else 'visit_far' end,
         jsonb_agg(jsonb_build_object('d', visit_date, 't', left(visit_time::text, 5), 'dbl', is_double, 'mgr', mgr) order by visit_date, visit_time)
    from f
   group by acct
   order by count(*) desc, 3
$$;
grant execute on function suspicious_cluster_detail_v2(int, numeric, numeric, date, date, text[], text) to authenticated;
