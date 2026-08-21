-- 합류 컷오프일(join_cutoff_day): 실제 합류일이 그 달 N일(기본 21) 이후면 **그 달 회비는 미부과**.
--
-- 왜 필요한가 — 기존 룰엔 "실제로 언제 들어왔나"를 보는 눈이 없다.
--   부과 시작월은 `date_trunc(month, (membership_started_at ?? created_at@KST) + offset_days) + 1개월`
--   하나로만 정해진다. 이 식은 **신규 가입자**에겐 잘 맞지만(가입월은 통째로 유예), 다음 두 경로에서
--   "월말에 들어온 사람이 그 달 회비를 다 낸다"가 된다:
--
--   1) **재활성화 재가입.** 탈퇴=비활성(하드삭제는 20260819010000 에서 봉인), 재가입=재활성화다.
--      `created_at` 이 옛날 그대로라 재활성화 즉시 당월 부과 대상이 된다(MemberAdminPage.tsx 주석에도
--      그렇게 적혀 있다). 8/29 에 돌아온 사람이 8월 5,000원을 다 내는 건 과하다.
--   2) **가입월 소급 보정.** 기존회원이 계정을 새로 만들면 운영진이 `membership_started_at` 을 과거로
--      내려 신규 유예를 없앤다(20260713130000 의 6월 백필과 같은 손질). 그러면 계정 생성이 8/21 이어도
--      8월이 부과 대상이 된다. 실제 선례가 있다 — 전창우·김영주(7/21 생성)·박병훈(7/27 생성)은
--      membership_started_at=2026-06-01 보정 뒤 7월 회비가 붙었다.
--
-- 무엇을 바꾸는가 — **하한(floor)만 추가한다. 부과가 늘어나는 방향으로는 손대지 않는다.**
--   기존 시작월 식은 그대로 두고, 그 위에 "합류월엔 컷오프 이후 합류면 미부과" 조건을 AND 로 얹는다.
--   그래서 신규 가입자의 부과는 한 건도 늘거나 줄지 않는다(어차피 가입월은 유예라 하한이 물릴 자리가 없다).
--   달라지는 건 위 1)·2) 두 경우의 **합류월 딱 한 달**뿐이다.
--
--     신규가입 8/05 → 첫 부과 9월 (변화 없음)      재활성화 8/05 → 8월 부과   (변화 없음)
--     신규가입 8/21 → 첫 부과 9월 (변화 없음)      재활성화 8/21 → 8월 미부과 (변경)
--
-- 실제 합류일 = **max(계정 생성일, 마지막 재활성화일)** @KST.
--   `membership_started_at`(소급 보정값)은 일부러 보지 않는다 — 그 값은 "회비 이력을 언제부터로 칠까"라는
--   운영진의 판단이고, 하한은 "이 사람이 실제로 언제 들어왔나"라는 사실이라 소스가 달라야 한다.
--   재활성화일을 잡으려면 컬럼이 필요해 `members.rejoined_at` 을 새로 둔다(§2·§3).
--
-- 하지 않는 것
--   · **이미 생긴 부과는 지우지 않는다.** 이 마이그레이션은 함수 정의와 컬럼만 바꾼다. 위 3명의 7월분도
--     그대로 남는다(20260820000000 §2 와 같은 원칙 — 생성에서 빠지는 것과 이미 생긴 걸 지우는 건 다른 문제).
--   · **합류월보다 이전 달은 건드리지 않는다.** 과거 달을 재생성할 때 합류 전 달까지 막을지는 별개 문제라
--     범위를 합류월 한 달로 좁힌다.
--   · 입금 확인 경로(`dues_confirm_reconcile`)는 여전히 자격을 보지 않는다 — 돈이 들어오면 붙일 자리는
--     만들어야 한다(20260820000000 §3). 컷오프로 미부과된 달도 회원이 자진 납부하면 정산된다.
--
-- 알려진 틈(좁히지 못했다): 같은 달 안에서 비활성→재활성을 컷오프 이후에 하면 그 달 회비가 사라진다 —
--   정지 트리거가 미납분을 지우고(20260820020000) 재활성 스탬프가 재생성을 막는다.
--   **운영진 전용 조작이 아니다.** `members_update` RLS 가 `is_admin() OR auth_user_id = auth.uid()` 이고
--   authenticated 롤에 members UPDATE 테이블 권한이 있어, 로그인한 회원이면 누구나 PostgREST PATCH 두 번으로
--   자기 행의 `is_active` 를 토글할 수 있다. 앱 UI 에는 그 버튼이 없다(본인 탈퇴는 `delete_my_account` RPC 라
--   `auth_user_id` 까지 끊어 재로그인 자체가 불가능하다) — 직접 API 를 두드려야 성립하는 경로다.
--   회비를 지우는 것 자체는 20260820020000 이 낸 구멍이고, 이번 변경이 더하는 것은 **그 달에 한해 재생성으로
--   복구가 안 된다**는 점뿐이다(그 전에도 재생성은 SQL 에디터에서만 가능했다 — `generate_dues_charges` 는
--   authenticated 에 EXECUTE 가 없다, 20260817010000).
--   복구 절차: `update public.members set rejoined_at = null where id = ...` 후 그 달 재생성, 또는 감사 로그
--   `uncharge_dues_on_deactivate` 의 금액으로 `dues_charges` 행을 직접 INSERT.
--   근본 차단(회원의 self `is_active` 토글 금지)은 본인 탈퇴·게스트 행 재사용(20260819030000) 경로와 함께
--   봐야 해서 이 마이그레이션 범위 밖으로 둔다.

