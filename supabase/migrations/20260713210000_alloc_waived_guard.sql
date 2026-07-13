-- 회계 Migration 17: 배분 가드 강화 — waived/void 부과에는 배분 금지.
-- dues_alloc_sync 는 waived/void 상태를 덮어쓰지 않으므로, 그런 부과에 배분이 들어가면
-- amount_paid만 늘고 status='waived'로 남아 입금이 조용히 소모됨(적대적 검증에서 확인).
-- 모든 배분 경로(compose·new_monthly·new_court·confirm_match·manual_payment)를 한 번에 막기 위해
-- BEFORE 트리거(dues_alloc_guard)에서 차단한다. 면제 부과에 납부를 붙이려면 먼저 reset 필요.

create or replace function public.dues_alloc_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
	v_sum    int;
	v_txamt  int;
	v_cstat  text;
begin
	-- 부과 상태 가드: 면제/무효 부과에는 배분 불가.
	if NEW.charge_id is not null then
		select status into v_cstat from public.dues_charges where id = NEW.charge_id;
		if v_cstat in ('waived', 'void') then
			raise exception 'cannot allocate to % charge %', v_cstat, NEW.charge_id;
		end if;
	end if;

	if NEW.bank_tx_id is not null then
		-- 동시 배분 직렬화: 부모 거래행을 먼저 잠근 뒤 합산(잠금 이후 스냅샷이 경합 배분을 포함) → 과다배분 방지.
		select amount into v_txamt
			from public.bank_transactions where id = NEW.bank_tx_id for update;
		if v_txamt is null then
			raise exception 'bank_tx % not found', NEW.bank_tx_id;
		end if;
		select coalesce(sum(amount), 0) into v_sum
			from public.dues_allocations
			where bank_tx_id = NEW.bank_tx_id and id <> coalesce(NEW.id, -1);
		if v_sum + NEW.amount > v_txamt then
			raise exception 'allocation exceeds transaction amount (tx=%: %+% > %)',
				NEW.bank_tx_id, v_sum, NEW.amount, v_txamt;
		end if;
	end if;
	return NEW;
end $$;
