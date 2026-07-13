-- 회계(회비·대관비 자동 대사) — Migration 1: 스키마 + RLS + 트리거
-- 설계서: docs/ACCOUNTING_DESIGN.md §6(데이터 모델) · §11(RLS/보안)
--
-- 확정 결정(구현 시점, 2026-07-13):
--   · 운영진 = user_roles.role='admin' (is_operator 헬퍼) → 회비·대관비 둘 다 면제.
--   · 대관비 대상 = places.court_fee_per_head not null AND sessions.status in ('active','closed'),
--     참석 status in ('confirmed','late_pool') ＋ 당일취소자(confirmed_at 존재 & 취소일=세션일).
--     ※ late_pool(정원 외 늦참)도 부과 — "악용 방지"(부과 로직은 generate_dues_charges RPC, §7).
--   · 가입일 = coalesce(members.membership_started_at, created_at KST) — 계정 재가입 churn 대비 관리자 보정 컬럼.
--   · 금액 이력(dues_policies)은 생략 — dues_charges.amount_due 스냅샷이 과거 금액을 보존(§12.6 해소).
--
-- RLS 대원칙(§11): 신규 테이블 전부 anon 차단(to authenticated). 관리자 전용은 is_admin() 게이팅,
--   회원 본인 열람 예외는 dues_charges/dues_allocations 뿐. 쓰기는 SECURITY DEFINER RPC 경유
--   (함수 소유자 postgres가 RLS 우회 → 별도 write 정책 불필요. 기존 notifications 패턴과 동일).
--   은행 원문/거래·감사로그·클럽 계좌 등 민감 데이터는 회원 비노출.

-- ============================================================
-- ⓪ 공용 컬럼 & 헬퍼
-- ============================================================

-- 대관비 인당액의 단일 소스: 장소(코트). NULL = 대관비 없는 장소.
alter table public.places
	add column if not exists court_fee_per_head integer;
comment on column public.places.court_fee_per_head is
	'대관비 인당액(원). NULL이면 대관비 없는 장소 → 그 세션 참석자에게 court_fee charge 미생성. (기본 6000)';

-- 가입일 보정 컬럼(관리자). NULL이면 created_at(KST)을 가입일로 사용.
alter table public.members
	add column if not exists membership_started_at date;
comment on column public.members.membership_started_at is
	'회비 부과 기준 가입일(KST date). NULL이면 created_at 사용. 계정 재가입 시 관리자 보정용.';

