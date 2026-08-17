-- Supabase Security Advisor: SECURITY DEFINER 함수의 anon/authenticated EXECUTE 정리.
--   anon_security_definer_function_executable          70건
--   authenticated_security_definer_function_executable 75건
-- SECURITY DEFINER 함수는 소유자(postgres) 권한으로 돌기 때문에, 부를 수 있는 롤을 넓게 열어두면
-- RLS 를 우회하는 통로가 그만큼 늘어난다. Supabase 기본 권한(alter default privileges)이 public 스키마
-- 함수 전부를 anon·authenticated 에 열어주므로, 실제로 필요한 것만 남기고 걷어낸다.
--
-- service_role·postgres 는 명시 GRANT 를 따로 갖고 있어(proacl 에 service_role=X/postgres 확인)
-- 여기서 회수해도 Edge Function(ingest-bank-email·send-push)·pg_cron 경로는 영향이 없다.
--
-- 분류 근거
--  ① 트리거 전용: 트리거 발화에는 호출자의 EXECUTE 권한이 필요 없다(롤백 트랜잭션으로 실증).
--  ② 내부 전용: 다른 SECURITY DEFINER 함수 안에서만 호출된다. definer 내부 호출은 소유자 권한으로
--     실행되므로 호출자 롤의 EXECUTE 가 필요 없다.
--  ③ 클라이언트 RPC: src/ 에서 supabase.rpc(...) 로 실제 호출하는 함수. authenticated 는 유지한다.
--
-- 예외로 반드시 authenticated 를 남겨야 하는 것:
--   is_admin(), current_member_id() — RLS 정책 표현식이 직접 부른다.
--   정책 안의 함수 호출은 호출자 권한으로 평가되므로 회수하면 정책이 permission denied 로 깨진다
--   (이것도 롤백 트랜잭션으로 확인했다). current_member_id 는 클라이언트가 부르진 않지만 같은 이유로 남긴다.

-- ① 트리거 전용 함수 — 어떤 롤도 직접 호출할 일이 없다.
--    (트리거 발화에는 EXECUTE 권한이 필요 없음을 롤백 트랜잭션으로 실증하고 회수한다.)
revoke execute on function public.broadcast_session_sync() from public, anon, authenticated;
revoke execute on function public.bump_session_sync_from_children() from public, anon, authenticated;
revoke execute on function public.dues_alloc_guard() from public, anon, authenticated;
revoke execute on function public.dues_alloc_sync() from public, anon, authenticated;
revoke execute on function public.notify_admins_new_member() from public, anon, authenticated;
revoke execute on function public.notify_push_send() from public, anon, authenticated;
revoke execute on function public.trg_audit_attendance() from public, anon, authenticated;
revoke execute on function public.trg_audit_counter() from public, anon, authenticated;
revoke execute on function public.trg_audit_session() from public, anon, authenticated;
revoke execute on function public.trg_complete_playing_on_close() from public, anon, authenticated;
revoke execute on function public.trg_session_court_on_close() from public, anon, authenticated;
revoke execute on function public.trim_notifications() from public, anon, authenticated;

-- ② 내부 전용 함수 — 다른 SECURITY DEFINER 함수/트리거 안에서만 불린다.
--    definer 안에서의 호출은 소유자(postgres) 권한으로 실행되므로 호출자 롤의 EXECUTE 가 필요 없다.
revoke execute on function public.board_assert_editor(p_session_id bigint, p_client_id text, p_name text, p_lease_seconds integer) from public, anon, authenticated;
revoke execute on function public.complete_session_playing_matches(p_session_id bigint) from public, anon, authenticated;
revoke execute on function public.delete_member(p_member_id uuid) from public, anon, authenticated;
revoke execute on function public.dues_generate_monthly(p_ym text) from public, anon, authenticated;
revoke execute on function public.dues_generate_session_court(p_session_id bigint) from public, anon, authenticated;
revoke execute on function public.dues_notify_selected(p_member_ids uuid[], p_msg text) from public, anon, authenticated;
revoke execute on function public.dues_set_session_fee(p_session_id bigint, p_amount integer) from public, anon, authenticated;
revoke execute on function public.dues_sync_bank_tx(p_tx_id bigint) from public, anon, authenticated;
revoke execute on function public.generate_dues_charges(p_ym text) from public, anon, authenticated;
revoke execute on function public.is_operator(p_member_id uuid) from public, anon, authenticated;
revoke execute on function public.ops_audit_write(p_kind text, p_session_id bigint, p_member_id uuid, p_detail jsonb) from public, anon, authenticated;
revoke execute on function public.promote_next_waitlisted(p_session_id bigint) from public, anon, authenticated;
revoke execute on function public.promote_waitlist_fill(p_session_id bigint) from public, anon, authenticated;
revoke execute on function public.session_counter_sync(p_session_id bigint) from public, anon, authenticated;
revoke execute on function public.session_guest_cap(p_session_id bigint) from public, anon, authenticated;
revoke execute on function public.session_op_free(p_session_id bigint) from public, anon, authenticated;

