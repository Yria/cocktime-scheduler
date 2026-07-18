-- ============================================================
-- 대관비 개편: 평일 엔빵(총액÷인원) + 대관장소 게이트 boolean 화
--
-- 배경/결정(회계 §5 갱신):
--  · 회원 대관비 = 지금까지 "인당 6,000 정액". 앞으로 **세션에 대관 총액이 있으면 엔빵**
--    (총액 ÷ 참석 인원, 10원 버림, 운영진 포함), **없으면 정액 6,000(운영진 제외, 현행)**.
--    → 토·일은 총액 없이 6천, 평일은 총액 입력해 엔빵으로 자연히 갈린다.
--  · 엔빵 총액 = coalesce(sessions.court_fee, recurring_schedules.court_fee):
--    규칙에 넣은 기본 총액(일정 생성 시)을 회차가 물려받고, 회차에서 실제 총액을 넣으면 그게 우선.
--    (sync/뷰 무수정 — 부과 시점에 규칙을 조인해 읽음.)
--  · 대관장소 게이트: 기존엔 places.court_fee_per_hour(시간당 요금)의 null 여부로 "대관 세션인가"를
--    판정했는데, 그 숫자값은 죽은 값(안 그려지는 suggested 계산에만 사용)이라 **boolean
--    places.charges_court_fee 로 대체**한다. court_fee_per_hour 를 최신 정의에서 참조하는 함수는
--    dues_generate_session_court 뿐(아래 재정의). dues_public_ledger 최신본은 dues_charges 기반,
--    generate_dues_charges 는 게이트를 위임 → 무영향.
--  · court_fee_per_hour **컬럼 drop 은 후속 마이그레이션**(클라가 아직 참조 → 클라 배포 후 제거).
--    이번엔 charges_court_fee 신설 + 함수 전환까지(expand). 컬럼은 잔존(dead).
-- ============================================================

-- ① 대관장소 게이트 boolean (court_fee_per_hour null-check 역할 승계)
alter table public.places add column if not exists charges_court_fee boolean not null default false;
update public.places set charges_court_fee = true where court_fee_per_hour is not null;
comment on column public.places.charges_court_fee is
  '이 장소 세션이 대관비 부과 대상인가(대관장소). 기존 court_fee_per_hour(null 여부) 게이트 승계. 2026-07.';

-- ①-b 전환 창 브리지: 배포 순서와 무관하게 게이트 일관 유지.
--   구 클라는 court_fee_per_hour 만 write(charges_court_fee 미설정→default false), 신 클라는 charges_court_fee 를 write.
--   컬럼 drop(후속) 전까지 두 쓰기 경로가 공존하므로, court_fee_per_hour 가 이번 write 로 바뀌면 그걸 따르고
--   (구 클라 on/off), 아니면 charges_court_fee 를 존중(신 클라)한다. → 구 클라로 대관장소를 만들거나 요금을
--   켜/꺼도 게이트가 조용히 어긋나지 않음(미부과·미납삭제 방지). 후속 drop 마이그레이션에서 이 트리거도 제거.
create or replace function public.places_sync_charges_gate()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.charges_court_fee := new.charges_court_fee or (new.court_fee_per_hour is not null);
  elsif new.court_fee_per_hour is distinct from old.court_fee_per_hour then
    new.charges_court_fee := (new.court_fee_per_hour is not null);
  end if;
  return new;
end $$;
drop trigger if exists trg_places_sync_charges_gate on public.places;
create trigger trg_places_sync_charges_gate
  before insert or update on public.places
  for each row execute function public.places_sync_charges_gate();

-- ② 반복 규칙 엔빵 총액 기본값(일정 생성 시 입력). NULL=총액 없음(→정액 6천/게이트에 따라).
alter table public.recurring_schedules add column if not exists court_fee integer;
comment on column public.recurring_schedules.court_fee is
  '엔빵 대관비 기본 총액(원). 이 규칙 회차의 sessions.court_fee 미입력 시 부과 기준(coalesce). NULL=정액 6천. 2026-07.';

