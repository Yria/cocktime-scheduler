-- 부과 자동 생성: 회비=월 첫 진입(ensure) / 대관비=세션 종료(closed) 트리거.
-- 규칙 단일 소스화: 회비·세션대관 로직을 빌딩블록으로 추출하고, 트리거·월진입·수동배치가 모두 재사용.
-- 당일취소·게스트·경기기록·운영진 제외 규칙은 기존 generate_dues_charges와 동일(그대로 이관).

-- ── 빌딩블록 1: 회비(monthly_fee) 생성 (내부 전용) ─────────────────────
create or replace function public.dues_generate_monthly(p_ym text)
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare v_fee int; v_offset int; v_n int := 0;
begin
  select monthly_fee, offset_days into v_fee, v_offset from public.dues_settings where id = 1;
  if v_fee is null then raise exception 'dues_settings not initialized'; end if;
  insert into public.dues_charges (kind, member_id, period_ym, amount_due)
  select 'monthly_fee', m.id, p_ym, v_fee
  from public.members m
  where m.is_active and not m.is_guest and not public.is_operator(m.id)
    and p_ym >= to_char(
      date_trunc('month',
        (coalesce(m.membership_started_at, (m.created_at at time zone 'Asia/Seoul')::date) + v_offset)::timestamp)
      + interval '1 month', 'YYYY-MM')
  on conflict (member_id, period_ym) where period_ym is not null
  do update set amount_due = excluded.amount_due, updated_at = now()
  where public.dues_charges.amount_paid = 0;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

-- ── 빌딩블록 2: 한 세션의 대관비(court_fee) 생성/정리 (내부 전용) ───────
-- 자격(대관장소+active/closed+경기기록) 없으면 그 세션 '미납' 대관비 정리. 있으면 참석자(당일취소·게스트 포함) 부과.
create or replace function public.dues_generate_session_court(p_session_id bigint)
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare v_court int; v_n int := 0; v_eligible boolean;
begin
  select court_fee_default into v_court from public.dues_settings where id = 1;
  select (p.court_fee_per_hour is not null
          and s.status in ('active','closed')
          and s.scheduled_at is not null
          and exists (select 1 from public.matches mt where mt.session_id = s.id))
    into v_eligible
  from public.sessions s left join public.places p on p.id = s.place_id
  where s.id = p_session_id;

  if v_eligible is not true then
    -- 무자격(무산·비대관장소 등) → 미납 대관비 항목만 정리(납부분 보존)
    delete from public.dues_charges
    where kind = 'court_fee' and session_id = p_session_id and amount_paid = 0;
    return 0;
  end if;

  insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint)
  select 'court_fee', a.member_id, p_session_id, v_court,
         case when mm.is_guest then a.invited_by else null end
  from public.attendances a
  join public.members mm on mm.id = a.member_id
  join public.sessions s on s.id = a.session_id
  where a.session_id = p_session_id
    and not public.is_operator(a.member_id)
    and (
          a.status in ('confirmed', 'late_pool')
       or ( a.status = 'cancelled'
            and a.confirmed_at is not null
            and (a.cancelled_at at time zone 'Asia/Seoul')::date
              = (s.scheduled_at at time zone 'Asia/Seoul')::date )
        )
  on conflict (member_id, session_id) where session_id is not null
  do update set amount_due = excluded.amount_due, updated_at = now()
  where public.dues_charges.amount_paid = 0;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

revoke execute on function public.dues_generate_monthly(text) from public, anon, authenticated;
revoke execute on function public.dues_generate_session_court(bigint) from public, anon, authenticated;

-- ── 수동 배치: 두 빌딩블록 재사용(회비 + 그 달 모든 세션 대관비) ──────
create or replace function public.generate_dues_charges(p_ym text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_monthly int; v_court int := 0; v_sid bigint;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_ym is null or p_ym !~ '^\d{4}-\d{2}$' then raise exception 'invalid ym (expected YYYY-MM): %', p_ym; end if;
  v_monthly := public.dues_generate_monthly(p_ym);
  for v_sid in
    select s.id from public.sessions s
    where s.scheduled_at is not null
      and to_char((s.scheduled_at at time zone 'Asia/Seoul'), 'YYYY-MM') = p_ym
  loop
    v_court := v_court + public.dues_generate_session_court(v_sid);
  end loop;
  insert into public.dues_audit_log (actor_member_id, action, detail)
  values (public.current_member_id(), 'generate_charges',
          jsonb_build_object('ym', p_ym, 'monthly', v_monthly, 'court', v_court));
  return jsonb_build_object('ym', p_ym, 'monthly_charges', v_monthly, 'court_charges', v_court);
end $function$;

-- ── 회비 월 첫 진입 자동(ensure): 이미 있으면 no-op ─────────────────────
create or replace function public.dues_ensure_monthly(p_ym text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_ym is null or p_ym !~ '^\d{4}-\d{2}$' then raise exception 'invalid ym'; end if;
  if exists (select 1 from public.dues_charges where kind = 'monthly_fee' and period_ym = p_ym) then
    return jsonb_build_object('generated', false);
  end if;
  v_n := public.dues_generate_monthly(p_ym);
  insert into public.dues_audit_log (actor_member_id, action, detail)
  values (public.current_member_id(), 'ensure_monthly', jsonb_build_object('ym', p_ym, 'monthly', v_n));
  return jsonb_build_object('generated', true, 'monthly_charges', v_n);
end $function$;
revoke execute on function public.dues_ensure_monthly(text) from public, anon;
grant execute on function public.dues_ensure_monthly(text) to authenticated;

-- ── 대관비 자동: 세션 종료(closed) 시 그 세션 대관비 생성 ────────────────
create or replace function public.trg_session_court_on_close()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform public.dues_generate_session_court(new.id);
  return new;
end $function$;

drop trigger if exists trg_session_court_on_close on public.sessions;
create trigger trg_session_court_on_close
  after update of status on public.sessions
  for each row
  when (new.status = 'closed' and old.status is distinct from 'closed')
  execute function public.trg_session_court_on_close();
