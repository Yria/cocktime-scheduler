-- ============================================================
-- notify_push_send 격리 수정
--   문제: net.http_post의 동기 오류(libcurl "URL using bad/illegal format
--         or missing URL" 등)가 트리거를 통해 상위 트랜잭션(cancel_attendance/
--         promote_waitlist의 취소·승급)을 롤백시켜 핵심 기능이 깨졌다.
--   수정: (1) URL이 http(s)로 시작하지 않으면 전송 생략(잘못된 Vault 값 방어)
--         (2) 전송 호출을 BEGIN/EXCEPTION으로 격리 — 어떤 오류도 상위
--             트랜잭션에 전파하지 않는다(진짜 fire-and-forget). 실패는 WARNING 로그.
-- ============================================================
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

	-- 미설정/비정상이면 전송 생략(알림 INSERT 자체는 정상 진행)
	if v_url is null or v_url !~ '^https?://' or v_secret is null or v_secret = '' then
		return new;
	end if;

	-- fire-and-forget: 전송 오류는 상위 트랜잭션에 절대 전파하지 않는다.
	begin
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
	exception
		when others then
			raise warning 'notify_push_send failed (무시): %', sqlerrm;
	end;

	return new;
end;
$$;
