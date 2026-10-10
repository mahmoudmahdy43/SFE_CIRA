-- =====================================================================
-- SFE Hub | 06_personnel.sql  (run SIXTH)
-- Admin actions for hiring / resigning / transferring people.
-- Every action is ONE transaction: it changes the effective-dated tables,
-- writes personnel_events, and rebuilds org_month + KPIs from that date on.
-- Dates: a resignation date is the LAST day the person covers the box.
--        a hire / transfer / assign date is the FIRST day on the new box.
-- =====================================================================

-- Rebuild everything that depends on the org, from p_date's month to the current month.
create or replace function rebuild_org_from(p_date date) returns int
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_date)::date; n int := 0;
begin
  perform assert_admin();
  while m <= date_trunc('month', current_date)::date loop
    perform refresh_month(m);
    n := n + 1; m := (m + interval '1 month')::date;
  end loop;
  return n;
end $$;

-- ---------- reps -------------------------------------------------------
create or replace function hire_rep(p_code text, p_name text, p_box int, p_date date)
returns int
language plpgsql security definer set search_path = public as $$
declare v_rep int;
begin
  perform assert_admin();
  select id into v_rep from reps where code = p_code;
  if v_rep is null then
    insert into reps(code, name, status, hire_date) values (trim(p_code), trim(p_name), 'Active', p_date)
    returning id into v_rep;
  else
    update reps set status = 'Active', resign_date = null, name = coalesce(nullif(trim(p_name),''), name) where id = v_rep;
  end if;
  begin
    insert into rep_box(rep_id, box_id, valid_from) values (v_rep, p_box, p_date);
  exception when exclusion_violation then
    raise exception 'Cannot assign: the box already has a rep on %, or this rep already covers another box. Resign / transfer first.', p_date;
  end;
  insert into personnel_events(event_type, rep_id, box_id, event_date, created_by)
  values ('hire', v_rep, p_box, p_date, auth.uid());
  perform rebuild_org_from(p_date);
  return v_rep;
end $$;

create or replace function resign_rep(p_rep int, p_last_day date) returns void
language plpgsql security definer set search_path = public as $$
declare v_box int;
begin
  perform assert_admin();
  select box_id into v_box from rep_box
   where rep_id = p_rep and coalesce(valid_to,'infinity') >= p_last_day and valid_from <= p_last_day limit 1;
  update rep_box set valid_to = p_last_day
   where rep_id = p_rep and valid_from <= p_last_day and coalesce(valid_to,'infinity') > p_last_day;
  update reps set status = 'Resigned', resign_date = p_last_day where id = p_rep;
  insert into personnel_events(event_type, rep_id, box_id, event_date, created_by)
  values ('resign', p_rep, v_box, p_last_day, auth.uid());
  perform rebuild_org_from(p_last_day);
end $$;

create or replace function transfer_rep(p_rep int, p_new_box int, p_first_day date) returns void
language plpgsql security definer set search_path = public as $$
declare v_old int;
begin
  perform assert_admin();
  select box_id into v_old from rep_box
   where rep_id = p_rep and valid_from < p_first_day and coalesce(valid_to,'infinity') >= p_first_day limit 1;
  if v_old is null then raise exception 'This rep has no box on %, cannot transfer.', p_first_day; end if;
  update rep_box set valid_to = p_first_day - 1
   where rep_id = p_rep and valid_from < p_first_day and coalesce(valid_to,'infinity') >= p_first_day;
  begin
    insert into rep_box(rep_id, box_id, valid_from) values (p_rep, p_new_box, p_first_day);
  exception when exclusion_violation then
    raise exception 'The target box already has a rep on %.', p_first_day;
  end;
  insert into personnel_events(event_type, rep_id, box_id, event_date, notes, created_by)
  values ('transfer', p_rep, p_new_box, p_first_day, 'from box ' || v_old, auth.uid());
  perform rebuild_org_from(p_first_day);
end $$;

