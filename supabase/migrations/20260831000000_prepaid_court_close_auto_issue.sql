-- ============================================================
-- 선납이 있는 세션도 종료 최초 발행은 자동으로 완성한다 (2026-08-31)
--
-- 실제 사고: 세션 165(8/30 에이트민턴)는 종료 전 선납 부과 12건이 있었다. 종료 트리거가
-- 나머지 16명을 계산했지만, 생성기는 `이미 발행됨 > 0`만 보고 전부 `new_members` 발행 대기로
-- 보냈다. 선납자는 "발행한 뒤 새로 대상이 된 사람"이 아닌데도 같은 모양으로 본 것이다.
-- 이후 입금 확인으로 4건이 더 즉석 발행돼, 정산 대조에는 대상 28 - 발행 16 = `확인 12`가
-- 떴다. 22:14에 운영진이 초안을 발행하면서 12건이 생성돼 현재 데이터는 정상이다.
--
-- 원칙:
--   · 세션이 closed 로 바뀌는 **최초 발행**: 기존 행은 선납이므로, 나머지도 정상 자동 발행.
--   · 종료 후 재계산: 기존 발행 뒤 새 대상이 붙은 것이므로 종전대로 `new_members` 대기.
--   · amount_out_of_range 안전망은 최초 발행에도 그대로 적용.
--
-- 호출 의도를 숨은 시간 추정으로 판별하지 않는다. 2인자 내부 함수를 두고 종료 트리거만
-- p_initial=true 로 호출한다. 기존 1인자 함수는 p_initial=false 래퍼로 남겨 수동 재실행·
-- 총액 재발행 등 기존 호출부와 권한을 보존한다.
-- ============================================================

create or replace function public.dues_generate_session_court(p_session_id bigint, p_initial boolean)
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare
	v_court int;
	v_total int;
	v_eligible boolean;
	v_head int;
	v_per int;
	v_split boolean;
	v_group text := 'court:' || p_session_id::text;
	v_issued int;
	v_new int := 0;
	v_diff int;
	v_head_all int;
	v_hold text;
begin
	select court_fee_default into v_court from public.dues_settings where id = 1;

	select (p.charges_court_fee
	        and s.status in ('active','closed')
	        and s.scheduled_at is not null
	        and exists (select 1 from public.matches mt where mt.session_id = s.id)),
	       coalesce(s.court_fee, r.court_fee)
	  into v_eligible, v_total
	from public.sessions s
	left join public.places p on p.id = s.place_id
	left join public.recurring_schedules r on r.id = s.recurring_schedule_id
	where s.id = p_session_id;

	if v_eligible is not true or v_total <= 0 then
		delete from public.dues_charge_drafts where draft_group = v_group;
		return 0;
	end if;

	v_split := (v_total is not null and v_total > 0);
	if v_split then
		select count(*) into v_head from public.dues_court_targets(p_session_id, true);
		if v_head = 0 then
			delete from public.dues_charge_drafts where draft_group = v_group;
			return 0;
		end if;
		v_per := ceil(v_total::numeric / v_head / 10)::int * 10;
		if v_per >= v_court and v_per < v_court + 200 then
			v_per := v_court;
		end if;
	else
		v_per := v_court;
	end if;

	select count(*) into v_head_all from public.dues_court_targets(p_session_id, v_split);

	select count(*) into v_issued
	  from public.dues_charges
	 where kind = 'court_fee' and session_id = p_session_id and status <> 'void';

	select count(*) into v_diff
	  from public.dues_court_targets(p_session_id, v_split) d
	 where not exists (
	   select 1 from public.dues_charges c
	    where c.kind = 'court_fee' and c.session_id = p_session_id and c.member_id = d.member_id);

	if v_diff = 0 then
		delete from public.dues_charge_drafts where draft_group = v_group;
		return 0;
	end if;

	-- 금액 이상은 최초 발행에도 반드시 멈춘다. new_members 만 "종료 후 추가"일 때로 좁힌다.
	if v_per * 2 < v_court or v_per > v_court * 5 / 2 then
		v_hold := 'amount_out_of_range';
	elsif v_issued > 0 and not p_initial then
		v_hold := 'new_members';
	end if;

	if v_hold is not null then
		delete from public.dues_charge_drafts where draft_group = v_group;
		insert into public.dues_charge_drafts
			(draft_group, kind, session_id, label, charged_on, member_id, amount_due, payer_hint, is_day_cancel, hold_reason, hold_detail)
		select v_group, 'court_fee', p_session_id,
		       to_char((s.scheduled_at at time zone 'Asia/Seoul')::date, 'MM/DD') || ' ' || coalesce(p.name, '대관') || ' 대관비',
		       (s.scheduled_at at time zone 'Asia/Seoul')::date,
		       d.member_id, v_per, d.payer_hint, d.is_day_cancel,
		       v_hold,
		       jsonb_build_object('per_head', v_per, 'flat', v_court, 'total', v_total,
		                          'head', v_head_all, 'already_issued', v_issued)
		  from public.dues_court_targets(p_session_id, v_split) d
		  cross join public.sessions s
		  left join public.places p on p.id = s.place_id
		 where s.id = p_session_id
		   and not exists (
		     select 1 from public.dues_charges c
		      where c.kind = 'court_fee' and c.session_id = p_session_id and c.member_id = d.member_id);
		return 0;
	end if;

	insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint, is_day_cancel)
	select 'court_fee', d.member_id, p_session_id, v_per, d.payer_hint, d.is_day_cancel
	  from public.dues_court_targets(p_session_id, v_split) d
	on conflict (member_id, session_id) where session_id is not null
	do nothing;
	get diagnostics v_new = row_count;

	delete from public.dues_charge_drafts where draft_group = v_group;
	return v_new;
end $function$;

revoke execute on function public.dues_generate_session_court(bigint, boolean) from public, anon, authenticated;

comment on function public.dues_generate_session_court(bigint, boolean) is
	'대관비 초안 계산·발행 내부 함수. p_initial=true(세션 closed 최초 발행)는 기존 선납을 new_members로 '
	'오인하지 않고 나머지를 자동 발행한다. 종료 후 추가 대상은 p_initial=false 경로에서 발행 대기. 2026-08-31.';

-- 기존 내부 호출은 보수적인 "종료 후 재계산" 의미를 유지한다.
create or replace function public.dues_generate_session_court(p_session_id bigint)
returns int
language sql
security definer
set search_path to ''
as $function$
	select public.dues_generate_session_court(p_session_id, false);
$function$;

revoke execute on function public.dues_generate_session_court(bigint) from public, anon, authenticated;

comment on function public.dues_generate_session_court(bigint) is
	'대관비 재계산 호환 래퍼. 종료 후 새 대상은 new_members 발행 대기로 보낸다. 최초 종료 발행은 2인자 내부 함수를 쓴다.';

-- 종료 이벤트만 최초 발행임을 명시한다. 선납이 있어도 나머지는 여기서 자동 발행된다.
create or replace function public.trg_session_court_on_close()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
	perform public.dues_generate_session_court(new.id, true);
	return new;
end $function$;

revoke execute on function public.trg_session_court_on_close() from public, anon, authenticated;
