-- =====================================================================
-- SFE Hub | 94_relink_strict.sql
-- STRICT link for RAW-upload visits: a doctor is linked ONLY if ALL of these match the visit:
--   Line + Territory/Division + Box + Brick + Account name + Doctor name.
-- No name-only linking, no "outside the list" linking.
-- Several candidates left -> only if they are true duplicates (all in the list under the SAME rep): visits are spread in turn.
-- Anything else -> unlinked.
--
-- USAGE (admin, SQL Editor):
--   select relink_strict(date '2026-10-01');                         -- DRY RUN, nothing written
--   select relink_strict(date '2026-10-01', null, true);             -- APPLY: relink + unlink the bad links
--   select relink_strict(date '2026-10-01', null, true, true);       -- APPLY with Brick REQUIRED (no fallback)
-- Default: Brick is PREFERRED (used when it matches), and Territory-only is the fallback when the Brick name is not found in the list.
-- After APPLY:  select process_visits_month(date '2026-10-01');  select refresh_month(date '2026-10-01');  select refresh_joint_days(date '2026-10-01');
-- =====================================================================
create or replace function relink_strict(p_month date, p_line smallint default null, p_apply boolean default false, p_need_brick boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_total int; v_same int; v_chg int; v_new int; v_unl int; v_left int; v_upd int := 0; v_sample jsonb;
begin
  perform assert_admin();
  if p_month <> date_trunc('month', p_month)::date then raise exception 'p_month must be the first day of a month'; end if;
  drop table if exists _sv; drop table if exists _sc; drop table if exists _sp;

  create temp table _sv on commit drop as
  select row_number() over (order by v.id)::int as i, v.id as visit_id, v.batch_id, v.crm_id, v.visit_date, v.visit_time,
         date_trunc('month', v.visit_date)::date as month, v.account_type_id, v.territory_raw, v.brick_raw, v.account_raw,
         case when v.doctor_raw ~ '\(\s*\).*\(\s*\)' then regexp_replace(v.doctor_raw, '\(\s*\).*$', '') else v.doctor_raw end as doctor_raw,
         (regexp_match(v.crm_id, '/([0-9]+)/(AM|PM)$'))[1]::smallint as line_id,
         v.rep_id as rep_hint, v.doctor_ext_id as cur_doc, null::int as territory_id, null::int as box_id
    from visits v
   where v.visit_date >= p_month and v.visit_date < (p_month + interval '1 month')::date
     and v.doctor_raw is not null and v.account_type_id is not null
     and v.crm_id ~ '/[0-9]+/(AM|PM)$'
     and (p_line is null or v.crm_id ~ ('/' || p_line::text || '/(AM|PM)$'));

  update _sv x set territory_id = (select t.id from territories t
       where t.line_id = x.line_id and (t.name_norm = norm_name(x.territory_raw)
          or exists (select 1 from territory_aliases a where a.territory_id = t.id and a.alias_norm = norm_name(x.territory_raw))) limit 1) where true;
  update _sv x set rep_hint = om.rep_id from org_month om
   where x.rep_hint is null and om.month = x.month and om.territory_id = x.territory_id and om.rep_id is not null;
  update _sv x set box_id = (select om.box_id from org_month om where om.month = x.month and om.territory_id = x.territory_id limit 1) where true;
  select count(*) into v_total from _sv;

  -- candidates: names match AND the list row (same month, same line) matches territory/division + box + brick
  create temp table _sc on commit drop as
  select distinct on (x.i, d.id) x.i, d.id as doctor_pk, d.account_id, d.doctor_ext_id, ls.rep_id as snap_rep,
         (br.name is not null and ar_norm(br.name) = ar_norm(x.brick_raw)) as brick_ok
    from _sv x
    join doctors d on d.account_type_id = x.account_type_id
                  and d.name_ar = ar_norm(regexp_replace(x.doctor_raw, '^[\s-]+', ''))
                  and d.account_ar is not distinct from ar_norm(regexp_replace(x.account_raw, '^[\s-]+', ''))
    join list_snapshot ls on ls.month = x.month and ls.doctor_id = d.id and ls.line_id = x.line_id
    left join bricks br on br.id = ls.brick_id
   where ((ls.territory_id is not null and ls.territory_id = x.territory_id) or norm_name(ls.division) = norm_name(x.territory_raw))
     and (x.box_id is null or ls.box_id = x.box_id)
     and (not p_need_brick or (br.name is not null and ar_norm(br.name) = ar_norm(x.brick_raw)));
  -- prefer the candidates whose Brick matches; fall back to Territory-only candidates only when NO candidate matches the Brick
  delete from _sc c where not c.brick_ok and exists (select 1 from _sc q where q.i = c.i and q.brick_ok);

  create temp table _sp (i int primary key, account_id text, doctor_ext_id text, method text) on commit drop;
  insert into _sp select c.i, c.account_id, c.doctor_ext_id, 'strict'
    from _sc c where (select count(*) from _sc q where q.i = c.i) = 1;

  insert into _sp
  with u as (select i from _sc group by i having count(*) >= 2 and count(distinct snap_rep) = 1 and bool_and(snap_rep is not null)),
  cs as (select n.i, n.account_id, n.doctor_ext_id,
                row_number() over (partition by n.i order by n.account_id, n.doctor_ext_id) as k,
                count(*) over (partition by n.i) as cnt,
                string_agg(n.account_id || '/' || n.doctor_ext_id, ',') over (partition by n.i order by n.account_id, n.doctor_ext_id
                           rows between unbounded preceding and unbounded following) as sig
           from _sc n join u on u.i = n.i),
  vr as (select distinct cs.i, cs.sig, cs.cnt, x.rep_hint, x.visit_date, x.visit_time from cs join _sv x on x.i = cs.i),
  rk as (select i, cnt, sig, dense_rank() over (partition by sig, rep_hint order by visit_date, visit_time) as r from vr)
  select rk.i, cs.account_id, cs.doctor_ext_id, 'strict+dup_spread'
    from rk join cs on cs.i = rk.i and cs.k = ((rk.r - 1) % rk.cnt) + 1;

  select count(*) filter (where k.i is not null and x.cur_doc = k.doctor_ext_id),
         count(*) filter (where k.i is not null and x.cur_doc is not null and x.cur_doc <> k.doctor_ext_id),
         count(*) filter (where k.i is not null and x.cur_doc is null),
         count(*) filter (where k.i is null and x.cur_doc is not null),
         count(*) filter (where k.i is null and x.cur_doc is null)
    into v_same, v_chg, v_new, v_unl, v_left
    from _sv x left join _sp k on k.i = x.i;

  select coalesce(jsonb_agg(s), '[]'::jsonb) into v_sample from (
    select jsonb_build_object('visit_id', x.visit_id, 'date', x.visit_date, 'territory', x.territory_raw, 'brick', x.brick_raw,
                              'account', x.account_raw, 'was_linked', x.cur_doc is not null,
                              'result', case when k.i is null then 'UNLINK' when x.cur_doc is null then 'NEW LINK' else 'RELINK' end) as s
      from _sv x left join _sp k on k.i = x.i
     where (k.i is null and x.cur_doc is not null) or (k.i is not null and x.cur_doc is distinct from k.doctor_ext_id)
     order by x.visit_id limit 40) y;

  if p_apply then
    update visits v set account_ext_id = k.account_id, doctor_ext_id = k.doctor_ext_id, link_method = k.method
      from _sp k join _sv x on x.i = k.i
     where v.batch_id = x.batch_id and (v.crm_id = x.crm_id or v.crm_id like x.crm_id || '/s%')
       and v.doctor_ext_id is distinct from k.doctor_ext_id;
    get diagnostics v_upd = row_count;
    update visits v set account_ext_id = null, doctor_ext_id = null, link_method = null
      from _sv x
     where not exists (select 1 from _sp k where k.i = x.i) and x.cur_doc is not null
       and v.batch_id = x.batch_id and (v.crm_id = x.crm_id or v.crm_id like x.crm_id || '/s%') and v.doctor_ext_id is not null;
  end if;

  return jsonb_build_object('mode', case when p_apply then 'APPLIED' else 'DRY RUN (nothing written)' end,
    'month', p_month, 'brick_required', p_need_brick, 'visits_checked', v_total,
    'already_correct', v_same, 'would_relink_to_other_doctor', v_chg, 'would_newly_link', v_new,
    'would_unlink_bad_links', v_unl, 'unlinked_stay_unlinked', v_left, 'sample_of_changes', v_sample,
    'next', case when p_apply then 'run process_visits_month, refresh_month, refresh_joint_days' else 'review, then run again with p_apply = true' end);
end $$;

revoke execute on function relink_strict(date, smallint, boolean, boolean) from public, anon;
grant execute on function relink_strict(date, smallint, boolean, boolean) to authenticated;