-- ---------- managers (DM) ---------------------------------------------
create or replace function create_manager(p_code text, p_name text, p_hire date default null) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  perform assert_admin();
  insert into managers(code, name, status, hire_date) values (nullif(trim(p_code),''), trim(p_name), 'Active', p_hire)
  returning id into v;
  return v;
end $$;

-- Assign (or replace) the manager of a box from p_first_day
create or replace function assign_manager(p_manager int, p_box int, p_first_day date) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  update manager_box set valid_to = p_first_day - 1
   where box_id = p_box and valid_from < p_first_day and coalesce(valid_to,'infinity') >= p_first_day;
  delete from manager_box where box_id = p_box and valid_from >= p_first_day and manager_id = p_manager;
  begin
    insert into manager_box(manager_id, box_id, valid_from) values (p_manager, p_box, p_first_day);
  exception when exclusion_violation then
    raise exception 'Overlapping manager assignment for this box on %.', p_first_day;
  end;
  insert into personnel_events(event_type, manager_id, box_id, event_date, created_by)
  values ('manager_assign', p_manager, p_box, p_first_day, auth.uid());
  perform rebuild_org_from(p_first_day);
end $$;

-- Box becomes "Vacant manager" after p_last_day (sales roll up to the NSM)
create or replace function unassign_manager(p_box int, p_last_day date) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  update manager_box set valid_to = p_last_day
   where box_id = p_box and valid_from <= p_last_day and coalesce(valid_to,'infinity') > p_last_day;
  insert into personnel_events(event_type, box_id, event_date, created_by)
  values ('manager_resign', p_box, p_last_day, auth.uid());
  perform rebuild_org_from(p_last_day);
end $$;

create or replace function resign_manager(p_manager int, p_last_day date) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  update manager_box set valid_to = p_last_day
   where manager_id = p_manager and valid_from <= p_last_day and coalesce(valid_to,'infinity') > p_last_day;
  update managers set status = 'Resigned', resign_date = p_last_day where id = p_manager;
  insert into personnel_events(event_type, manager_id, event_date, created_by)
  values ('manager_resign', p_manager, p_last_day, auth.uid());
  perform rebuild_org_from(p_last_day);
end $$;

-- ---------- NSM per line -----------------------------------------------
-- p_nsm NULL = vacant NSM. Pass p_new_name to create the person on the fly.
create or replace function set_nsm(p_line int, p_nsm int, p_first_day date, p_new_name text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v int := p_nsm;
begin
  perform assert_admin();
  if p_new_name is not null and trim(p_new_name) <> '' then
    insert into nsms(name) values (trim(p_new_name)) on conflict (name) do update set name = excluded.name returning id into v;
  end if;
  update line_nsm set valid_to = p_first_day - 1
   where line_id = p_line and valid_from < p_first_day and coalesce(valid_to,'infinity') >= p_first_day;
  delete from line_nsm where line_id = p_line and valid_from >= p_first_day;
  insert into line_nsm(line_id, nsm_id, valid_from) values (p_line, v, p_first_day);
  insert into personnel_events(event_type, event_date, notes, created_by)
  values ('nsm_change', p_first_day, 'line ' || p_line, auth.uid());
  perform rebuild_org_from(p_first_day);
end $$;

-- ---------- grants -------------------------------------------------------
revoke execute on function rebuild_org_from(date), hire_rep(text,text,int,date), resign_rep(int,date),
  transfer_rep(int,int,date), create_manager(text,text,date), assign_manager(int,int,date),
  unassign_manager(int,date), resign_manager(int,date), set_nsm(int,int,date,text) from public, anon;
grant execute on function rebuild_org_from(date), hire_rep(text,text,int,date), resign_rep(int,date),
  transfer_rep(int,int,date), create_manager(text,text,date), assign_manager(int,int,date),
  unassign_manager(int,date), resign_manager(int,date), set_nsm(int,int,date,text) to authenticated;
