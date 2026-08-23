-- ============================================================
-- 묶음(영수증) 통합 — expand 단계 (2026-08-23)
--
-- 부과의 묶음 축이 셋으로 갈려 있었다: `period_ym`(회비) / `session_id`(대관비) / `batch_key`(수동).
-- 그래서 XOR 제약 하나, 부분 유니크 셋, 그리고 kind 로 분기하는 코드가 읽기 경로마다 복제됐다.
-- **"모든 돈은 묶음에 속한다. 묶음은 세 가지 — 월(회비)·세션(대관)·배치(그 외)"** 로 합친다.
--
-- 이 마이그레이션은 **expand 만** 한다:
--   · `dues_batches` 신설 + `dues_charges.batch_id` 추가 + 백필
--   · 기존 3축 컬럼은 **그대로 둔다** → 모든 읽기 경로가 무영향(동작 변화 0)
--   · contract(읽기 전환 → 3축 컬럼 제거)는 후속. 그전까지 두 표현이 공존한다
--
-- 핵심 트릭: **BEFORE INSERT 트리거가 묶음을 만들고 batch_id 를 채운다.**
--   그래서 부과를 만드는 코드(생성기 2개·dues_confirm_reconcile·dues_issue_drafts·
--   dues_upsert_manual_batch·과거 보정 마이그레이션)를 **한 줄도 고치지 않는다.**
--   새 부과가 어디서 들어와도 묶음이 붙는다 — 나중에 "묶음 없는 부과"를 찾아 헤맬 일이 없다.
--
-- 묶음 키(`key`)는 발행 대기 초안의 `draft_group` 과 **같은 이름공간**이다:
--   'monthly:2026-08' · 'court:228' · 'manual:meal:228'
--   초안 그룹이 곧 미래의 묶음 키라서, 대기 → 발행 흐름에서 이름이 이어진다.
-- ============================================================

-- ① 묶음 = 영수증. 세션이 대관비에 대해 하던 역할(부과 묶음 + 지출 연결 + 손익 단위)을 일반화한다.
create table if not exists public.dues_batches (
	id          bigserial primary key,
	kind        text not null check (kind in ('monthly','court','manual')),
	/** 'monthly:2026-08' | 'court:228' | 'manual:meal:228' — 초안 draft_group 과 같은 이름공간 */
	key         text not null unique,
	label       text not null,
	/** 월 귀속 기준일. 즉석 세션(scheduled_at null)처럼 날짜가 없을 수 있어 nullable. */
	occurred_on date,
	/** court 묶음의 세션(세션별 손익·조인용). 다른 종류는 null. */
	session_id  bigint references public.sessions(id) on delete cascade,
	/** monthly 묶음의 달. 다른 종류는 null. */
	period_ym   text,
	created_at  timestamptz not null default now()
);
create index if not exists idx_batch_occurred on public.dues_batches(occurred_on);
create index if not exists idx_batch_session on public.dues_batches(session_id);

comment on table public.dues_batches is
	'부과 묶음(영수증). 월(회비)·세션(대관)·배치(그 외) 세 종류가 같은 모양을 갖는다. '
	'키는 발행 대기 초안 draft_group 과 같은 이름공간. 2026-08-23 expand — 기존 3축 컬럼과 공존한다.';

alter table public.dues_batches enable row level security;
-- 부과 자체가 로그인 회원에게 열려 있고(회비/대관 현황 공유), 묶음은 그 메타데이터라 같은 수준으로 둔다.
drop policy if exists batches_select on public.dues_batches;
create policy batches_select on public.dues_batches
	for select to authenticated using (true);

-- ② 부과 → 묶음
alter table public.dues_charges add column if not exists batch_id bigint references public.dues_batches(id);
create index if not exists idx_charge_batch_id on public.dues_charges(batch_id);

comment on column public.dues_charges.batch_id is
	'속한 묶음(dues_batches). BEFORE INSERT 트리거가 자동으로 채운다 — 부과를 만드는 코드는 이 컬럼을 '
	'몰라도 된다. 2026-08-23. contract 단계에서 period_ym/session_id/batch_key 를 대체할 축.';

-- ③ 묶음 자동 생성·연결 트리거. 기존 3축에서 묶음 정체를 유도한다(그래서 호출부 수정이 0).
create or replace function public.dues_charge_attach_batch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
	v_kind text; v_key text; v_label text; v_on date; v_id bigint;
