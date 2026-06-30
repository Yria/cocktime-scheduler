-- 카풀 공지 빌더(라이트) — 편성 저장
-- 계약서: docs/CARPOOL_MATCHING_DESIGN.md
--
-- 운영자가 지도로 "누가 누구 차에" 그룹을 짠 편성을 세션에 jsonb 한 컬럼으로 저장한다.
-- (board_drafts jsonb 패턴 그대로 — 신규 테이블/알림/배정 RPC 없음.)
-- 공지 텍스트는 이 편성 + 세션정보 + 회원 이름으로 클라이언트가 매번 생성(저장 안 함).
--
-- carpool_groups 형태:
--   { "v":1,
--     "groups":[{"driver_member_id":uuid,"rider_member_ids":[uuid,...]}],
--     "header": string|null,   -- 공지 헤더 override(없으면 세션정보로 자동 생성)
--     "footer": string|null }  -- 고정 안내문 override(없으면 기본 템플릿)
-- null = 미편성.

alter table public.sessions
	add column if not exists carpool_groups jsonb;

-- 편성 저장(운영자 전용). SECURITY DEFINER 라 sessions RLS 우회, 권한은 is_admin() 가 게이팅.
create or replace function public.set_carpool_groups(p_session_id bigint, p_groups jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	update public.sessions set carpool_groups = p_groups where id = p_session_id;
	if not found then raise exception 'session not found'; end if;
end;
$$;

revoke execute on function public.set_carpool_groups(bigint, jsonb) from anon;
grant execute on function public.set_carpool_groups(bigint, jsonb) to authenticated;
