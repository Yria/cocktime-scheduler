-- ============================================================
-- 대관 총액 0 = "이 회차는 안 걷는다" (2026-08-23 운영 결정)
--
-- 실제 사고: 세션 228(8/22 토 09:00 TK배드민턴아레나 정모)에서 운영진이 대관 총액을 **0원**으로
--   넣었는데, 세션 종료 트리거가 **정액 6,000원 × 18명 = 108,000원**을 부과했다.
--   원인은 `v_split := (v_total is not null and v_total > 0)` — **0 과 NULL(미입력)이 같은 분기**라
--   0 을 "총액 없음"으로 읽고 정액 모드로 떨어졌다. 정액은 운영진을 제외하므로
--   확정 24명 − 운영진 6명 = 18명이 부과됐다(부과 대상 집합까지 정확히 일치, 실측 확인).
--   전액 미납(amount_paid=0, 배분 0건)이라 통장·배분에는 영향이 없었다.
--
-- 결정: **NULL 과 0 을 갈라놓는다.**
--   · NULL(미입력) = 종전 그대로 **정액**(`dues_settings.court_fee_default`, 운영진 제외).
--     → 토·일 정기 세션이 지금까지 쓰던 경로. 동작 불변.
--   · 0 이하        = **회원 부과 없음**. 무료 대관·후원·회비 충당처럼 "안 걷기로 한 회차"를
--     회차 단위로 표현할 수단이 지금까지 없었다(무부과 게이트는 `places.charges_court_fee`
--     장소 단위뿐). 이 값이 그 수단이 된다.
--   · 0 초과        = 종전 그대로 **엔빵**(총액 ÷ 대상, 10원 절상 + 정액 근처 스냅, 운영진 포함).
--
--   음수도 "안 걷음"으로 묶는다(`<= 0`). 음수는 애초에 들어와선 안 되는 값인데, 그걸 정액으로
--   흘리면 오타(-6000 → 6,000원 부과)가 그럴싸한 결과로 숨는다. 0건 부과는 즉시 눈에 띈다.
--
-- 적용 범위 확인(실측 2026-08-23): `sessions.court_fee <= 0` 은 **228 하나뿐**이고
--   `recurring_schedules.court_fee` 는 8개 규칙 전부 NULL 이다. → 이 변경으로 값이 달라지는
--   기존 부과는 아래 ③ 의 세션 228 뿐이며, 다른 시리즈가 조용히 무부과로 바뀌는 일은 없다.
--
-- 미포함(별건): 종료된 회차의 총액을 나중에 고쳐도 부과는 재계산되지 않는다.
--   회차 에디터가 `sessions` 를 직접 PATCH 하고 `dues_set_session_fee` RPC 를 타지 않으며,
--   재계산 트리거는 `after update of status ... when new.status='closed'` 뿐이다.
--   이 마이그레이션은 그 경로를 건드리지 않는다(총액 확정 후 재부과가 필요해지면 그때 별도로).
-- ============================================================

-- ① 부과 생성기 — 0 이하 분기 추가. 나머지 본문은 20260818000000 정의 그대로.
create or replace function public.dues_generate_session_court(p_session_id bigint)
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_court int;          -- 정액 기본(6천). 스냅 기준점 겸용
  v_total int;          -- 엔빵 총액 = coalesce(세션, 규칙). NULL=정액, <=0=무부과, >0=엔빵
  v_n int := 0;
  v_eligible boolean;
  v_head int;           -- 엔빵 분모 = 부과 대상 수
  v_per int;            -- 엔빵 1인당(10원 절상 + 정액 근처 스냅)
  v_split boolean;      -- 엔빵 모드
  v_target_ids uuid[];  -- 정리 DELETE 가 쓸 대상 명단(함수 재호출 O(n²) 회피)
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
    -- 무자격 세션의 미납 전삭제. 단 void(부과삭제)는 감사·면제 보존 위해 제외.
    delete from public.dues_charges
    where kind = 'court_fee' and session_id = p_session_id and amount_paid = 0
      and status <> 'void';
    return 0;
  end if;

  -- 총액 0 이하 = "이 회차는 안 걷는다"(무료 대관·후원·회비 충당). NULL(미입력=정액)과 명시적으로 갈린다.
  -- 무자격 분기와 같은 정리 규칙: 미납만 지우고 선납(amount_paid>0)·void 는 보존한다.
  if v_total <= 0 then
    delete from public.dues_charges
    where kind = 'court_fee' and session_id = p_session_id and amount_paid = 0
      and status <> 'void';
    return 0;
  end if;

  v_split := (v_total is not null and v_total > 0);

  if v_split then
    -- 분모 = 부과 대상 수. 대상 집합과 **같은 함수**에서 나오므로 인당×인원이 총액과 어긋나지 않는다.
    select count(*) into v_head from public.dues_court_targets(p_session_id, true);
    if v_head = 0 then
      delete from public.dues_charges where kind = 'court_fee' and session_id = p_session_id and amount_paid = 0
        and status <> 'void';
      return 0;
    end if;
    v_per := ceil(v_total::numeric / v_head / 10)::int * 10;      -- 10원 절상
    if v_per >= v_court and v_per < v_court + 200 then            -- 정액 근처면 정액으로(한방향)
      v_per := v_court;
    end if;
  end if;

  insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint, is_day_cancel)
  select 'court_fee', t.member_id, p_session_id,
         case when v_split then v_per else v_court end,
         t.payer_hint,
         t.is_day_cancel
  from public.dues_court_targets(p_session_id, v_split) t
  on conflict (member_id, session_id) where session_id is not null
  do update set amount_due = excluded.amount_due,
                is_day_cancel = excluded.is_day_cancel,
                updated_at = now()
  where public.dues_charges.amount_paid = 0;
  get diagnostics v_n = row_count;

  -- 부과 대상 아닌 회원의 미납 정리(선납 amount_paid>0 보존).
  --  무자격/사전취소 유령 + 엔빵→정액 전환 운영진 고아 + grace 이내 철회분.
  --  단, 운영진이 무효(void)한 건은 감사·면제 보존을 위해 자동정리에서 제외한다.
  select coalesce(array_agg(t.member_id), '{}'::uuid[]) into v_target_ids
  from public.dues_court_targets(p_session_id, v_split) t;

  delete from public.dues_charges dc
  where dc.kind = 'court_fee' and dc.session_id = p_session_id and dc.amount_paid = 0
    and dc.status <> 'void'
    and not (dc.member_id = any(v_target_ids));

  return v_n;
