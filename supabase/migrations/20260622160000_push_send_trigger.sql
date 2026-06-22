-- ============================================================
-- notifications INSERT → send-push Edge Function 호출 (웹푸시 발송 트리거)
--   pg_net으로 비동기 HTTP POST. 호출 URL/시크릿은 Vault에서 읽어
--   마이그레이션/코드에 평문 노출하지 않는다.
--
--   ▶ 사전 등록 필요 (대시보드 Vault 또는 SQL) — 미설정 시 트리거는 조용히 통과:
--       edge_function_url = https://<project-ref>.supabase.co/functions/v1/send-push
--       push_send_secret  = <Edge Function의 PUSH_SEND_SECRET과 동일 값>
--
--   Database Webhook(대시보드) 대신 마이그레이션으로 버전관리한다
--   (이 프로젝트의 "스키마/트리거는 마이그레이션으로 관리" 원칙).
-- ============================================================
create extension if not exists pg_net;

create or replace function public.notify_push_send()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_url    text;
	v_secret text;
begin
	select decrypted_secret into v_url
	from vault.decrypted_secrets where name = 'edge_function_url';
	select decrypted_secret into v_secret
	from vault.decrypted_secrets where name = 'push_send_secret';

	-- 시크릿 미설정 시 조용히 통과(알림 INSERT 자체는 막지 않음)
	if v_url is null or v_secret is null then
		return new;
	end if;

	-- fire-and-forget: HTTP 실패해도 트랜잭션은 커밋(알림 INSERT가 푸시 실패로 롤백되지 않음).
	-- 응답은 net._http_response 테이블에서 확인 가능.
	perform net.http_post(
		url     := v_url,
		headers := jsonb_build_object(
			'Content-Type', 'application/json',
			'x-push-secret', v_secret
		),
		body    := jsonb_build_object(
			'id', new.id,
			'recipient_member_id', new.recipient_member_id,
			'type', new.type,
			'session_id', new.session_id,
			'payload', new.payload
		)
	);
	return new;
end;
$$;

drop trigger if exists trg_notify_push_send on public.notifications;
create trigger trg_notify_push_send
	after insert on public.notifications
	for each row execute function public.notify_push_send();
