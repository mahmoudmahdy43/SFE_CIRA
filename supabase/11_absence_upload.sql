-- =====================================================================
-- SFE Hub | 11_absence_upload.sql  (run ELEVENTH; needs 08 + 10)
-- Leaves / Office Work / Activities upload. Chunk loaders (reject bad rows with a reason),
-- replace-by-date-range helpers, month summary views.
-- Flow: start_upload(kind) -> clear_*_range(from,to) for REPLACE -> load_*_chunk (<=2000 rows)
--       -> finish_upload(..., months)   (refresh_month rebuilds rep_day_shift + KPIs)
-- NOTE: a leave can span two months -> the browser must pass EVERY month touched by start..end.
-- =====================================================================

create or replace function clear_leaves_range(p_from date, p_to date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform assert_admin();
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad date range'; end if;
  delete from leaves where start_date between p_from and p_to;      -- replaced by START date
  get diagnostics n = row_count; return n;
end $$;

create or replace function clear_office_work_range(p_from date, p_to date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform assert_admin();
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad date range'; end if;
  delete from office_work where day between p_from and p_to;
  get diagnostics n = row_count; return n;
end $$;

create or replace function clear_activities_range(p_from date, p_to date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform assert_admin();
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad date range'; end if;
  delete from activities where day between p_from and p_to;
  get diagnostics n = row_count; return n;
end $$;

-- helper: 'Full'/'full day'/'AM'/'PM' -> FULL/AM/PM (null if unknown)
create or replace function norm_shift(p text) returns text
language sql immutable as $$
  select case upper(trim(coalesce(p,'')))
           when 'AM' then 'AM' when 'PM' then 'PM'
           when 'FULL' then 'FULL' when 'FULL DAY' then 'FULL' when 'ALL DAY' then 'FULL' end
$$;

-- ---------- Leaves --------------------------------------------------------------
-- Row keys: code, leave_type, shift, start_date, end_date (YYYY-MM-DD), status, notes
create or replace function load_leaves_chunk(p_batch bigint, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_loaded int; v_rej int; v_rejected jsonb;
begin
  perform assert_admin();
  drop table if exists _ll;
  create temp table _ll on commit drop as
  select (e.ord - 1)::int as i, nullif(trim(t.code),'') as code, nullif(trim(t.leave_type),'') as leave_type,
         norm_shift(t.shift) as shift, t.start_date, t.end_date, nullif(trim(t.status),'') as status,
         nullif(trim(t.notes),'') as notes,
         null::int as rep_id, null::int as manager_id, null::text as reason
  from jsonb_array_elements(p_rows) with ordinality as e(obj, ord),
       lateral jsonb_to_record(e.obj)
       as t(code text, leave_type text, shift text, start_date date, end_date date, status text, notes text);

  update _ll set rep_id = r.id from reps r where r.code = _ll.code;
  update _ll set manager_id = m.id from managers m where m.code = _ll.code and _ll.rep_id is null;

  update _ll set reason = case
      when code is null then 'missing CODE'
      when rep_id is null and manager_id is null then 'unknown CODE ' || code
      when shift is null then 'bad shift'
      when start_date is null or end_date is null then 'bad or missing date'
      when end_date < start_date then 'end date before start date'
      end
  where true;

  insert into leaves(batch_id, code, rep_id, manager_id, leave_type, shift, start_date, end_date, status, notes)
  select p_batch, code, rep_id, manager_id, leave_type, shift, start_date, end_date, status, notes
  from _ll where reason is null order by i;
  get diagnostics v_loaded = row_count;

  select count(*), coalesce(jsonb_agg(jsonb_build_object('i', i, 'reason', reason)) filter (where rn <= 200), '[]'::jsonb)
    into v_rej, v_rejected
  from (select i, reason, row_number() over (order by i) rn from _ll where reason is not null) x;
  return jsonb_build_object('loaded', v_loaded, 'rejected_count', v_rej, 'rejected', v_rejected);
end $$;

-- ---------- Office Work -----------------------------------------------------------
-- Row keys: code, ow_type, shift, day (YYYY-MM-DD), members, comments
create or replace function load_office_work_chunk(p_batch bigint, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_loaded int; v_rej int; v_rejected jsonb;
begin
  perform assert_admin();
  drop table if exists _lo;
  create temp table _lo on commit drop as
  select (e.ord - 1)::int as i, nullif(trim(t.code),'') as code, nullif(trim(t.ow_type),'') as ow_type,
         norm_shift(t.shift) as shift, t.day, nullif(trim(t.members),'') as members, nullif(trim(t.comments),'') as comments,
         null::int as rep_id, null::int as manager_id, null::text as reason
  from jsonb_array_elements(p_rows) with ordinality as e(obj, ord),
       lateral jsonb_to_record(e.obj)
       as t(code text, ow_type text, shift text, day date, members text, comments text);

  update _lo set rep_id = r.id from reps r where r.code = _lo.code;
  update _lo set manager_id = m.id from managers m where m.code = _lo.code and _lo.rep_id is null;

  update _lo set reason = case
      when code is null then 'missing CODE'
      when rep_id is null and manager_id is null then 'unknown CODE ' || code
      when shift is null then 'bad shift'
      when day is null then 'bad or missing date'
      end
  where true;

  insert into office_work(batch_id, code, rep_id, manager_id, ow_type, shift, day, members, comments)
  select p_batch, code, rep_id, manager_id, ow_type, shift, day, members, comments
  from _lo where reason is null order by i;
  get diagnostics v_loaded = row_count;

  select count(*), coalesce(jsonb_agg(jsonb_build_object('i', i, 'reason', reason)) filter (where rn <= 200), '[]'::jsonb)
    into v_rej, v_rejected
  from (select i, reason, row_number() over (order by i) rn from _lo where reason is not null) x;
  return jsonb_build_object('loaded', v_loaded, 'rejected_count', v_rej, 'rejected', v_rejected);
end $$;

-- ---------- Activities --------------------------------------------------------------
-- Row keys: code, act_type, shift, day (YYYY-MM-DD), at_time (HH:MM:SS or null), members, comments
create or replace function load_activities_chunk(p_batch bigint, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_loaded int; v_rej int; v_rejected jsonb;
begin
  perform assert_admin();
  drop table if exists _la;
  create temp table _la on commit drop as
  select (e.ord - 1)::int as i, nullif(trim(t.code),'') as code, nullif(trim(t.act_type),'') as act_type,
         norm_shift(t.shift) as shift, t.day, t.at_time, nullif(trim(t.members),'') as members,
         nullif(trim(t.comments),'') as comments,
         null::int as rep_id, null::int as manager_id, null::text as reason
  from jsonb_array_elements(p_rows) with ordinality as e(obj, ord),
       lateral jsonb_to_record(e.obj)
       as t(code text, act_type text, shift text, day date, at_time time, members text, comments text);

  update _la set rep_id = r.id from reps r where r.code = _la.code;
  update _la set manager_id = m.id from managers m where m.code = _la.code and _la.rep_id is null;

  update _la set reason = case
      when code is null then 'missing CODE'
      when rep_id is null and manager_id is null then 'unknown CODE ' || code
      when shift is null then 'bad shift'
      when day is null then 'bad or missing date'
      end
  where true;

  insert into activities(batch_id, code, rep_id, manager_id, act_type, shift, day, at_time, members, comments)
  select p_batch, code, rep_id, manager_id, act_type, shift, day, at_time, members, comments
  from _la where reason is null order by i;
  get diagnostics v_loaded = row_count;

  select count(*), coalesce(jsonb_agg(jsonb_build_object('i', i, 'reason', reason)) filter (where rn <= 200), '[]'::jsonb)
    into v_rej, v_rejected
  from (select i, reason, row_number() over (order by i) rn from _la where reason is not null) x;
  return jsonb_build_object('loaded', v_loaded, 'rejected_count', v_rej, 'rejected', v_rejected);
end $$;

-- ---------- summaries ---------------------------------------------------------------
create or replace view v_leaves_months with (security_invoker = true) as
select date_trunc('month', start_date)::date as month, count(*) as rows,
       count(*) filter (where lower(trim(status)) = 'approved') as approved,
       count(*) filter (where lower(trim(coalesce(status,''))) <> 'approved') as not_approved,
       count(distinct rep_id) as reps, min(start_date) as first_day, max(end_date) as last_day, max(batch_id) as last_batch
from leaves group by 1;

create or replace view v_office_work_months with (security_invoker = true) as
select date_trunc('month', day)::date as month, count(*) as rows, count(distinct rep_id) as reps,
       count(distinct day) as days, min(day) as first_day, max(day) as last_day, max(batch_id) as last_batch
from office_work group by 1;

create or replace view v_activities_months with (security_invoker = true) as
select date_trunc('month', day)::date as month, count(*) as rows, count(distinct rep_id) as reps,
       count(distinct day) as days, min(day) as first_day, max(day) as last_day, max(batch_id) as last_batch
from activities group by 1;

-- ---------- data quality: absence on non-working slots (nothing to remove, informational) ----
-- leave/OW/activity rows that fall on a rep with no box on that day
create or replace view v_dq_absence_without_box with (security_invoker = true) as
select 'leave'::text as kind, l.id, l.rep_id, l.start_date as day, l.shift, l.leave_type as type
from leaves l
where l.rep_id is not null and not exists (select 1 from rep_box rb where rb.rep_id = l.rep_id
      and l.start_date <= coalesce(rb.valid_to,'infinity') and l.end_date >= rb.valid_from)
union all
select 'office_work', o.id, o.rep_id, o.day, o.shift, o.ow_type from office_work o
where o.rep_id is not null and not exists (select 1 from rep_box rb where rb.rep_id = o.rep_id
      and o.day between rb.valid_from and coalesce(rb.valid_to,'infinity'))
union all
select 'activity', a.id, a.rep_id, a.day, a.shift, a.act_type from activities a
where a.rep_id is not null and not exists (select 1 from rep_box rb where rb.rep_id = a.rep_id
      and a.day between rb.valid_from and coalesce(rb.valid_to,'infinity'));

-- ---------- grants ----------------------------------------------------------------------
grant select on v_leaves_months, v_office_work_months, v_activities_months, v_dq_absence_without_box to authenticated;
revoke execute on function clear_leaves_range(date,date), clear_office_work_range(date,date), clear_activities_range(date,date),
  load_leaves_chunk(bigint,jsonb), load_office_work_chunk(bigint,jsonb), load_activities_chunk(bigint,jsonb) from public, anon;
grant execute on function clear_leaves_range(date,date), clear_office_work_range(date,date), clear_activities_range(date,date),
  load_leaves_chunk(bigint,jsonb), load_office_work_chunk(bigint,jsonb), load_activities_chunk(bigint,jsonb) to authenticated;