-- ── 1. 설정: dues_settings.join_cutoff_day ────────────────────────────
alter table public.dues_settings
	add column if not exists join_cutoff_day int not null default 21;

alter table public.dues_settings
	drop constraint if exists dues_settings_join_cutoff_day_check;
alter table public.dues_settings
	add constraint dues_settings_join_cutoff_day_check
	check (join_cutoff_day between 1 and 31);

comment on column public.dues_settings.join_cutoff_day is
	'합류 컷오프일(1~31, 기본 21). 실제 합류일(계정 생성 ↔ 마지막 재활성화 중 나중, KST)이 그 달 이 날짜 이후면 그 달 회비는 미부과. 부과 시작월 식(offset_days)에 얹히는 하한이라, 이 값을 키워도 신규 가입자 부과는 늘지 않는다.';

-- ── 2. members.rejoined_at ────────────────────────────────────────────
alter table public.members
	add column if not exists rejoined_at timestamptz;

comment on column public.members.rejoined_at is
	'마지막 재활성화(is_active false→true) 시각. 트리거가 찍는다. 회비 합류월 하한 계산에만 쓰며(dues_generate_monthly), NULL이면 계정 생성일이 곧 합류일. 소급 보정용 membership_started_at 과는 별개 — 이쪽은 사실, 저쪽은 판단.';

-- ── 3. 재활성화 스탬프 트리거 ──────────────────────────────────────────
-- 재활성화 경로가 클라이언트의 members 직접 UPDATE(`setMemberActive`, RLS members_update)라 RPC 게이트가
-- 없다. 비활성 트리거(20260820020000)와 같은 이유로 테이블에 붙인다. BEFORE 라 같은 UPDATE 한 번에 실린다.
create or replace function public.members_stamp_rejoined_on_activate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
	NEW.rejoined_at := now();
	return NEW;
end $function$;

revoke execute on function public.members_stamp_rejoined_on_activate() from public, anon, authenticated;

drop trigger if exists trg_members_stamp_rejoined_on_activate on public.members;
create trigger trg_members_stamp_rejoined_on_activate
before update of is_active on public.members
for each row
when (not OLD.is_active and NEW.is_active)
execute function public.members_stamp_rejoined_on_activate();

