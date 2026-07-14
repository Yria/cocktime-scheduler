-- 회비 이월(carry-over): 이번 달 미납 회비를 다음 달로 미룸.
--  · 이월: deferred_to = 다음 달. 원 월에선 숨김(낸 것처럼 취급), 다음 달에 미정산으로 노출.
--  · 수동 정산: status='waived' (미납만 해제, 금액 기록 없음 — 통장 전용 원칙상 phantom 수입 만들지 않음).
--  · 이월 취소: deferred_to 비우고 status='unpaid'로 원복.

alter table public.dues_charges add column if not exists deferred_to text;
comment on column public.dues_charges.deferred_to is '회비 이월 대상 월(YYYY-MM). set이면 원 월에서 숨김·해당 월에 미정산 노출.';

-- 이월: 미납 회비를 다음 달로.
create or replace function public.dues_defer_charge(p_charge_id bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_admin uuid := public.current_member_id(); v_kind text; v_ym text; v_status text; v_def text; v_to text;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	select kind, period_ym, status, deferred_to into v_kind, v_ym, v_status, v_def
		from public.dues_charges where id = p_charge_id;
	if v_kind is null then raise exception 'charge % not found', p_charge_id; end if;
	if v_kind <> 'monthly_fee' or v_ym is null then raise exception 'only monthly fee can be deferred'; end if;
	if v_def is not null then raise exception 'already deferred'; end if;
	if v_status not in ('unpaid','partial') then raise exception 'only unpaid can be deferred'; end if;
	v_to := to_char((v_ym || '-01')::date + interval '1 month', 'YYYY-MM');
	update public.dues_charges set deferred_to = v_to, updated_at = now() where id = p_charge_id;
	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (v_admin, 'defer_charge', jsonb_build_object('charge', p_charge_id, 'from', v_ym, 'to', v_to));
	return jsonb_build_object('charge', p_charge_id, 'to', v_to);
end $$;

-- 이월 취소: 원 월 미납으로 원복.
create or replace function public.dues_undefer_charge(p_charge_id bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_admin uuid := public.current_member_id(); v_def text;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	select deferred_to into v_def from public.dues_charges where id = p_charge_id;
	if v_def is null then raise exception 'not deferred'; end if;
	-- 배분이 있으면(부분납 등) 원복 불가 — 먼저 대사취소.
	if exists (select 1 from public.dues_allocations where charge_id = p_charge_id) then
		raise exception 'has allocations; cancel match first';
	end if;
	update public.dues_charges set deferred_to = null, status = 'unpaid', updated_at = now() where id = p_charge_id;
	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (v_admin, 'undefer_charge', jsonb_build_object('charge', p_charge_id));
	return jsonb_build_object('charge', p_charge_id);
end $$;

-- 수동 정산(이월분): 미납 해제만. 금액 기록 없음(waived).
create or replace function public.dues_settle_deferred(p_charge_id bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_admin uuid := public.current_member_id(); v_def text;
begin
	if not public.is_admin() then raise exception 'forbidden'; end if;
	select deferred_to into v_def from public.dues_charges where id = p_charge_id;
	if v_def is null then raise exception 'not a deferred charge'; end if;
	update public.dues_charges set status = 'waived', updated_at = now() where id = p_charge_id;
	insert into public.dues_audit_log (actor_member_id, action, detail)
	values (v_admin, 'settle_deferred', jsonb_build_object('charge', p_charge_id, 'month', v_def));
	return jsonb_build_object('charge', p_charge_id);
end $$;

revoke execute on function public.dues_defer_charge(bigint) from public;
revoke execute on function public.dues_undefer_charge(bigint) from public;
revoke execute on function public.dues_settle_deferred(bigint) from public;
grant execute on function public.dues_defer_charge(bigint) to authenticated;
grant execute on function public.dues_undefer_charge(bigint) to authenticated;
grant execute on function public.dues_settle_deferred(bigint) to authenticated;