begin
	if new.batch_id is not null then return new; end if;

	if new.period_ym is not null then
		v_kind := 'monthly';
		v_key  := 'monthly:' || new.period_ym;
		v_label := ltrim(substr(new.period_ym, 6, 2), '0') || '월 회비';
		v_on   := (new.period_ym || '-01')::date;
	elsif new.session_id is not null then
		v_kind := 'court';
		v_key  := 'court:' || new.session_id::text;
		select coalesce(
		         to_char((s.scheduled_at at time zone 'Asia/Seoul')::date, 'MM/DD') || ' '
		           || coalesce(p.name, '대관') || ' 대관비',
		         coalesce(s.title, '세션 ' || s.id::text) || ' 대관비'),
		       (s.scheduled_at at time zone 'Asia/Seoul')::date
		  into v_label, v_on
		  from public.sessions s
		  left join public.places p on p.id = s.place_id
		 where s.id = new.session_id;
		v_label := coalesce(v_label, '세션 ' || new.session_id::text || ' 대관비');
	elsif new.batch_key is not null then
		v_kind := 'manual';
		v_key  := 'manual:' || new.batch_key;
		v_label := coalesce(new.label, new.batch_key);
		v_on   := new.charged_on;
	else
		-- dues_charge_period_xor 가 막는 경로. 방어적으로 남긴다(묶음 없이 통과시키지 않는다).
		raise exception 'charge has no batch axis (member %, kind %)', new.member_id, new.kind;
	end if;

	insert into public.dues_batches (kind, key, label, occurred_on, session_id, period_ym)
	values (v_kind, v_key, v_label, v_on,
	        case when v_kind = 'court' then new.session_id end,
	        case when v_kind = 'monthly' then new.period_ym end)
	on conflict (key) do nothing
	returning id into v_id;

	-- 이미 있던 묶음이면 RETURNING 이 비므로 조회한다(대량 INSERT 에서 대부분 이 경로).
	if v_id is null then
		select id into v_id from public.dues_batches where key = v_key;
	end if;

	new.batch_id := v_id;
	return new;
end $function$;

drop trigger if exists trg_charge_attach_batch on public.dues_charges;
create trigger trg_charge_attach_batch
	before insert on public.dues_charges
	for each row execute function public.dues_charge_attach_batch();

-- ④ 수동 부과 이름을 바꾸면 묶음 라벨도 따라간다(dues_upsert_manual_batch 는 기존 행을 UPDATE 한다).
create or replace function public.dues_charge_sync_batch_label()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
	if new.batch_id is not null and new.label is not null then
		update public.dues_batches
		   set label = new.label,
		       occurred_on = coalesce(new.charged_on, occurred_on)
		 where id = new.batch_id and label is distinct from new.label;
	end if;
	return new;
end $function$;

drop trigger if exists trg_charge_sync_batch_label on public.dues_charges;
create trigger trg_charge_sync_batch_label
	after update of label on public.dues_charges
	for each row execute function public.dues_charge_sync_batch_label();

-- ============================================================
-- ⑤ 백필 — 기존 3축에서 묶음을 만들고 연결한다.
--    실측(2026-08-23): 부과 372건 = 월 152 + 세션 203 + 배치 17, 묶음 15개(월 3·세션 11·배치 1).
--    엣지 0건(scheduled_at null 세션 없음, 고아 session_id 없음, label/charged_on 누락 없음).
-- ============================================================
insert into public.dues_batches (kind, key, label, occurred_on, period_ym)
select distinct 'monthly', 'monthly:' || c.period_ym,
       ltrim(substr(c.period_ym, 6, 2), '0') || '월 회비',
       (c.period_ym || '-01')::date, c.period_ym
  from public.dues_charges c where c.period_ym is not null
on conflict (key) do nothing;

insert into public.dues_batches (kind, key, label, occurred_on, session_id)
select distinct 'court', 'court:' || c.session_id::text,
       coalesce(
         to_char((s.scheduled_at at time zone 'Asia/Seoul')::date, 'MM/DD') || ' '
           || coalesce(p.name, '대관') || ' 대관비',
         coalesce(s.title, '세션 ' || s.id::text) || ' 대관비'),
       (s.scheduled_at at time zone 'Asia/Seoul')::date, c.session_id
  from public.dues_charges c
  join public.sessions s on s.id = c.session_id
  left join public.places p on p.id = s.place_id
 where c.session_id is not null
on conflict (key) do nothing;

insert into public.dues_batches (kind, key, label, occurred_on)
select 'manual', 'manual:' || c.batch_key, max(c.label), max(c.charged_on)
  from public.dues_charges c where c.batch_key is not null
 group by c.batch_key
on conflict (key) do nothing;

update public.dues_charges c
   set batch_id = b.id
  from public.dues_batches b
 where c.batch_id is null
   and b.key = case
     when c.period_ym  is not null then 'monthly:' || c.period_ym
     when c.session_id is not null then 'court:' || c.session_id::text
     when c.batch_key  is not null then 'manual:' || c.batch_key
   end;

-- ⑥ 불변식: **모든 부과는 묶음에 속한다.** 트리거가 BEFORE INSERT 에서 항상 채우므로 안전하다.
do $$
declare v_missing int;
begin
	select count(*) into v_missing from public.dues_charges where batch_id is null;
	if v_missing > 0 then
		raise exception '백필 미완: batch_id 가 없는 부과 %건', v_missing;
	end if;
	raise notice '묶음 %개 · 부과 %건 연결 완료',
		(select count(*) from public.dues_batches),
		(select count(*) from public.dues_charges);
end $$;

alter table public.dues_charges alter column batch_id set not null;