-- is_operator(member_id): 임의 회원이 운영진(role='admin')인지. is_admin()은 현재 로그인 사용자용이라
-- 회원 순회(부과 생성)에는 사용 불가 → 별도 헬퍼. SECURITY DEFINER + search_path='' (user_roles RLS 재귀 회피).
create or replace function public.is_operator(p_member_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
	select exists (
		select 1 from public.user_roles
		where member_id = p_member_id and role = 'admin'
	)
$$;
-- 내부 전용: generate_dues_charges(SECURITY DEFINER, 소유자 postgres)에서만 호출 → 클라이언트 EXECUTE 불필요.
-- revoke from anon 만으로는 CREATE FUNCTION 의 암묵적 PUBLIC EXECUTE 가 남아 anon 이 임의 회원 admin 여부 probe 가능.
revoke execute on function public.is_operator(uuid) from public;

-- 계좌번호 마스킹(회원 노출용): 앞 3 + 뒤 2만 남기고 중간 마스킹.
create or replace function public.mask_account(p text)
returns text language sql immutable set search_path = ''
as $$
	select case
		when p is null then null
		when length(p) <= 5 then repeat('*', length(p))
		else left(p, 3) || repeat('*', length(p) - 5) || right(p, 2)
	end
$$;

-- ============================================================
-- ① dues_settings : 싱글톤 설정(회비액·대관비 기본액·offset·클럽 계좌[민감])
-- ============================================================
create table if not exists public.dues_settings (
	id                int primary key default 1 check (id = 1),
	monthly_fee       integer not null default 5000,   -- 회비/월
	court_fee_default integer not null default 6000,   -- 장소 대관비 기본값(places.court_fee_per_head 미설정 시 UI 프리필용)
	offset_days       int     not null default 3,      -- 가입일 오프셋(첫 부과월 계산, §7.1)
	bank_name         text,                             -- 클럽 계좌 은행명 (민감)
	bank_account      text,                             -- 클럽 계좌번호 원문 (민감 · 관리자만)
	account_holder    text,                             -- 예금주 (민감)
	updated_at        timestamptz not null default now()
);
insert into public.dues_settings (id) values (1) on conflict (id) do nothing;

-- ============================================================
-- ② raw_bank_emails : 수신 원문 불변 보관 (message_id UNIQUE = 이메일 멱등)
--    ※ 은행 메일수집(파서·Edge·Apps Script)은 다음 단계. 스키마만 선반영(FK 정합성).
-- ============================================================
create table if not exists public.raw_bank_emails (
	id           bigserial primary key,
	message_id   text not null unique,                 -- Gmail message id
	bank_code    text,                                 -- 파싱된 은행 코드(어댑터)
	subject      text,
	from_addr    text,
	received_at  timestamptz,                          -- 수신 시각(KST 파싱)
	raw_html     text,                                 -- 원문(재파싱·감사)
	parse_status text not null default 'pending'
		check (parse_status in ('pending','parsed','unsupported','error')),
	parse_error  text,
	created_at   timestamptz not null default now()
);

-- ============================================================
-- ③ expense_categories : 지출 분류(코트대관/셔틀콕/기타) — 출금 태깅용(§10)
-- ============================================================
create table if not exists public.expense_categories (
	id         bigserial primary key,
	name       text not null unique,
	created_at timestamptz not null default now()
);

-- ============================================================
-- ④ bank_transactions : 정규화 거래 (dedup_key UNIQUE = 거래 멱등, direction in/out)
-- ============================================================
create table if not exists public.bank_transactions (
	id                  bigserial primary key,
	raw_email_id        bigint references public.raw_bank_emails(id) on delete set null,
	bank_code           text,
	direction           text not null check (direction in ('in','out')),
	amount              integer not null check (amount > 0),   -- 원 단위 정수(항상 양수, 방향은 direction)
	counterparty_name   text,                                   -- 입금자명 원문
	occurred_at         timestamptz not null,                   -- 거래 시각(KST 파싱)
	balance_after       integer,
	memo                text,
	dedup_key           text not null unique,                   -- 거래 멱등 키(은행+시각+금액+잔액 등 조합)
	status              text not null default 'unmatched'
		check (status in ('unmatched','proposed','partial','matched','ignored')),
	expense_category_id bigint references public.expense_categories(id) on delete set null, -- direction='out' 태깅
	created_at          timestamptz not null default now()
);
create index if not exists idx_bank_tx_status on public.bank_transactions(status);
create index if not exists idx_bank_tx_occurred on public.bank_transactions(occurred_at);

-- ============================================================
-- ⑤ dues_charges : 부과의 물질화 — (member_id, period_ym) 또는 (member_id, session_id) XOR
--    회비 룰이 아무리 복잡해도 결국 여기에 구체 행으로 떨어진다(§7 부과 생성층).
-- ============================================================
create table if not exists public.dues_charges (
	id          bigserial primary key,
	kind        text not null check (kind in ('monthly_fee','court_fee')),
	member_id   uuid not null references public.members(id) on delete cascade,
	period_ym   text,                                                        -- kind='monthly_fee' ('YYYY-MM' KST)
	session_id  bigint references public.sessions(id) on delete cascade,      -- kind='court_fee'
	amount_due  integer not null,                                             -- 정책 스냅샷(5000/6000/장소별)
	amount_paid integer not null default 0,                                   -- 배분 합계 캐시(트리거 유지)
	status      text not null default 'unpaid'
		check (status in ('unpaid','partial','paid','overpaid','waived','void')),
	payer_hint  uuid references public.members(id) on delete set null,        -- 게스트 대관비 → invited_by
	created_at  timestamptz not null default now(),
	updated_at  timestamptz not null default now(),
	constraint dues_charge_period_xor
		check ((period_ym is not null)::int + (session_id is not null)::int = 1)
);
-- 멱등: 회원×월 / 회원×세션 각각 1행. 부분 유니크 인덱스이므로 on conflict 시 동일 predicate 명시 필요.
create unique index if not exists uq_charge_month
	on public.dues_charges(member_id, period_ym)  where period_ym is not null;
create unique index if not exists uq_charge_session
	on public.dues_charges(member_id, session_id) where session_id is not null;
create index if not exists idx_charge_period  on public.dues_charges(period_ym);
create index if not exists idx_charge_session on public.dues_charges(session_id);
create index if not exists idx_charge_status  on public.dues_charges(status);
create index if not exists idx_charge_payer   on public.dues_charges(payer_hint);

-- ============================================================
-- ⑥ dues_allocations : 입금↔부과 배분 라인 (카운터 아님, 가역 레코드)
--    취소/재매칭 안전 — 메모리 교훈 "커밋된 취소는 자동롤백 불가" 차단.
-- ============================================================
create table if not exists public.dues_allocations (
	id          bigserial primary key,
	bank_tx_id  bigint references public.bank_transactions(id) on delete cascade,  -- 현금납부는 NULL
	charge_id   bigint references public.dues_charges(id) on delete cascade,       -- 선납 크레딧은 NULL. 회원/세션 삭제 시 charge 캐스케이드와 함께 정리(restrict면 delete_member·세션삭제 abort)
	member_id   uuid not null references public.members(id) on delete cascade,      -- 실제 납부 주체(대납 시 입금자). 회원 하드삭제(delete_my_account/delete_member)와 정합
	amount      integer not null check (amount > 0),
	kind        text not null default 'payment' check (kind in ('payment','credit','refund')),
	matched_by  uuid references public.members(id) on delete set null,             -- 확정한 관리자
	note        text,
	created_at  timestamptz not null default now()
);
create index if not exists idx_alloc_charge on public.dues_allocations(charge_id);
create index if not exists idx_alloc_tx     on public.dues_allocations(bank_tx_id);
create index if not exists idx_alloc_member on public.dues_allocations(member_id);

-- ============================================================
-- ⑦ member_name_aliases : 입금자명↔회원 학습(배우자/타인 명의·닉네임) §8.3
-- ============================================================
create table if not exists public.member_name_aliases (
	id             bigserial primary key,
	member_id      uuid not null references public.members(id) on delete cascade,
	alias_norm     text not null,                                                  -- 정규화된 입금자명
	source         text not null default 'manual' check (source in ('manual','learned')),
	created_by_txn bigint references public.bank_transactions(id) on delete set null, -- 자동학습분 회수 기준
	created_at     timestamptz not null default now(),
	unique (alias_norm, member_id)
);
create index if not exists idx_alias_norm on public.member_name_aliases(alias_norm);

-- ============================================================
-- ⑧ dues_match_queue : 미매칭/보류 큐 (사유 + 후보) §8.1 S6
-- ============================================================
create table if not exists public.dues_match_queue (
	id         bigserial primary key,
	bank_tx_id bigint not null unique references public.bank_transactions(id) on delete cascade,
	reason     text not null,                                                     -- 'homonym'|'amount_mismatch'|'no_candidate'|...
	candidates jsonb,                                                             -- [{member_id, confidence, ...}]
	resolved   boolean not null default false,
	created_at timestamptz not null default now()
);

-- ============================================================
-- ⑨ dues_audit_log : append-only 감사 로그 (§11)
-- ============================================================
create table if not exists public.dues_audit_log (
	id              bigserial primary key,
	actor_member_id uuid references public.members(id) on delete set null,
	action          text not null,                                                -- 'generate_charges'|'confirm_match'|'cancel_match'|'manual_payment'|...
	bank_tx_id      bigint references public.bank_transactions(id) on delete set null,
	charge_id       bigint references public.dues_charges(id) on delete set null,
	detail          jsonb,
	created_at      timestamptz not null default now()
);
create index if not exists idx_audit_created on public.dues_audit_log(created_at);

-- ============================================================
-- ⑩ 트리거 : 배분 무결성(§6.2 불변식 ①②③)
-- ============================================================

-- ① 한 거래의 배분 합 ≤ 거래 금액 (BEFORE INSERT/UPDATE, bank_tx_id 있을 때만)
create or replace function public.dues_alloc_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
	v_sum   int;
	v_txamt int;
begin
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

drop trigger if exists trg_dues_alloc_guard on public.dues_allocations;
create trigger trg_dues_alloc_guard
	before insert or update on public.dues_allocations
	for each row execute function public.dues_alloc_guard();

-- ②③ charge.amount_paid/status 재계산 + bank_transactions.status 갱신 (AFTER INSERT/UPDATE/DELETE)
create or replace function public.dues_alloc_sync()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
	v_charge_ids bigint[];
	v_tx_ids     bigint[];
	v_cid        bigint;
	v_tid        bigint;
	v_paid       int;
	v_due        int;
	v_status     text;
	v_alloc      int;
	v_txamt      int;
begin
	v_charge_ids := array_remove(array[
		case when TG_OP <> 'INSERT' then OLD.charge_id end,
		case when TG_OP <> 'DELETE' then NEW.charge_id end
	], null);
	v_tx_ids := array_remove(array[
		case when TG_OP <> 'INSERT' then OLD.bank_tx_id end,
		case when TG_OP <> 'DELETE' then NEW.bank_tx_id end
	], null);

	foreach v_cid in array v_charge_ids loop
		select coalesce(sum(amount), 0) into v_paid
			from public.dues_allocations where charge_id = v_cid;
		select amount_due, status into v_due, v_status
			from public.dues_charges where id = v_cid;
		-- waived/void는 수동 상태 → 트리거가 덮어쓰지 않음.
		if v_status not in ('waived', 'void') then
			v_status := case
				when v_paid = 0        then 'unpaid'
				when v_paid < v_due    then 'partial'
				when v_paid = v_due    then 'paid'
				else                        'overpaid'
			end;
		end if;
		update public.dues_charges
			set amount_paid = v_paid, status = v_status, updated_at = now()
			where id = v_cid;
	end loop;

	foreach v_tid in array v_tx_ids loop
		select coalesce(sum(amount), 0) into v_alloc
			from public.dues_allocations where bank_tx_id = v_tid;
		select amount into v_txamt from public.bank_transactions where id = v_tid;
		update public.bank_transactions
			set status = case
				when status = 'ignored'    then 'ignored'          -- 수동 무시 유지
				when v_alloc = 0           then 'unmatched'
				when v_alloc < v_txamt     then 'partial'
				else                            'matched'
			end
			where id = v_tid;
	end loop;

	return null;
end $$;

drop trigger if exists trg_dues_alloc_sync on public.dues_allocations;
create trigger trg_dues_alloc_sync
	after insert or update or delete on public.dues_allocations
	for each row execute function public.dues_alloc_sync();

-- ============================================================
-- ⑪ RLS (§11)
-- ============================================================

-- 관리자 전용(SELECT+ALL 모두 is_admin): 단일 FOR ALL 정책 → 비관리자는 어떤 접근도 불가.
--   쓰기는 대부분 SECURITY DEFINER RPC(=postgres 소유 → RLS 우회) 경유. 관리자 직접 편집 허용은
--   설정/분류 테이블에 유용(dues_settings, expense_categories).
alter table public.dues_settings       enable row level security;
alter table public.raw_bank_emails      enable row level security;
alter table public.bank_transactions    enable row level security;
alter table public.member_name_aliases  enable row level security;
alter table public.dues_match_queue     enable row level security;
alter table public.expense_categories   enable row level security;
alter table public.dues_audit_log       enable row level security;

drop policy if exists dues_settings_admin_all on public.dues_settings;
create policy dues_settings_admin_all on public.dues_settings
	for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists raw_bank_emails_admin_all on public.raw_bank_emails;
create policy raw_bank_emails_admin_all on public.raw_bank_emails
	for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists bank_transactions_admin_all on public.bank_transactions;
create policy bank_transactions_admin_all on public.bank_transactions
	for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists member_name_aliases_admin_all on public.member_name_aliases;
create policy member_name_aliases_admin_all on public.member_name_aliases
	for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists dues_match_queue_admin_all on public.dues_match_queue;
create policy dues_match_queue_admin_all on public.dues_match_queue
	for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists expense_categories_admin_all on public.expense_categories;
create policy expense_categories_admin_all on public.expense_categories
	for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 감사로그는 append-only: 관리자 SELECT만. INSERT는 RPC(정의자 우회), UPDATE/DELETE 정책 없음 → 불변.
drop policy if exists dues_audit_log_admin_select on public.dues_audit_log;
create policy dues_audit_log_admin_select on public.dues_audit_log
	for select to authenticated using (public.is_admin());

-- 회원 본인 열람 예외: dues_charges — 관리자 or 본인(부과 대상) or 대납 후보(게스트 초대자).
alter table public.dues_charges enable row level security;
drop policy if exists dues_charges_select on public.dues_charges;
create policy dues_charges_select on public.dues_charges
	for select to authenticated using (
		public.is_admin()
		or member_id = public.current_member_id()
		or payer_hint = public.current_member_id()
	);

-- 회원 본인 열람 예외: dues_allocations — 관리자 or 본인(납부 주체).
alter table public.dues_allocations enable row level security;
drop policy if exists dues_allocations_select on public.dues_allocations;
create policy dues_allocations_select on public.dues_allocations
	for select to authenticated using (
		public.is_admin() or member_id = public.current_member_id()
	);

-- ============================================================
-- ⑫ 회원용 클럽 계좌(마스킹) RPC — /my-dues 안내용. 원문은 관리자만(dues_settings RLS).
-- ============================================================
create or replace function public.dues_club_account()
returns jsonb language sql stable security definer set search_path = ''
as $$
	select case when public.current_member_id() is null then null
		else jsonb_build_object(
			'bank_name',      s.bank_name,
			'account_masked', public.mask_account(s.bank_account),
			'account_holder', s.account_holder,
			'monthly_fee',    s.monthly_fee
		) end
	from public.dues_settings s where s.id = 1
$$;
revoke execute on function public.dues_club_account() from public;   -- 암묵적 PUBLIC EXECUTE 제거 후 재부여
grant execute on function public.dues_club_account() to authenticated;
