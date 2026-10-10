-- =====================================================================
-- SFE Hub | 07_territory_move.sql  (run SEVENTH)
-- Move a territory to another box (same line) from a date, atomically.
-- =====================================================================
create or replace function move_territory(p_territory int, p_new_box int, p_first_day date) returns void
language plpgsql security definer set search_path = public as $$
declare v_line smallint; v_box_line smallint;
begin
  perform assert_admin();
  select line_id into v_line from territories where id = p_territory;
  select line_id into v_box_line from boxes where id = p_new_box;
  if v_line is null or v_box_line is null then raise exception 'Unknown territory or box.'; end if;
  if v_line <> v_box_line then raise exception 'The box belongs to a different line than the territory.'; end if;
  update box_territory set valid_to = p_first_day - 1
   where territory_id = p_territory and valid_from < p_first_day and coalesce(valid_to,'infinity') >= p_first_day;
  delete from box_territory where territory_id = p_territory and valid_from >= p_first_day;
  insert into box_territory(box_id, territory_id, valid_from) values (p_new_box, p_territory, p_first_day);
  perform rebuild_org_from(p_first_day);
end $$;
revoke execute on function move_territory(int,int,date) from public, anon;
grant  execute on function move_territory(int,int,date) to authenticated;
