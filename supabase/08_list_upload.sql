-- =====================================================================
-- SFE Hub | 08_list_upload.sql  (run EIGHTH)
-- Fast, atomic loading of the monthly Target List (and generic upload tracking).
-- The browser sends the Excel rows in chunks (e.g. 2000 rows) as JSON; ALL logic runs here.
-- =====================================================================

-- ---------- upload batches ----------------------------------------------
create or replace function start_upload(p_kind text, p_file text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  perform assert_admin();
  insert into upload_batches(kind, file_name, created_by) values (p_kind, p_file, auth.uid()) returning id into v;
  return v;
end $$;

create or replace function finish_upload(p_batch bigint, p_total int, p_loaded int, p_rejected int, p_months date[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare m date; refreshed int := 0;
begin
  perform assert_admin();
  update upload_batches set rows_total = p_total, rows_loaded = p_loaded, rows_rejected = p_rejected,
         months = coalesce(p_months, '{}') where id = p_batch;
  foreach m in array coalesce(p_months, '{}') loop
    perform refresh_month(m); refreshed := refreshed + 1;
  end loop;
  return jsonb_build_object('months_refreshed', refreshed);
end $$;

-- ---------- list: clear a month before replacing it -------------------------
create or replace function clear_list_month(p_month date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform assert_admin();
  if not is_month_start(p_month) then raise exception 'month must be the first day of a month'; end if;
  delete from list_snapshot where month = p_month;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- list: load one chunk ---------------------------------------------
-- Row keys: month (YYYY-MM-DD, first of month), line, emp_code, account_id, doctor_id,
--           account_name, doctor_name, account_type, speciality, class, brick, division,
--           freq, active_from
-- Returns {loaded, rejected_count, rejected:[{i, reason}...first 200]}   (i = index in the chunk, 0-based)
create or replace function load_list_chunk(p_batch bigint, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_loaded int; v_rej int; v_rejected jsonb;
begin
  perform assert_admin();
  drop table if exists _lc;
  create temp table _lc on commit drop as
  select (e.ord - 1)::int as i, t.month, nullif(trim(t.line),'') as line, nullif(trim(t.emp_code),'') as emp_code,
         nullif(trim(t.account_id),'') as account_id, nullif(trim(t.doctor_id),'') as doctor_ext_id,
         nullif(trim(t.account_name),'') as account_name, nullif(trim(t.doctor_name),'') as doctor_name,
         nullif(trim(t.account_type),'') as account_type, nullif(trim(t.speciality),'') as speciality,
         nullif(trim(t.class),'') as class, nullif(trim(t.brick),'') as brick, nullif(trim(t.division),'') as division,
         coalesce(t.freq, 0)::smallint as freq, t.active_from,
         null::int as rep_id, null::smallint as line_id, null::text as reason
  from jsonb_array_elements(p_rows) with ordinality as e(obj, ord),
       lateral jsonb_to_record(e.obj)
       as t(month date, line text, emp_code text, account_id text, doctor_id text, account_name text,
            doctor_name text, account_type text, speciality text, class text, brick text, division text,
            freq numeric, active_from date);

  update _lc set rep_id = r.id from reps r where r.code = _lc.emp_code;
  update _lc set line_id = l.id from lines l where l.name = _lc.line;

  update _lc set reason = case
      when month is null or not is_month_start(month) then 'bad or missing month'
      when account_id is null or doctor_ext_id is null then 'missing Account ID / Doctor Id'
      when doctor_name is null then 'missing doctor name'
      when emp_code is null or rep_id is null then 'unknown rep code ' || coalesce(emp_code, '(blank)')
      when line_id is null then 'unknown line ' || coalesce(line, '(blank)')
      end;

  insert into specialities(name)  select distinct speciality  from _lc where reason is null and speciality is not null on conflict (name) do nothing;
  insert into account_types(name) select distinct account_type from _lc where reason is null and account_type is not null on conflict (name) do nothing;
  insert into bricks(name)        select distinct brick        from _lc where reason is null and brick is not null on conflict (name) do nothing;

  insert into doctors(account_id, doctor_ext_id, doctor_name, account_name, speciality_id, account_type_id)
  select distinct on (c.account_id, c.doctor_ext_id) c.account_id, c.doctor_ext_id, c.doctor_name, c.account_name,
         s.id, a.id
  from _lc c left join specialities s on s.name = c.speciality left join account_types a on a.name = c.account_type
  where c.reason is null
  order by c.account_id, c.doctor_ext_id, c.i desc
  on conflict (account_id, doctor_ext_id) do update
     set doctor_name = excluded.doctor_name, account_name = excluded.account_name,
         speciality_id = excluded.speciality_id, account_type_id = excluded.account_type_id;

  insert into list_snapshot(month, doctor_id, rep_id, line_id, brick_id, class, division, freq, active_from, batch_id)
  select distinct on (c.month, d.id) c.month, d.id, c.rep_id, c.line_id, b.id, c.class, c.division, c.freq, c.active_from, p_batch
  from _lc c
  join doctors d on d.account_id = c.account_id and d.doctor_ext_id = c.doctor_ext_id
  left join bricks b on b.name = c.brick
  where c.reason is null
  order by c.month, d.id, c.i desc
  on conflict (month, doctor_id) do update
     set rep_id = excluded.rep_id, line_id = excluded.line_id, brick_id = excluded.brick_id, class = excluded.class,
         division = excluded.division, freq = excluded.freq, active_from = excluded.active_from, batch_id = excluded.batch_id;
  get diagnostics v_loaded = row_count;

  select count(*), coalesce(jsonb_agg(jsonb_build_object('i', i, 'reason', reason)) filter (where rn <= 200), '[]'::jsonb)
    into v_rej, v_rejected
  from (select i, reason, row_number() over (order by i) rn from _lc where reason is not null) x;

  return jsonb_build_object('loaded', v_loaded, 'rejected_count', v_rej, 'rejected', v_rejected);
end $$;

-- ---------- undo any batch ---------------------------------------------------
create or replace function undo_batch(p_batch bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_kind text; v_months date[]; m date; n int := 0;
begin
  perform assert_admin();
  select kind, months into v_kind, v_months from upload_batches where id = p_batch and status = 'loaded';
  if v_kind is null then raise exception 'Batch not found or already undone.'; end if;
  case v_kind
    when 'list'        then delete from list_snapshot where batch_id = p_batch;
    when 'visits'      then delete from visits        where batch_id = p_batch;
    when 'sales'       then delete from sales         where batch_id = p_batch;
    when 'leaves'      then delete from leaves        where batch_id = p_batch;
    when 'office_work' then delete from office_work   where batch_id = p_batch;
    when 'activities'  then delete from activities    where batch_id = p_batch;
    else raise exception 'Unsupported batch kind %', v_kind;
  end case;
  update upload_batches set status = 'deleted' where id = p_batch;
  foreach m in array coalesce(v_months, '{}') loop perform refresh_month(m); n := n + 1; end loop;
  return jsonb_build_object('months_refreshed', n);
end $$;

-- ---------- summaries for the Uploads page -------------------------------------
create or replace view v_list_months with (security_invoker = true) as
select month, count(*) as rows, count(distinct rep_id) as reps, count(distinct doctor_id) as doctors,
       sum(freq) as total_freq, max(batch_id) as last_batch
from list_snapshot group by month;

-- ---------- grants -----------------------------------------------------------------
revoke execute on function start_upload(text,text), finish_upload(bigint,int,int,int,date[]),
  clear_list_month(date), load_list_chunk(bigint,jsonb), undo_batch(bigint) from public, anon;
grant execute on function start_upload(text,text), finish_upload(bigint,int,int,int,date[]),
  clear_list_month(date), load_list_chunk(bigint,jsonb), undo_batch(bigint) to authenticated;
