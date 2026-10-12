-- 웹푸시 발송 트리거를 행 단위 → 문장 단위(묶음)로.
--
-- 2026-10-11 일요일 18:00 공개 때 sync_schedule_occurrences 가 sessions_opened 알림 123행을 한 문장으로
--   넣었고, 행 트리거가 net.http_post 를 123번 쏴 send-push 가 88번 동시에 떴다. 각 호출이 PostgREST 로
--   push_subscriptions·sessions·places 조회와 notifications 갱신을 따로 보내 18:00:02~06 에 수백 건이
--   몰렸고, 무료 플랜 PostgREST 연결(약 10개)이 바닥나 앱 전체가 약 25초 멈췄다(push_subscriptions GET 평균 16초).
--
-- 이제 INSERT 문장 하나당 새 행을 CHUNK 개씩 묶어 http_post 한다. send-push 는 묶음 하나에 대해
--   구독·회차·장소를 각각 한 번씩만 조회한다(같은 날 배포한 묶음 처리 버전 — 단건 본문도 계속 받는다).
--   알림 1건짜리 INSERT(승격·취소 등)는 묶음 1개 = 종전과 같은 호출 1번이다.
--
-- 배포 순서: send-push(묶음 수용 버전)를 먼저 deploy → 그 다음 db push. 반대로 하면 그 사이 알림이
--   묶음 본문을 모르는 옛 함수로 가서 발송되지 않는다.

create or replace function public.notify_push_send_batch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	-- 묶음 하나가 한 번의 Edge Function 실행이 된다. 너무 크면 한 실행이 길어지고(웹푸시 암호화·전송),
	--   너무 작으면 다시 동시 실행이 늘어난다. 정기 공개 ~120건 → 3번.
	c_chunk  constant int := 50;
	v_url    text;
	v_secret text;
	v_batch  jsonb;
begin
	select decrypted_secret into v_url
	from vault.decrypted_secrets where name = 'edge_function_url';
	select decrypted_secret into v_secret
	from vault.decrypted_secrets where name = 'push_send_secret';

	-- 미설정/비정상이면 전송 생략(알림 INSERT 자체는 정상 진행)
	if v_url is null or v_url !~ '^https?://' or v_secret is null or v_secret = '' then
		return null;
	end if;

	for v_batch in
		select jsonb_agg(jsonb_build_object(
				'id', r.id,
				'recipient_member_id', r.recipient_member_id,
				'type', r.type,
				'session_id', r.session_id,
				'payload', r.payload))
		from (
			select n.*, (row_number() over () - 1) / c_chunk as grp
			from new_rows n
		) r
		group by r.grp
	loop
		-- fire-and-forget: 전송 오류는 상위 트랜잭션에 절대 전파하지 않는다.
		begin
			perform net.http_post(
				url     := v_url,
				headers := jsonb_build_object(
					'Content-Type', 'application/json',
					'x-push-secret', v_secret
				),
				body    := jsonb_build_object('notifications', v_batch),
				-- 묶음 발송은 수 초 걸릴 수 있다. pg_net 기본(5초)에 끊기지 않게 넉넉히.
				--   pg_net 은 백그라운드 워커라 이 대기는 DB 연결을 붙잡지 않는다.
				timeout_milliseconds := 60000
			);
		exception
			when others then
				raise warning 'notify_push_send_batch failed (무시): %', sqlerrm;
		end;
	end loop;

	return null;
end;
$$;

revoke execute on function public.notify_push_send_batch() from public, anon, authenticated;

drop trigger if exists trg_notify_push_send on public.notifications;
create trigger trg_notify_push_send
	after insert on public.notifications
	referencing new table as new_rows
	for each statement execute function public.notify_push_send_batch();

-- 행 단위 함수는 더 이상 어디에도 걸려 있지 않다.
drop function if exists public.notify_push_send();
