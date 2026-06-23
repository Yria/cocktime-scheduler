-- 미사용 관리자 RPC 및 전용 죽은 컬럼 정리
--
-- 배경:
--   아래 두 RPC 는 Phase 5/7 확장 때 서버측(DB+알림 파이프라인)까지 만들었으나
--   클라이언트 호출이 한 번도 연결된 적이 없다(git 이력 전체 확인). 운영진 트리거 UI 미구현.
--   - promote_waitlist        : 정원 상향 후 대기자 일괄 승급. (취소 시 자동승급은 cancel_attendance 가 담당)
--   - announce_carpool_muster : 카풀 집결 공지. (본인 의향설정 set_carpool_role 는 사용 중 — 유지)
--
-- 안전성:
--   - promote_waitlist 가 쓰던 객체(session_counters/attendances/notifications/sessions)는 전부
--     다른 활성 RPC 와 공유 → 함수만 제거하면 됨. 남는 찌꺼기 없음.
--   - announce_carpool_muster 전용 컬럼 sessions.carpool_muster_place_id/at 는 이 함수만 write 하고
--     읽는 곳이 없다(알림 표시는 notifications.payload 로 처리). → 함수와 함께 컬럼·FK 제거.
--   - 'promoted' / 'carpool_muster' 알림 렌더링(클라이언트)은 과거 알림 표시를 위해 그대로 둔다.

drop function if exists public.promote_waitlist(bigint);
drop function if exists public.announce_carpool_muster(bigint, bigint, timestamptz);

-- announce_carpool_muster 전용 죽은 컬럼 (DROP COLUMN 이 FK sessions_carpool_muster_place_id_fkey 도 함께 제거)
alter table public.sessions
	drop column if exists carpool_muster_place_id,
	drop column if exists carpool_muster_at;
