-- 명예회원(회비 면제): members.is_honorary(공개 플래그) + member_honorary(관리자 전용 사유 메모) +
-- dues_generate_monthly 회비 룰에 명예회원 제외 + 지정/해제 RPC(미납 회비 self-heal).
-- 기획: docs/ACCOUNTING_SPEC.md §1.1·§1.4·§4·§10·§12.

-- ── 1. members 플래그(공개 boolean) ──────────────────────────────────
-- is_honorary 는 상태 플래그라 명단 모델(로그인 회원 조회)상 노출 무방(사유는 §2에서 분리 비공개).
alter table public.members
	add column if not exists is_honorary boolean not null default false;
comment on column public.members.is_honorary is
	'명예회원(회비 면제) 플래그. true면 dues_generate_monthly 회비 부과에서 제외. 지정/해제=dues_set_honorary. 사유는 member_honorary(관리자 전용).';

-- ── 2. 명예회원 사유(관리자 전용) — members RLS(로그인 전원 조회)와 분리 ──
-- honorary_reason 을 members 컬럼에 두면 members_select(using true)로 전 회원에게 노출되므로,
-- 사유(운영진 메모)만 별도 테이블로 떼어 is_admin RLS 로 잠근다. 쓰기는 dues_set_honorary(SECURITY DEFINER)만.
create table if not exists public.member_honorary (
	member_id uuid primary key references public.members(id) on delete cascade,
	reason text,
	updated_at timestamptz not null default now()
);
comment on table public.member_honorary is
	'명예회원 지정 사유(관리자 메모). members와 분리해 is_admin만 조회(사유 비공개). 플래그는 members.is_honorary.';
alter table public.member_honorary enable row level security;
drop policy if exists member_honorary_admin_select on public.member_honorary;
create policy member_honorary_admin_select on public.member_honorary
	for select to authenticated using (public.is_admin());
-- 직접 write 정책 없음(모든 쓰기는 dues_set_honorary RPC 경유). anon 은 전면 차단.
revoke all on public.member_honorary from anon;
grant select on public.member_honorary to authenticated;

-- ── 3. 회비 룰에 명예회원 제외 추가 ──────────────────────────────────
-- 20260715080000 원본을 그대로 재선언하고 WHERE 절에 'and not m.is_honorary' 한 줄만 추가.
-- (회비 로직 단일 소스 — ensure/generate/monthly 세 경로가 재사용하므로 여기 한 곳만 고침.)
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
  where m.is_active and not m.is_guest and not m.is_honorary and not public.is_operator(m.id)
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

revoke execute on function public.dues_generate_monthly(text) from public, anon, authenticated;

-- ── 4. 명예회원 지정/해제 RPC ────────────────────────────────────────
-- 플래그·사유 설정 + (지정 시) 이미 생성된 미납 회비 self-heal 삭제를 한 트랜잭션으로.
-- 회비엔 court 같은 자동 self-heal DELETE가 없으므로 여기서 명시적으로 정리한다.
--  · 미납(status=unpaid)만 삭제 — 납부/부분납분과 수동 waived/void는 보존(현금주의 원장 무영향).
--    삭제는 period_ym 무관 전월 미납이 대상(명예회원은 어느 달도 회비 의무 없음).
--  · 해제(honorary=false)는 삭제분을 되살리지 않는다. 이후 '아직 부과가 없는 새 달'은 월진입 ensure가
--    자동 부과하지만, 이미 부과가 있는 현월·과거월은 no-op이므로 그 달만 수동배치 generate_dues_charges 필요.
create or replace function public.dues_set_honorary(
  p_member_id uuid,
  p_honorary boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_reason text; v_deleted int := 0; v_honorary boolean := coalesce(p_honorary, false);
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_member_id is null then raise exception 'member_id required'; end if;

  v_reason := case when v_honorary then nullif(btrim(coalesce(p_reason, '')), '') else null end;

  update public.members
  set is_honorary = v_honorary, updated_at = now()
  where id = p_member_id;
  if not found then raise exception 'member not found: %', p_member_id; end if;

  if v_honorary then
    insert into public.member_honorary (member_id, reason)
    values (p_member_id, v_reason)
    on conflict (member_id) do update set reason = excluded.reason, updated_at = now();
    -- 미납(unpaid)만 정리. 납부/부분납·수동 waived/void는 보존.
    delete from public.dues_charges
    where kind = 'monthly_fee' and member_id = p_member_id
      and amount_paid = 0 and status = 'unpaid';
    get diagnostics v_deleted = row_count;
  else
    delete from public.member_honorary where member_id = p_member_id;
  end if;

  insert into public.dues_audit_log (actor_member_id, action, detail)
  values (public.current_member_id(), 'set_honorary',
          jsonb_build_object('member', p_member_id, 'honorary', v_honorary,
                             'reason', v_reason, 'cleared_unpaid', v_deleted));

  return jsonb_build_object('ok', true, 'honorary', v_honorary, 'cleared_unpaid', v_deleted);
end $function$;

revoke execute on function public.dues_set_honorary(uuid, boolean, text) from public, anon;
grant execute on function public.dues_set_honorary(uuid, boolean, text) to authenticated;