-- ③ 대관비 부과 생성 — 게이트=charges_court_fee, 총액 있으면 엔빵(coalesce 세션/규칙), 없으면 6천.
create or replace function public.dues_generate_session_court(p_session_id bigint)
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_court int;      -- 정액 기본(6천)
  v_total int;      -- 엔빵 총액 = coalesce(세션, 규칙)
  v_n int := 0;
  v_eligible boolean;
  v_head int;       -- 엔빵 분모(참석 인원, 운영진 포함)
  v_per int;        -- 엔빵 1인당(10원 버림)
  v_split boolean;  -- 엔빵 모드
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

  if v_eligible is not true then
    -- 무자격(무산·비대관장소 등) → 미납 대관비 항목만 정리(납부분 보존)
    delete from public.dues_charges
    where kind = 'court_fee' and session_id = p_session_id and amount_paid = 0;
    return 0;
  end if;

  v_split := (v_total is not null and v_total > 0);
  if v_split then
    select count(*) into v_head
    from public.attendances a
    join public.sessions s on s.id = a.session_id
    where a.session_id = p_session_id
      and ( a.status in ('confirmed', 'late_pool')
         or ( a.status = 'cancelled' and a.confirmed_at is not null
              and (a.cancelled_at at time zone 'Asia/Seoul')::date
                = (s.scheduled_at at time zone 'Asia/Seoul')::date ) );
    if v_head = 0 then
      delete from public.dues_charges where kind = 'court_fee' and session_id = p_session_id and amount_paid = 0;
      return 0;
    end if;
    v_per := ((v_total / v_head) / 10) * 10;  -- 10원 버림(엔빵)
  end if;

  insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint)
  select 'court_fee', a.member_id, p_session_id,
         case when v_split then v_per else v_court end,
         case when mm.is_guest then a.invited_by else null end
  from public.attendances a
  join public.members mm on mm.id = a.member_id
  join public.sessions s on s.id = a.session_id
  where a.session_id = p_session_id
    and ( v_split or not public.is_operator(a.member_id) )   -- 엔빵=운영진 포함, 정액=운영진 제외
    and (
          a.status in ('confirmed', 'late_pool')
       or ( a.status = 'cancelled'
            and a.confirmed_at is not null
            and (a.cancelled_at at time zone 'Asia/Seoul')::date
              = (s.scheduled_at at time zone 'Asia/Seoul')::date )
        )
  on conflict (member_id, session_id) where session_id is not null
  do update set amount_due = excluded.amount_due, updated_at = now()
  where public.dues_charges.amount_paid = 0;
  get diagnostics v_n = row_count;

  -- 부과 대상에서 빠진 회원의 미납 대관비 정리(납부분 amount_paid>0 은 보존).
  --  이번 부과 필터(v_split ? 전원 : 운영진 제외 + 확정/당일취소)에 속하지 않는 미납 court_fee 를 삭제.
  --  → 이전 self-heal(사전취소 유령)에 더해, 엔빵→정액 전환으로 제외된 운영진의 옛 엔빵 미납 고아까지 정리.
  delete from public.dues_charges dc
  where dc.kind = 'court_fee' and dc.session_id = p_session_id and dc.amount_paid = 0
    and not exists (
      select 1
      from public.attendances a
      join public.sessions s on s.id = a.session_id
      where a.session_id = p_session_id
        and a.member_id = dc.member_id
        and ( v_split or not public.is_operator(a.member_id) )
        and (
              a.status in ('confirmed', 'late_pool')
           or ( a.status = 'cancelled'
                and a.confirmed_at is not null
                and (a.cancelled_at at time zone 'Asia/Seoul')::date
                  = (s.scheduled_at at time zone 'Asia/Seoul')::date )
            )
    );

  return v_n;
end $function$;
revoke execute on function public.dues_generate_session_court(bigint) from public, anon, authenticated;

-- ④ 세션 실제 총액 입력 시 대관비(엔빵) 재생성 — 회차 총액 변경이 청구에 즉시 반영(자격 세션만, open/미자격은 no-op).
create or replace function public.dues_set_session_fee(p_session_id bigint, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.current_member_id();
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_amount is not null and p_amount < 0 then raise exception 'invalid amount'; end if;
  update public.sessions set court_fee = p_amount where id = p_session_id;
  if not found then raise exception 'session % not found', p_session_id; end if;
  perform public.dues_generate_session_court(p_session_id);  -- 엔빵 반영(자격 세션만)
  insert into public.dues_audit_log (actor_member_id, action, detail)
  values (v_admin, 'set_session_fee',
          jsonb_build_object('session_id', p_session_id, 'amount', p_amount));
  return jsonb_build_object('session_id', p_session_id, 'court_fee', p_amount);
end $$;

-- ⑤ (후속) 클라가 charges_court_fee 로 전환·배포된 뒤 별도 마이그레이션에서
--   court_fee_per_hour 컬럼 + 브리지(trg_places_sync_charges_gate·places_sync_charges_gate) 를 함께 drop.
