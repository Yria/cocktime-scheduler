-- 회원 탈퇴를 소프트(is_active=false)로 바꾸고, 회원 하드삭제 경로를 완전히 봉인한다.
--
-- 사고(실측 2026-08-19): 이한비 님의 members 행이 사라져 **7월 정산이 풀렸다**.
--   흔적 — session_players 4행(sessions 94·108·117·181)에 `player_id`(=옛 member uuid
--   b22094fb-eca9-4226-9895-0a27a812a53c)만 남고 `member_id` 는 null(FK on delete set null 흔적).
--   그리고 적요에 이름이 든 입금 5건(6월 3건, **7월 2건 = 7월회비 5,000 + 0726 대관비 6,000**)이
--   전부 `unmatched` 로 되돌아갔다. `dues_charges`·`dues_allocations` 가 ON DELETE CASCADE 라
--   부과와 배분이 함께 사라지고, `bank_transactions.paid_by` 는 SET NULL 돼 미분류로 복귀한 것이다.
--
-- 즉 남아 있던 하드삭제 경로가 회계를 파괴했다. `20260721000000_disable_member_hard_delete.sql` 은
--   **운영진용** `delete_member` 만 봉인하고 **본인용** `delete_my_account` 는 그대로 뒀고(같은 CASCADE),
--   RLS `members_delete using is_admin()` 정책도 열려 있어 클라이언트 직접 DELETE 까지 가능했다.
--   (그 파일이 정한 정책 자체가 "탈퇴는 is_active=false 로만" 이었으므로, 이 파일은 그 정책의 이행이다.)
--
-- 부수 효과 하나 더: attendances 도 CASCADE 라 하드삭제는 `session_counters.confirmed_count` 를
--   줄이지 않고 참석 행만 없애 카운터 드리프트(빈자리 승격 영구 정지)를 남길 수 있었다.
--
-- 이 파일이 하는 일
--   1) `delete_my_account` → 소프트 탈퇴. 회원 행(이름·부과·배분)은 남기고 로그인만 끊는다.
--   2) 예정/진행 세션의 참석은 정식 취소 경로(`cancel_attendance`)로 비운다 — 카운터 재계산과
--      대기 승격이 함께 돌아야 빈자리가 유령으로 남지 않는다.
--   3) RLS `members_delete` 정책 삭제 + authenticated 의 DELETE 권한 회수.
--
-- 남기는 것과 지우는 것
--   · 남긴다: `name`(정산 대조의 유일한 키), 부과·배분·참석 이력, 보드 이력, user_roles.
--   · 지운다: `auth_user_id`(로그인 불가), `phone`·`residence`·`avatar_url`(개인정보),
--     `push_subscriptions`(계정이 없는데 알림이 가는 걸 막는다), auth.users 행.
--     단 `birth_year` 는 남긴다 — 동명이인 구분자이자 명단 딱지의 유일한 근거다(아래 ② 주석).
--   · `is_active=false` 로 명단·편성에서 빠진다. 회비는 2026-08-19 정책대로 **계속 부과**되며,
--     걷지 않기로 하면 회비 현황에서 [면제] 를 누른다(20260819000000 참조).
--
-- 거부한 대안: members 행까지 지우고 회계만 다른 테이블로 옮겨 보존 — 이름이 사라지면 통장 적요와
--   대조할 수 없어 정산이 영구히 안 맞는다. 지금 이한비 님 5건이 그 증거다.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
	v_uid    uuid := auth.uid();
	v_member uuid;
	v_sid    bigint;
begin
	if v_uid is null then
		raise exception 'not authenticated';
	end if;

	select id into v_member from public.members where auth_user_id = v_uid;
	if v_member is null then
		-- 회원 행 없이 auth 계정만 남은 경우(가입 중단 등) — 계정만 지운다.
		delete from auth.users where id = v_uid;
		return;
	end if;

	-- ① 아직 안 끝난 세션의 참석을 정식 경로로 취소한다.
	--   current_member_id() 를 쓰므로 auth_user_id 를 끊기 **전에** 돌려야 한다.
	--   closed/cancelled 세션은 cancel_attendance 가 'session ended' 로 거부하므로 제외한다.
	for v_sid in
		select a.session_id
		from public.attendances a
		join public.sessions s on s.id = a.session_id
		where a.member_id = v_member
		  and a.status <> 'cancelled'
		  and s.status in ('draft', 'open', 'active')
	loop
		perform public.cancel_attendance(v_sid);
	end loop;

	-- ② 회원 행은 남기고 로그인·개인정보만 끊는다(부과·배분·이름 보존).
	--   birth_year 는 남긴다: 동명이인이 실제로 3쌍(김영주 97/92 · 김지훈 02/96 · 이지은 95/99) 있고,
	--   미납·면제 명단과 확인 다이얼로그의 유일한 구분자가 년생 딱지다. 지우면 운영진이 활동 중인
	--   동명 회원의 회비를 면제하는 오조작이 조용히 성립한다(이름을 남긴 것과 같은 이유).
	update public.members
	set is_active     = false,
	    auth_user_id  = null,
	    phone         = null,
	    residence     = null,
	    avatar_url    = null,
	    updated_at    = now()
	where id = v_member;

	-- ③ 계정이 없는 사람에게 푸시가 가지 않게 구독 정리.
	delete from public.push_subscriptions where member_id = v_member;

	insert into public.ops_audit (kind, member_id, actor, detail)
	values ('member_self_soft_delete', v_member, v_member,
	        jsonb_build_object('why', '본인 탈퇴(소프트) — 회원 행·부과 보존'));

	-- ④ 인증 계정 삭제(로그인 불가). members.auth_user_id 는 ①에서 이미 끊었으므로
	--   FK(on delete set null)가 회원 행을 건드릴 일이 없다.
	delete from auth.users where id = v_uid;
end $function$;

comment on function public.delete_my_account() is
  '본인 탈퇴 = 소프트(2026-08-19). 회원 행·부과·배분·이름은 보존하고 로그인/개인정보/푸시만 끊는다. 하드삭제는 회계 CASCADE 유실 때문에 전면 금지.';

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ── 클라이언트 직접 DELETE 봉인 ──────────────────────────────────────
-- RPC 게이트(delete_member 는 항상 예외)만으로는 부족했다 — 운영진 JWT 로
-- `supabase.from('members').delete()` 가 이 정책을 타고 그대로 나갔다.
drop policy if exists members_delete on public.members;
revoke delete on public.members from authenticated;
revoke delete on public.members from anon;