-- ── 4. 부과 생성에 합류월 하한 추가 ────────────────────────────────────
-- 20260820000000 정의 + `and not (합류월 = p_ym and 합류일 >= 컷오프)` 한 줄. 나머지는 그대로다.
create or replace function public.dues_generate_monthly(p_ym text)
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare v_fee int; v_offset int; v_cutoff int; v_n int := 0;
begin
  select monthly_fee, offset_days, join_cutoff_day
    into v_fee, v_offset, v_cutoff
  from public.dues_settings where id = 1;
  if v_fee is null then raise exception 'dues_settings not initialized'; end if;
  insert into public.dues_charges (kind, member_id, period_ym, amount_due)
  select 'monthly_fee', m.id, p_ym, v_fee
  from public.members m
  cross join lateral (
    -- 실제 합류일: 계정 생성 ↔ 마지막 재활성화 중 나중(KST date). rejoined_at 이 NULL 이면 생성일.
    select greatest(
             (m.created_at at time zone 'Asia/Seoul')::date,
             coalesce((m.rejoined_at at time zone 'Asia/Seoul')::date,
                      (m.created_at at time zone 'Asia/Seoul')::date)
           ) as joined_on
  ) j
  where m.is_active and not m.is_guest and not m.is_honorary and not public.is_operator(m.id)
    and p_ym >= to_char(
      date_trunc('month',
        (coalesce(m.membership_started_at, (m.created_at at time zone 'Asia/Seoul')::date) + v_offset)::timestamp)
      + interval '1 month', 'YYYY-MM')
    -- 합류월 하한: 컷오프일 이후에 들어온 달은 부과하지 않는다.
    and not (p_ym = to_char(j.joined_on, 'YYYY-MM')
             and extract(day from j.joined_on) >= v_cutoff)
  on conflict (member_id, period_ym) where period_ym is not null
  do update set amount_due = excluded.amount_due, updated_at = now()
  where public.dues_charges.amount_paid = 0;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

revoke execute on function public.dues_generate_monthly(text) from public, anon, authenticated;

comment on function public.dues_generate_monthly(text) is
  '월 회비 부과 생성. 자격 = 활성·비게스트·비명예·비운영진, 가입월(membership_started_at ?? created_at, +offset_days) 다음 달부터. 단 실제 합류일(계정 생성 ↔ 재활성화 중 나중)이 join_cutoff_day 이후면 그 합류월은 미부과(20260821000000). 이미 납부분(amount_paid>0)은 금액을 덮지 않고, 이미 생긴 부과를 지우지도 않는다.';

-- ── 5. 조민서 님 가입월 보정 ───────────────────────────────────────────
-- 기존회원인데 계정을 새로 만든 케이스(2026-08-21 생성). 신규 유예를 그대로 두면 첫 부과가 9월인데,
-- 기존회원이므로 7월 가입으로 보정한다 → 시작월 8월. 그리고 계정 생성이 8/21(컷오프 21일 이상)이라
-- §4 하한이 8월을 걷어내므로 **실제 첫 부과는 2026-09**다. 6월이 아니라 7월로 두는 이유는 6월로 내리면
-- 7월까지 부과 대상이 돼 "합류 전 달을 청구"하는 문제가 생기기 때문(운영진 판단).
update public.members
set membership_started_at = date '2026-07-01', updated_at = now()
where id = 'bfb2850c-b030-43bf-8752-3ac5642cad3e'
  and name = '조민서'
  and membership_started_at is null;

insert into public.dues_audit_log (actor_member_id, action, detail)
select null, 'membership_started_at_fix',
       jsonb_build_object(
         'member', id, 'name', name,
         'membership_started_at', membership_started_at,
         'created_at_kst', (created_at at time zone 'Asia/Seoul')::date,
         'why', '기존회원이 계정을 새로 만든 케이스 → 신규 유예 해제(7월 가입 보정). 계정 생성 8/21 은 컷오프 이상이라 8월은 미부과, 첫 부과는 2026-09.'
       )
from public.members
where id = 'bfb2850c-b030-43bf-8752-3ac5642cad3e'
  and membership_started_at = date '2026-07-01';