end $function$;

revoke execute on function public.dues_generate_session_court(bigint) from public, anon, authenticated;

comment on function public.dues_generate_session_court(bigint) is
  '세션 대관비 부과 생성(멱등). 총액 = coalesce(sessions.court_fee, recurring_schedules.court_fee): '
  'NULL=정액(court_fee_default, 운영진 제외) / 0 이하=부과 없음(안 걷는 회차) / 0 초과=엔빵(총액÷대상, '
  '10원 절상 + 정액 근처 스냅, 운영진 포함). 대상은 dues_court_targets 단일 소스. 2026-08-23.';

-- ② 0 의 의미를 컬럼 주석에도 명문화(다음 사람이 코드를 읽지 않아도 알 수 있게).
comment on column public.sessions.court_fee is
  '이 회차 대관 총액(원). NULL=미입력(규칙 값 → 없으면 정액 6천) / 0=이 회차는 회원에게 안 걷음 / >0=엔빵 총액. 2026-08-23.';
comment on column public.recurring_schedules.court_fee is
  '엔빵 대관비 기본 총액(원). 이 규칙 회차의 sessions.court_fee 미입력 시 부과 기준(coalesce). '
  'NULL=정액 6천 / 0=이 규칙 회차는 안 걷음 / >0=엔빵. 2026-08-23.';

-- ③ 잘못 나간 부과 정정 — 지우기 전에 감사 기록부터.
--    대상: court_fee <= 0 인 세션의 court_fee 부과(= 현재 세션 228 의 18건 × 6,000 = 108,000원).
insert into public.dues_audit_log (actor_member_id, action, detail)
select null,
       'court_zero_no_charge_fix',
       jsonb_build_object(
         'why', '대관 총액 0 을 정액 6,000 으로 읽어 잘못 부과된 건 정리(0=안 걷음 으로 의미 분리). 전액 미납이라 배분·통장 영향 없음.',
         'sessions', (select jsonb_agg(jsonb_build_object('id', s.id, 'scheduled_at', s.scheduled_at, 'court_fee', s.court_fee))
                        from public.sessions s where s.court_fee <= 0),
         'removed_charges', (select jsonb_agg(jsonb_build_object(
                                      'charge', dc.id, 'member', dc.member_id, 'session', dc.session_id,
                                      'due', dc.amount_due, 'paid', dc.amount_paid, 'status', dc.status))
                               from public.dues_charges dc
                               join public.sessions s on s.id = dc.session_id
                              where dc.kind = 'court_fee' and s.court_fee <= 0)
       )
where exists (
  select 1 from public.dues_charges dc
  join public.sessions s on s.id = dc.session_id
  where dc.kind = 'court_fee' and s.court_fee <= 0
);

-- 재실행 = 위 ① 의 새 분기가 미납분을 정리한다(별도 DELETE 문 없이 같은 규칙 하나로).
do $$
declare r record; v_n int;
begin
  for r in select id from public.sessions where court_fee <= 0 order by id loop
    v_n := public.dues_generate_session_court(r.id);
    raise notice 'court_fee<=0 session % → 부과 %건 (남은 court_fee 부과: %)',
      r.id, v_n,
      (select count(*) from public.dues_charges where kind = 'court_fee' and session_id = r.id);
  end loop;
end $$;
