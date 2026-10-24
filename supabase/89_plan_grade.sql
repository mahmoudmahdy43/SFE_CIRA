-- =====================================================================
-- SFE Hub | 89_plan_grade.sql   (run AFTER 85)
-- Confidence grade of every planned visit: A (good data), B (data exists but does not fully match), C (needs timing confirmation from the rep).
-- It is saved with the plan so the real execution rate per grade can be measured later.
--   monthly_plan_days.grade        -> 'A' | 'B' | 'C' (null for plans saved before this file)
--   save_plan()                    -> reads {grade} from every row of p_rows
-- =====================================================================

alter table monthly_plan_days add column if not exists grade text;
alter table monthly_plan_days drop constraint if exists monthly_plan_days_grade_check;
alter table monthly_plan_days add constraint monthly_plan_days_grade_check check (grade is null or grade in ('A','B','C'));

create or replace function save_plan(p_rep int, p_month date, p_params jsonb, p_summary jsonb, p_rows jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', p_month)::date; v_id bigint; v_status text;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select id, status into v_id, v_status from monthly_plans where rep_id = p_rep and month = v_month;
  if v_status = 'approved' then return null; end if;
  if v_id is null then
    insert into monthly_plans(rep_id, month, params, summary) values (p_rep, v_month, coalesce(p_params,'{}'), coalesce(p_summary,'{}'))
    returning id into v_id;
  else
    update monthly_plans set params = coalesce(p_params,'{}'), summary = coalesce(p_summary,'{}'),
           generated_by = auth.uid(), generated_at = now() where id = v_id;
    delete from monthly_plan_days where plan_id = v_id;
  end if;
  insert into monthly_plan_days(plan_id, day, seq, doctor_id, planned_time, fixed, visit_no, note, grade)
  select v_id, (r->>'day')::date, (r->>'seq')::smallint, (r->>'doctor_id')::int,
         nullif(r->>'planned_time','')::time, coalesce((r->>'fixed')::boolean, false),
         coalesce((r->>'visit_no')::smallint, 1), nullif(r->>'note',''),
         case when r->>'grade' in ('A','B','C') then r->>'grade' else null end
    from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r;
  return v_id;
end $$;
grant execute on function save_plan(int, date, jsonb, jsonb, jsonb) to authenticated;