-- ③ 클라이언트 RPC — authenticated 는 유지하고 anon·PUBLIC 만 회수한다.
--    이 앱은 전 화면이 로그인 필수라 anon 이 이 함수들을 부를 경로가 없다.
revoke execute on function public.add_guest_attendance(p_session_id bigint, p_name text, p_gender text, p_skills jsonb) from public, anon;
revoke execute on function public.admin_cancel_attendance(p_session_id bigint, p_member_id uuid) from public, anon;
revoke execute on function public.assign_match(p_match_id uuid, p_session_id bigint, p_court_id integer, p_game_type text, p_team_a_p1 uuid, p_team_a_p2 uuid, p_team_b_p1 uuid, p_team_b_p2 uuid, p_client_id text, p_name text, p_lease_seconds integer) from public, anon;
revoke execute on function public.board_claim_editor(p_session_id bigint, p_client_id text, p_name text, p_lease_seconds integer) from public, anon;
revoke execute on function public.board_handoff_editor(p_session_id bigint, p_from_client_id text, p_to_client_id text, p_to_name text, p_lease_seconds integer) from public, anon;
revoke execute on function public.board_release_editor(p_session_id bigint, p_client_id text) from public, anon;
revoke execute on function public.board_save_drafts(p_session_id bigint, p_client_id text, p_name text, p_payload jsonb, p_base_version bigint, p_lease_seconds integer) from public, anon;
revoke execute on function public.board_takeover_editor(p_session_id bigint, p_client_id text, p_name text, p_lease_seconds integer) from public, anon;
revoke execute on function public.cancel_attendance(p_session_id bigint) from public, anon;
revoke execute on function public.cancel_guest_attendance(p_session_id bigint, p_guest_member_id uuid) from public, anon;
revoke execute on function public.complete_match(p_match_id uuid, p_session_id bigint, p_game_type text, p_team_a_p1 uuid, p_team_a_p2 uuid, p_team_b_p1 uuid, p_team_b_p2 uuid, p_client_id text, p_name text, p_lease_seconds integer) from public, anon;
revoke execute on function public.current_member_id() from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
revoke execute on function public.dues_add_category(p_name text) from public, anon;
revoke execute on function public.dues_cancel_match(p_tx_id bigint) from public, anon;
revoke execute on function public.dues_club_account() from public, anon;
revoke execute on function public.dues_confirm_court_external(p_tx_id bigint, p_session_id bigint) from public, anon;
revoke execute on function public.dues_confirm_reconcile(p_tx_id bigint, p_payer_member_id uuid, p_charge_ids bigint[], p_ym text, p_sessions jsonb) from public, anon;
revoke execute on function public.dues_defer_charge(p_charge_id bigint) from public, anon;
revoke execute on function public.dues_delete_category(p_id bigint) from public, anon;
revoke execute on function public.dues_ensure_monthly(p_ym text) from public, anon;
revoke execute on function public.dues_link_refund(p_out_tx_id bigint, p_in_tx_id bigint) from public, anon;
revoke execute on function public.dues_my_payments() from public, anon;
revoke execute on function public.dues_public_ledger(p_ym text) from public, anon;
revoke execute on function public.dues_set_charge_status(p_charge_id bigint, p_status text) from public, anon;
revoke execute on function public.dues_set_honorary(p_member_id uuid, p_honorary boolean, p_reason text) from public, anon;
revoke execute on function public.dues_set_txn_category(p_tx_id bigint, p_category_id bigint) from public, anon;
revoke execute on function public.dues_set_txn_category(p_tx_id bigint, p_category_id bigint, p_paid_by uuid) from public, anon;
revoke execute on function public.dues_set_txn_session(p_tx_id bigint, p_session_id bigint) from public, anon;
revoke execute on function public.dues_settle_deferred(p_charge_id bigint) from public, anon;
revoke execute on function public.dues_undefer_charge(p_charge_id bigint) from public, anon;
revoke execute on function public.dues_unlink_refund(p_out_tx_id bigint) from public, anon;
revoke execute on function public.grant_admin(p_member_id uuid) from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.join_session(p_session_id bigint) from public, anon;
revoke execute on function public.load_session_state(p_session_id bigint) from public, anon;
revoke execute on function public.notify_members_schedule_added(p_session_id bigint, p_label text) from public, anon;
revoke execute on function public.revoke_admin(p_member_id uuid) from public, anon;
revoke execute on function public.set_carpool_groups(p_session_id bigint, p_groups jsonb) from public, anon;
revoke execute on function public.set_carpool_role(p_session_id bigint, p_role text) from public, anon;
revoke execute on function public.set_cock_checked(p_session_player_id uuid) from public, anon;
revoke execute on function public.set_late_minutes(p_session_id bigint, p_minutes integer) from public, anon;
revoke execute on function public.set_match_roster(p_match_id uuid, p_session_id bigint, p_team_a_p1 uuid, p_team_a_p2 uuid, p_team_b_p1 uuid, p_team_b_p2 uuid, p_removed_ids uuid[], p_added_ids uuid[], p_client_id text, p_name text, p_lease_seconds integer) from public, anon;
revoke execute on function public.set_meal_joining(p_session_id bigint, p_joining boolean, p_member_id uuid) from public, anon;
revoke execute on function public.set_player_resting(p_session_player_id uuid, p_session_id bigint, p_resting boolean) from public, anon;
revoke execute on function public.set_session_capacity(p_session_id bigint, p_capacity integer) from public, anon;
revoke execute on function public.start_session_from_schedule(p_session_id bigint) from public, anon;
revoke execute on function public.sync_schedule_occurrences() from public, anon;
revoke execute on function public.update_player_skill(p_session_player_id uuid, p_skills jsonb) from public, anon;

-- 메모: dues_notify_selected 는 클라 래퍼를 2026-08 에 폐기했지만 RPC 자체는 남아 있다(dues.ts 주석 참조).
-- 래퍼를 되살릴 때는 이 파일의 ② 목록에서 빼고 `grant execute ... to authenticated` 를 함께 넣어야 한다.
-- delete_member 도 마찬가지로 하드삭제 폐지(20260721000000)로 호출자가 없어 ② 로 내렸다.
