-- =====================================================================
-- SFE Hub | 10_visits_upload.sql  (run TENTH; needs 08_list_upload.sql)
-- Visits upload: chunk loader + month processing (matching, territory, Double key).
-- Flow from the browser:
--   start_upload('visits', file)  ->  clear_visits_range(first_day, last_day) for the dates to REPLACE
--   -> load_visits_chunk(batch, rows[<=2000]) repeated
--   -> process_visits_month(m) for each month  ->  finish_upload(..., months)
-- process_visits_month is idempotent and is also the "Re-match" button
-- (use it after loading a list that was missing when the visits were uploaded).
-- =====================================================================

create or replace function clear_visits_month(p_month date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform assert_admin();
  if not is_month_start(p_month) then raise exception 'month must be the first day of a month'; end if;
  delete from visits where visit_date >= p_month and visit_date < (p_month + interval '1 month')::date;
  get diagnostics n = row_count;
  return n;
end $$;

-- Replace only the dates covered by an uploaded file (a daily or partial-month file must not wipe the rest of the month)
create or replace function clear_visits_range(p_from date, p_to date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform assert_admin();
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad date range'; end if;
  delete from visits where visit_date between p_from and p_to;
  get diagnostics n = row_count;
  return n;
end $$;

-- Row keys: territory, code, shift, visit_type, acc_name, doctor_name, visit_date (YYYY-MM-DD),
--           members, notes, visit_root, source        (ignored: acc_type, spec, class, no_of_docs)
-- Returns {loaded, rejected_count, rejected:[{i, reason}...first 200]}
create or replace function load_visits_chunk(p_batch bigint, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_loaded int; v_rej int; v_rejected jsonb;
begin
  perform assert_admin();
  drop table if exists _lv;
  create temp table _lv on commit drop as
  select (e.ord - 1)::int as i, t.visit_date, upper(nullif(trim(t.shift),'')) as shift,
         nullif(trim(t.code),'') as code, nullif(trim(t.territory),'') as territory_raw,
         upper(nullif(trim(t.visit_type),'')) as visit_type,
         initcap(lower(nullif(trim(t.visit_root),''))) as visit_root, nullif(trim(t.source),'') as source,
         nullif(trim(t.doctor_name),'') as doctor_raw, nullif(trim(t.acc_name),'') as account_raw,
         nullif(trim(t.members),'') as members, nullif(trim(t.notes),'') as notes,
         null::int as rep_id, null::int as manager_id, null::text as reason
  from jsonb_array_elements(p_rows) with ordinality as e(obj, ord),
       lateral jsonb_to_record(e.obj)
       as t(visit_date date, shift text, code text, territory text, visit_type text, visit_root text,
            source text, doctor_name text, acc_name text, members text, notes text);

  update _lv set rep_id = r.id from reps r where r.code = _lv.code;
  update _lv set manager_id = m.id from managers m where m.code = _lv.code and _lv.rep_id is null;

  update _lv set reason = case
      when visit_date is null then 'bad or missing date'
      when shift is null or shift not in ('AM','PM') then 'bad shift ' || coalesce(shift,'(blank)')
      when code is null then 'missing CODE'
      when rep_id is null and manager_id is null then 'unknown CODE ' || code
      when doctor_raw is null then 'missing doctor name'
      end
  where true;   -- explicit WHERE (Supabase API roles reject UPDATE without one)

  insert into visits(batch_id, visit_date, shift, owner_code, rep_id, manager_id, territory_raw, visit_type,
                     visit_root, source, doctor_raw, account_raw, members, notes, match_status, visit_key)
  select p_batch, visit_date, shift, code, rep_id, manager_id, territory_raw, visit_type,
         visit_root, source, doctor_raw, account_raw, members, notes, 'unmatched', 'pending'
  from _lv where reason is null order by i;
  get diagnostics v_loaded = row_count;

  select count(*), coalesce(jsonb_agg(jsonb_build_object('i', i, 'reason', reason)) filter (where rn <= 200), '[]'::jsonb)
    into v_rej, v_rejected
  from (select i, reason, row_number() over (order by i) rn from _lv where reason is not null) x;

  return jsonb_build_object('loaded', v_loaded, 'rejected_count', v_rej, 'rejected', v_rejected);
end $$;

-- Lines a person covers on a date (rep: via box; manager: via managed boxes)
create or replace function person_lines(p_rep int, p_mgr int, p_day date) returns smallint[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(distinct b.line_id), '{}')
  from boxes b
  where (p_rep is not null and exists (select 1 from rep_box rb where rb.rep_id = p_rep and rb.box_id = b.id
                                       and p_day between rb.valid_from and coalesce(rb.valid_to,'infinity')))
     or (p_mgr is not null and exists (select 1 from manager_box mb where mb.manager_id = p_mgr and mb.box_id = b.id
                                       and p_day between mb.valid_from and coalesce(mb.valid_to,'infinity')))
$$;

-- Matching + territory + Double key for ONE month of visits. Idempotent (also the "Re-match" button).
-- 1) rep rows: normalised doctor + account name; prefer the doctor in that rep's list for the month.
--    matched (in rep's list) | not_in_list (known doctor outside the list) | unmatched (unknown / ambiguous).
-- 2) manager rows of Double visits take the doctor of the paired rep row.
-- 3) remaining manager rows: any known doctor with the same name + account.
create or replace function process_visits_month(p_month date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_end date := (p_month + interval '1 month')::date; r jsonb;
begin
  perform assert_admin();
  if not is_month_start(p_month) then raise exception 'month must be the first day of a month'; end if;

  update visits set doctor_id = null, match_status = 'unmatched'
   where visit_date >= p_month and visit_date < v_end;

  with cand as (
    select v.id, d.id as doctor_id, (ls.doctor_id is not null) as in_list
    from visits v
    join doctors d on d.name_norm = norm_name(v.doctor_raw) and d.account_norm is not distinct from norm_name(v.account_raw)
    left join list_snapshot ls on ls.month = p_month and ls.doctor_id = d.id and ls.rep_id = v.rep_id
    where v.visit_date >= p_month and v.visit_date < v_end and v.rep_id is not null
  ),
  ranked as (
    select id, doctor_id, in_list,
           count(*) over (partition by id) as n_all,
           count(*) filter (where in_list) over (partition by id) as n_in,
           row_number() over (partition by id order by in_list desc, doctor_id) as rn
    from cand
  ),
  pick as (
    select id, doctor_id, in_list from ranked
    where rn = 1 and (n_in = 1 or (n_in = 0 and n_all = 1))
  )
  update visits v
     set doctor_id = p.doctor_id,
         match_status = case when p.in_list then 'matched' else 'not_in_list' end
    from pick p where v.id = p.id;

  update visits m
     set doctor_id = x.doctor_id, match_status = 'matched'
    from (select distinct on (m2.id) m2.id, r.doctor_id
            from visits m2
            join visits r on r.rep_id is not null and r.doctor_id is not null
                         and r.visit_type = 'D' and r.visit_date = m2.visit_date and r.shift = m2.shift
                         and norm_name(r.doctor_raw) = norm_name(m2.doctor_raw)
                         and norm_name(r.account_raw) is not distinct from norm_name(m2.account_raw)
           where m2.manager_id is not null and m2.visit_type = 'D'
             and m2.visit_date >= p_month and m2.visit_date < v_end
           order by m2.id, r.id) x
   where m.id = x.id;

  update visits m
     set doctor_id = x.doctor_id, match_status = 'matched'
    from (select distinct on (v.id) v.id, d.id as doctor_id
            from visits v
            join doctors d on d.name_norm = norm_name(v.doctor_raw) and d.account_norm is not distinct from norm_name(v.account_raw)
           where v.manager_id is not null and v.doctor_id is null
             and v.visit_date >= p_month and v.visit_date < v_end
           order by v.id, d.id) x
   where m.id = x.id;

  update visits v set territory_id = (
      select t.id from territories t
       where t.line_id = any (person_lines(v.rep_id, v.manager_id, v.visit_date))
         and (t.name_norm = norm_name(v.territory_raw)
              or exists (select 1 from territory_aliases a
                          where a.territory_id = t.id and a.alias_norm = norm_name(v.territory_raw)))
       limit 1)
   where v.visit_date >= p_month and v.visit_date < v_end;

  update visits set visit_key = case
        when visit_type = 'D' then 'D|' || visit_date || '|' || shift || '|' || coalesce(norm_name(doctor_raw),'') || '|' || coalesce(norm_name(account_raw),'')
        else 'S|' || id end
   where visit_date >= p_month and visit_date < v_end;

  select jsonb_build_object(
     'rows', count(*), 'unique_visits', count(distinct visit_key),
     'matched', count(*) filter (where match_status = 'matched'),
     'not_in_list', count(*) filter (where match_status = 'not_in_list'),
     'unmatched', count(*) filter (where match_status = 'unmatched'),
     'no_territory', count(*) filter (where territory_id is null),
     'rep_rows', count(*) filter (where rep_id is not null),
     'manager_rows', count(*) filter (where manager_id is not null))
    into r from visits where visit_date >= p_month and visit_date < v_end;
  return r;
end $$;

-- ---------- summaries & data-quality views -------------------------------------
create or replace view v_visits_months with (security_invoker = true) as
select date_trunc('month', visit_date)::date as month,
       count(*) as rows, count(distinct visit_key) as unique_visits,
       count(distinct rep_id) as reps, count(distinct visit_date) as days,
       min(visit_date) as first_day, max(visit_date) as last_day,
       count(*) filter (where match_status = 'unmatched') as unmatched,
       count(*) filter (where match_status = 'not_in_list') as not_in_list,
       max(batch_id) as last_batch
from visits group by 1;

-- Double visits whose rep row / manager row pairing is broken
create or replace view v_dq_double_pairing with (security_invoker = true) as
select visit_key, min(visit_date) as visit_date, count(*) as rows,
       count(*) filter (where rep_id is not null) as rep_rows,
       count(*) filter (where manager_id is not null) as manager_rows
from visits where visit_type = 'D'
group by visit_key
having not (count(*) = 2 and count(*) filter (where rep_id is not null) = 1
                         and count(*) filter (where manager_id is not null) = 1);

create or replace view v_dq_visits_no_territory with (security_invoker = true) as
select id, visit_date, shift, owner_code, territory_raw from visits where territory_id is null;

-- ---------- grants ---------------------------------------------------------------
grant select on v_visits_months, v_dq_double_pairing, v_dq_visits_no_territory to authenticated;
revoke execute on function clear_visits_range(date,date), clear_visits_month(date), load_visits_chunk(bigint,jsonb),
  process_visits_month(date) from public, anon;
grant execute on function clear_visits_range(date,date), clear_visits_month(date), load_visits_chunk(bigint,jsonb),
  process_visits_month(date), person_lines(int,int,date) to authenticated;
