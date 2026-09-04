# 서비스 확장 계약서 (EXPANSION_SPEC) — Phase 0

> 로그인 · 일정 · 참석/대기열 · 카풀 · 푸시 확장의 **단일 기준 문서**.
> 4트랙 설계 + 통합 적대적 검증의 "계약 동결" 결과를 정규화한 것이다.
> **이후 모든 마이그레이션·RPC·RLS·클라이언트 코드는 이 문서의 계약을 따른다.**
> 계약을 바꾸려면 먼저 이 문서를 고치고, 영향받는 Phase를 다시 검토한다.

작성: 2026-06-21 · 브랜치 `sam/expansion` · 관련 메모리 `cocktime-expansion-design`

---

## 0. 확정된 제품 결정 (요약)

| # | 결정 | 함의 |
|---|------|------|
| 1 | **회원 프로필 = 선수** | `members`가 성별·실력의 단일 소스. 게스트도 계정 없는 member 행. Sheets 점진 폐지 |
| 2 | **카카오 우선 → 네이버 2차** | 카카오 네이티브, 네이버는 Edge Function(Phase 10) |
| 3 | **무료 티어 + 앱내 알림 1차** | Realtime 앱내 알림 1차, 설치형 PWA 웹푸시 보조 |
| 4 | **일정 = 세션 통합** | 별도 events 없음. `sessions`를 상태기계로 확장. 하루 여러 모임 = 행 여러 개 |
| 5 | **로그인해야 열람** | 최종 RLS: 로그인 사용자 read + 운영진 write |
| 6 | **places = 좌표 테이블** | 모임 코트 위치 + 카풀 집결지 공용. name·address·lat·lng 수준 |
| 7 | **카풀 = 의향 + 운영진 수동 편성** | `attendances.carpool_role` + `sessions.carpool_groups`(jsonb) 공지 빌더. 배정 테이블 없음. 상세: `CARPOOL_MATCHING_DESIGN.md` |
| 8 | **정원 변경 시 자동 재조정(승급+강등)** | `set_session_capacity` RPC — 정원 UPDATE+재조정을 한 트랜잭션(원자)으로. 정원↑→대기 승격, 정원↓→초과 참석 강등, 각자 알림(`promoted`/`demoted`, 게스트면 초대 회원에 guest_name 실어 발송). 회차 개별수정에서 정원이 실제로 바뀔 때만 호출. (구 `promote_waitlist` 는 미배선 death code) |
| 9 | **콕 체크는 운영진만** | 별도 본인검증 RPC 불필요 |
| 10 | **마이그레이션 자유** | 개발 중이라 백필/파괴적 정리 부담 낮음. 이중운영 최소화 |

---

## 1. 식별자 타입 계약 (동결 — 절대 어기지 말 것)

4트랙이 서로 다르게 잡았던 부분. 통합 검증이 다음으로 동결한다.

| 엔티티 | PK 타입 | 근거 |
|--------|---------|------|
| `sessions.id` | **BIGSERIAL → BIGINT** | 기존 그대로. 클라이언트가 number로 사용 중 |
| `members.id` | **UUID (별도 PK)** | `auth.uid()`와 **다름**. 게스트(계정 없음) 표현 위해 |
| `members.auth_user_id` | UUID FK → `auth.users(id)`, **nullable, UNIQUE** | 계정 연결. 게스트는 NULL |
| `places.id` | BIGSERIAL → BIGINT | admin 전용 생성, 열거 위험 낮음 |
| `attendances` PK | `(session_id, member_id)` 복합 | 회원당 세션당 1행 |
| `attendances.session_id` | **BIGINT** FK → sessions | events 없음, session 직접 참조 |
| `attendances.member_id` | **UUID** FK → members | |
| `notifications.id` | UUID | |
| `notifications.recipient_member_id` | **UUID** FK → members | 컬럼명 동결: `recipient_member_id` (member_id/recipient_id 아님) |

**핵심 규칙**: `members.id ≠ auth.uid()`. 모든 "본인" 판별은 `current_member_id()` 헬퍼를 거친다. 직접 `auth.uid() = …` 비교 금지.

---

## 2. 헬퍼 함수 계약 (Phase 2에서 생성, 모든 RPC·RLS가 의존)

```sql
-- auth.uid() → members.id 매핑. 게스트/미연결/미로그인은 NULL.
create or replace function public.current_member_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select id from public.members where auth_user_id = auth.uid()
$$;

-- 운영진 여부. user_roles 직접 조회(JWT 아님) → 권한 즉시 회수 가능.
-- SECURITY DEFINER + search_path='' 로 user_roles RLS 재귀(42P17) 회피.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.members m on m.id = ur.member_id
    where m.auth_user_id = auth.uid() and ur.role = 'admin'
  )
$$;
```

- 두 함수는 `public`에 두되, 노출 위험을 줄이기 위해 `revoke execute … from anon` 후 `authenticated`에만 grant.
- `supabase_auth_admin` 권한 grant 필요 없음(JWT Hook 미사용).

---

## 3. 상태값 · enum 레지스트리 (동결)

| 대상 | 허용 값 | 비고 |
|------|---------|------|
| `members.gender` | `'M'` `'F'` (NULL 허용) | **세션 편입 전 NOT NULL 필수**(편입 RPC 가드) |
| `user_roles.role` | `'admin'` `'member'` | |
| `sessions.status` | `'draft'` `'open'` `'active'` `'closed'` `'cancelled'` | 상태기계 ↓ |
| `attendances.status` | `'confirmed'` `'waitlisted'` `'cancelled'` `'late_pool'` | 정원 큐 3종 + 정원 외 늦참 풀(`late_pool`). going/waitlist 표기 금지. `late_pool` = 후반 2/3 지점 이후 도착 신청, `confirmed_count` 미포함(§ 늦참 풀) |
| `attendances.carpool_role` | `'none'` `'can_drive'` `'need_ride'` | 기본 `'none'` |
| `attendances.meal_joining` | `true` `false` (boolean) | 정모 식사(회식) 참여. **기본 `true`(참여)** — "기본 참여, 안 먹는 사람만 해제" 모델이라 미응답/참여를 구분하지 않는다(3택 아님). `sessions.is_regular AND sessions.meal_enabled` 회차에서만 의미. 쓰기 `set_meal_joining(bigint,boolean,uuid)` — 본인 또는 내가 데려온 게스트. 취소 시 `true` 로 복원(BEFORE UPDATE 트리거 `trg_att_reset_meal` — 취소 경로 3개에 술어를 복제하지 않기 위해). 마이그레이션 `20260811010000` |
| `attendances.exempt_reason` | `'newbie'` `'ticket'` (NULL 허용) | 정원 외 확정 자리의 **사유**. `capacity_exempt` 와 항상 쌍(exempt=false면 NULL). `capacity_exempt` 만으로는 화면이 정원 외를 전량 '신규'로 오표기한다. 마이그레이션 `20260904000000` |
| `notifications.type` | `'promoted'` `'demoted'` `'session_cancelled'` `'session_closed'` `'session_open'` `'carpool_muster'` `'schedule_added'` `'new_member'` `'removed'` `'noshow'` `'wait_ticket_ready'` | 신규 타입은 여기 + `notifications.ts`/`send-push` 메시지 양쪽에 추가 |
| `wait_point_ledger.kind` | `'earn'` `'spend'` `'refund'` `'penalty'` `'adjust'` | 대기 포인트 원장(append-only). 마이그레이션 `20260904000000` |

### sessions 상태기계

```
draft ──(운영진 공개)──▶ open ──(세션 시작)──▶ active ──(종료)──▶ closed
  │                        │                      │
  └────────────────────── cancelled ◀────────────┘   (어느 상태에서든 운영진 취소)
```

- `draft`: 작성 중(회원 비공개)
- `open`: 참석 모집 중 — `join_session`은 **open에서만** 허용
- `active`: 당일 편성 진행(기존 `is_active=true`에 해당). 브릿지로 confirmed → session_players 생성
- `closed`: 종료(기존 `is_active=false, ended_at`)
- 기존 `sessions.is_active`는 `status='active'`로 의미 이전. 과도기엔 `is_active`를 `status` 기반으로 채우거나 generated column로 공존 후 제거(마이그레이션 자유).

---

## 4. 테이블 스키마 (신규 7 + 기존 변경 2)

### 4.1 신규 테이블

```sql
-- ① members : 계정 + 선수 프로필 (단일 소스). 게스트도 여기.
create table public.members (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,  -- 게스트 NULL
  name          text not null,
  gender        text check (gender in ('M','F')),     -- NULL 허용(가입 직후), 편입 전 필수
  skills        jsonb,                                 -- 기존 PlayerSkills 구조 그대로
  avatar_url    text,
  phone         text,
  is_guest      boolean not null default false,
  is_active     boolean not null default true,          -- 탈퇴(소프트). 의미는 아래 '비활성' 절 참조
  sheet_player_id text unique,                         -- Sheets player-N 매핑 키(폐지 후 deprecated)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 회원 '비활성'(is_active=false) = 탈퇴(소프트 딜리트). 하드삭제는 전면 금지 —
--   dues_charges·dues_allocations·attendances 가 ON DELETE CASCADE 라 회원 행을 지우면
--   부과·배분이 함께 사라지고 이미 매칭한 입금이 미분류로 되돌아간다(실측 사고: 회원 1명 삭제로
--   2026-07 입금 2건이 붙을 부과 없이 남았다). 그래서 `delete_member` 는 항상 예외(20260721000000),
--   본인 탈퇴도 소프트로 전환하고 RLS members_delete 도 회수(20260819010000). 그 뒤 본인 탈퇴는
--   `delete_my_account` 를 아예 버리고 **`deactivate_my_account`**(운영진 [비활성] 과 같은 처리)로
--   바꿨다(20260821020000) — 계정을 지우면 돌아오는 사람이 members 행을 새로 만들어 회비 이력이
--   끊기고 운영진이 `membership_started_at` 을 손으로 보정해야 한다(2026-08-21 실제 사례).
--   비활성이 실제로 바꾸는 것: 세션 셋업 후보 명단(fetchMembers)·실력 비교 앵커·명예회원 후보에서 제외,
--   그리고 **참석 신청 차단**(`join_session` 이 is_active 를 본다, 20260821020000 — 그 전엔 정지된
--   사람이 신청하면 attendances 엔 있는데 명단·편성엔 없는 유령 행이 됐다).
--   비활성이 바꾸지 않는 것: 로그인·조회·이미 확정된 정원 점유·푸시 수신·대관비 부과.
--   **본인 탈퇴 경로만 추가로** 하는 것: 미종료 세션 참석 취소 + 푸시 구독 삭제(나가겠다는 의사가
--   명확하므로 자리와 알림을 정리한다). 운영진 [비활성] 은 징계·보류 등 다른 의도일 수 있어
--   기존 참석·구독을 건드리지 않는다 — 의도된 비대칭.
--   회비는 새 부과가 안 생기고 **그 시점 미납분은 미부과로 삭제**된다(트리거
--   trg_members_uncharge_dues_on_deactivate — 면제가 아니라 부과 자체가 없어지는 것. 감사 로그
--   dues_audit_log.uncharge_dues_on_deactivate 가 유일한 흔적). 납부·부분납·대관비·이월 중인 건은
--   건드리지 않는다 (docs/ACCOUNTING_SPEC.md §4).
--   회원관리 목록에는 계속 노출된다(배지 + '비활성 N명 숨기기' 필터) → 재활성화 가능.

-- ② user_roles : 권한 소스 오브 트루스
create table public.user_roles (
  member_id  uuid not null references public.members(id) on delete cascade,
  role       text not null check (role in ('admin','member')),
  granted_at timestamptz not null default now(),
  primary key (member_id, role)
);

-- ③ places : 좌표 프리셋 (모임 코트 위치 + 카풀 집결지 공용)
create table public.places (
  id                  bigserial primary key,
  name                text not null,
  address             text,
  lat                 double precision,
  lng                 double precision,
  default_court_count int,
  is_active           boolean not null default true,
  created_by          uuid references public.members(id) on delete set null,
  created_at          timestamptz not null default now()
);

-- ④ attendances : 참석/대기 RSVP + 카풀 의향. 회원당 세션당 1행.
create table public.attendances (
  session_id   bigint not null references public.sessions(id) on delete cascade,
  member_id    uuid   not null references public.members(id) on delete cascade,
  status       text   not null check (status in ('confirmed','waitlisted','cancelled')),
  position     bigint not null,                          -- nextval(seq), 경쟁 없는 단조 순번
  carpool_role text   not null default 'none' check (carpool_role in ('none','can_drive','need_ride')),
  carpool_seats int,                                     -- can_drive일 때 제공 좌석(옵션)
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (session_id, member_id)
);
create sequence if not exists attendance_position_seq;
create index idx_att_session_status_pos on public.attendances(session_id, status, position);

-- ⑤ session_counters : 정원 동시성 단일 진실 소스 (sessions와 1:1, 락 분리용)
--    sessions 행을 직접 FOR UPDATE 하면 보드 편성(board_drafts UPDATE 등)과 경합 →
--    참석 동시성 전용 카운터 행을 별도로 잠근다.
create table public.session_counters (
  session_id      bigint primary key references public.sessions(id) on delete cascade,
  confirmed_count int not null default 0
);

-- ⑥ notifications : 앱내 알림 1차 + 푸시 트리거 소스
create table public.notifications (
  id                  uuid primary key default gen_random_uuid(),
  recipient_member_id uuid not null references public.members(id) on delete cascade,
  type                text not null,                     -- §3 레지스트리
  session_id          bigint references public.sessions(id) on delete cascade,
  payload             jsonb,
  read_at             timestamptz,
  sent                boolean not null default false,    -- 웹푸시 발송 여부(보조)
  created_at          timestamptz not null default now()
);
create index idx_notif_recipient on public.notifications(recipient_member_id, created_at desc);

-- ⑦ push_subscriptions : 웹푸시 구독(보조). 410/404 시 정리.
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  unique (member_id, endpoint)
);
```

### 4.2 기존 테이블 변경

```sql
-- sessions : 일정 = 세션. 상태기계 + 일정 메타 + 카풀 집결 공지.
alter table public.sessions
  add column title             text,
  add column scheduled_at      timestamptz,                          -- 예정 시작 (Asia/Seoul 표시)
  add column capacity          int,                                  -- 정원 (NULL=무제한)
  add column place_id          bigint references public.places(id) on delete set null,
  add column status            text not null default 'active'
       check (status in ('draft','open','active','closed','cancelled')),
  add column created_by        uuid references public.members(id) on delete set null,
  add column carpool_muster_place_id bigint references public.places(id) on delete set null,
  add column carpool_muster_at timestamptz;
-- is_active → status='active' 의미 이전(과도기 처리는 Phase 4에서).

-- session_players : 회원 연결만. 선수 정보는 여전히 세션 스냅샷(아래 §6).
alter table public.session_players
  add column member_id uuid references public.members(id) on delete set null;  -- 게스트 NULL
create index idx_sp_member on public.session_players(member_id);
```

> `matches`, `pair_history`는 **변경 없음**. 전부 `session_players.id`(UUID) 기준이라 무영향.

### 4.3 반복 일정 (요일·주차 규칙) — 마이그레이션 `20260622010000`

일정 생성을 단발 `scheduled_at` 입력에서 **반복 규칙 → 회차 자동 생성** 모델로 전환. 일정 입력 필드는 **요일·시간·최대인원·장소** 뿐(제목·코트수 제거 — 코트수는 보드에서 결정).

```sql
-- ① 반복 규칙: 운영진이 정의하는 원본
create table public.recurring_schedules (
  id bigserial primary key,
  day_of_week   smallint not null check (day_of_week between 0 and 6), -- 0=일..6=토(dow)
  week_ordinals smallint[] not null default '{1,2,3,4,5}',  -- 발생 주차(매주=1~5, 홀수주{1,3,5}, 짝수주{2,4})
  include_last  boolean not null default false,             -- '마지막주' 포함
  start_time    time not null,
  capacity      int,                                        -- NULL=무제한
  place_id      bigint references public.places(id) on delete set null,
  is_active     boolean not null default true,
  created_by    uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- ② sessions 확장: 규칙↔회차 연결 + 개별 수정 플래그(멱등 키 (rule_id, occurrence_date))
alter table public.sessions
  add column recurring_schedule_id bigint references public.recurring_schedules(id) on delete set null,
  add column occurrence_date date,
  add column is_overridden boolean not null default false;
```

- **2계층 모델**: 규칙(`recurring_schedules`) = "원본", 회차(`sessions`) = 참석·카풀·보드가 붙는 "실제 모임". `recurring_valid_occurrences` 뷰가 활성 규칙 × 향후 56일의 유효 발생일을 계산.
- **주차(week_ordinals) 정의 — 월요일 기준**(마이그레이션 `20260701010000`): 주(週)는 월~일 블록. 그 달의 **첫 월요일이 드는 주 = 1주차**, 이후 7일마다 2·3·4·5주차. 각 날짜의 주차는 "그 날이 속한 월~일 주의 **월요일이 며칠(day-of-month)**인지"로 계산: `week_monday = 그날 - ((dow+6)%7)`, `week = floor((day(week_monday)-1)/7) + 1`(항상 1~5). 선행 부분주(첫 월요일 이전 날) 는 그 주 월요일이 **전달**에 있어 전달 마지막 주(4·5주)로 편입되므로 어떤 날짜도 누락되지 않고 **매주 `{1,2,3,4,5}` 는 모든 발생을 빠짐없이 포함**한다. 예) 2026-08은 1일이 토 → 8/3(월)=1주차, 8/1(토)은 그 주 월요일 7/27이라 7월 4주로 편입(매주 토요일이면 포함), 8/5(수)=1·8/12=2·8/19=3·8/26=4주. 홀수주 `{1,3,5}`·짝수주 `{2,4}`는 이 주차 번호 기준. 달력 UI도 월~일 시작으로 표시. (폐기된 이전 정의는 `floor((day-1)/7)+1`="그 달의 N번째 해당요일"로, 1일 시작 요일에 따라 홀/짝이 뒤집혔다.)
- **`sync_schedule_occurrences()` RPC**(SECURITY DEFINER, authenticated 호출 — 앱 로드 시 멱등 실행): A) 어제 이전 미진행 draft/open → `closed`, B) 누락 회차 `draft` 생성, C) 미오버라이드 draft 를 규칙 최신값으로 갱신, D) 규칙 변경/비활성으로 무효해진 미오버라이드 draft 삭제, E) **scheduled_at(KST 날짜)이 오늘 이후인 `draft`→`open`**. 노출 시점은 회차 출처로 갈린다(마이그레이션 `20260815000000`):
	- **반복 규칙 회차**(`recurring_schedule_id` 있음): 공개 상한 `reveal_horizon_kst_date()` 이내만 공개. 공개 시점은 **매주 일요일 18:00 KST**이고 그 시점이 지나면 "직전 공개 일요일 +7일"(=다음 일요일)까지 한번에 공개(일요일 18:00 이전엔 이번 일요일까지만). 즉 rolling "1주 전 노출"이 아니라 **일요일 저녁 일괄 공개**(마이그레이션 `20260703010000`). pg_cron 잡 `reveal-weekly-sessions`(`0 9 * * 0` UTC = 일요일 18:00 KST)가 앱 접속 없이도 정각에 sync 를 실행해 open 전환+`session_open` 푸시를 보장한다.
	- **수동 추가한 일회성 회차**(`recurring_schedule_id is null`): **공개 상한을 건너뛰고 등록 즉시 `open`**(달력에서 직접 추가 → `addOneOff` 가 곧바로 sync 호출). 수동 추가 자체가 공개 의사표시라 주 단위 묶음 공개의 대상이 아니다 — 몇 달 뒤 일정이라도 만든 시점부터 홈에 항시 노출되고 참석 신청을 받는다. 알림은 기존 경로 그대로(1건이면 `session_open`, 2건 이상이면 `sessions_opened`).
- **상태기계 활용**: `draft`(운영진만, 미노출) → `open`(노출·참석시작, `join_session` 진입 조건) → `active`(보드) → `closed`/`cancelled`. 명절 등 예외는 해당 회차만 `cancelled`(행 유지 → 재생성 방지) 또는 개별 `is_overridden=true` 수정.
- **반복 회차는 하드 삭제하지 않는다(취소=tombstone, 되살리기 가능)**: 운영진의 회차 삭제(`removeOccurrence`)는 반복 회차면 `cancelOccurrence`(`cancelled`+`is_overridden=true`) **tombstone 으로 전환**해 행을 남긴다 — B단계 `not exists (recurring_schedule_id, occurrence_date)` 가 이 행을 보고 재생성을 건너뛰므로, 하드 삭제 시 sync 가 되살려 **의도치 않은 재노출+`session_open` 푸시**가 나가는 사고(예: 목요일 낮 임의 접속자의 멱등 sync 가 삭제된 금요일 회차를 재생성·공개)를 막는다. 되돌리려면 **되살리기 `reopenOccurrence`**(`cancelled`→`draft`+`is_overridden=false`, 규칙 관리에 재편입) 후 직후 sync E단계가 공개 창 안이면 즉시 `open`+알림(이미 알림이 나간 회차는 멱등 가드로 중복 발송 안 함). 일회성 회차(규칙 없음)만 재생성 주체가 없어 `deleteSchedule` 로 완전 삭제한다. ⚠️ **sync D단계의 draft 삭제는 이와 별개** — 규칙 변경/비활성으로 무효해졌고 **아직 한 번도 노출된 적 없는** 미오버라이드 draft 정리이지, 사용자·운영진이 취소한 회차를 지우는 게 아니다.
- **참여 가능 판정 = `status='open'`**: `join_session`·`add_guest_attendance`는 status(+아래 종료 가드)만 검사한다. open 은 sync E단계만 만들므로 **status 가 노출·참여의 단일 진실원천** — 공개 창 밖 open 은 수동 추가한 일회성 회차이거나 운영진의 의도적 개별 조작뿐이라 참여를 막을 이유가 없다(그래서 시간 가드를 두면 **먼 미래 일회성 일정에 참석 신청만 막히는** 회귀가 난다). 과거엔 노출 시간 가드(`scheduled_at <= now()+7d`)를 이중으로 재검증했으나(`20260623040000` 도입 → `20260703010000` 공개 상한과 일치 → `20260703020000` rolling 롤백), status 와 시간 가드의 이중 기준이 노출 규칙 변경 때 전환기 회귀를 낳아 `20260703040000`에서 **제거**. 시작 시각이 지난 `open` 회차의 늦참(late join)은 홈 진행 하이라이트(아래)와 함께 의도적으로 허용한다.
- **종료(`ends_at`) 상한 가드**: status 검사에 더해 **종료 시각이 지나면 마감**한다 — `ends_at is not null and ends_at <= now()` 이면 `session ended` 예외. `join_session`·`add_guest_attendance`·`start_session_from_schedule`(경기 시작) 세 RPC 모두에 적용해 종료된 일정은 회원·운영진 누구도 참석/게스트신청/경기시작을 할 수 없다. `ends_at`이 NULL인 즉석/미정 회차는 가드 통과(차단 안 함). sync A단계(어제 이전 draft/open→closed)는 일(日) 단위 정리라, 당일 종료 직후의 미세 구간은 이 가드 + 홈 필터(아래)가 실시간으로 막는다. 마이그레이션 `20260624030000_attendance_end_time_guard.sql`.
- **정원 외 늦참 풀(`late_pool`)** — 마이그레이션 `20260708010000`: 늦참 슬라이더로 도착시각을 **경기 후반 2/3 지점 이후**(예: 18:00~21:00 세션이면 20:00="8시")로 넘기면, 정원 큐와 분리된 **독립 접수**로 전환한다. `late_pool` 은 `confirmed_count` 에 미포함(정원 무관) — 현실에서 "늦게 와서 자리 나면 참여, 없으면 대기"를 시스템화한 것. 현장 판정(자리/대기)은 보드 대기 로테이션이 담당하고, RSVP 단계는 정원 분리 + 표기까지만 책임진다(`start_session_from_schedule` 은 여전히 `confirmed` 만 편입). `set_late_minutes(bigint,int)` 가 경계를 원자 처리: **확정→풀** 전환 시 정원 1칸 반납 + 대기 1순위 자동 승급(`promoted`), **풀→복귀** 시 여유 있으면 `confirmed`, 만석이면 **부과 없는 일정에서 프리패스 두 갈래**(운영진 총수<2 / 초과 확정 신규<2 · §5.1)로 정원 초과 `confirmed`, 그 외 `waitlisted`(큐 뒤 재진입). 경계는 절대시각이 아니라 `v_start + (v_end - v_start)*2/3`(종료시각 필수). 초대자가 `late_pool` 이면 그 게스트도 `late_pool` 상속. 정원 재조정(`set_session_capacity`)은 `late_pool` 을 건드리지 않는다(정원 독립). 클라 8시 경계 크로싱은 확인 다이얼로그로 게이팅하고 UI 는 앰버→바이올렛으로 구분(`late_minutes` 반환 `{status, promoted}`).
- **게스트 확정 상한 = 세션당 2명** — 마이그레이션 `20260712010000`: 정원(`capacity`)과 별개로, `status='confirmed'` 인 게스트(`invited_by` 有)는 세션당 **최대 2명**. 3번째부터는 정원이 남아도 `waitlisted` 로 접수되고, **확정 게스트가 빠질 때(취소/제거/강등)만** 승급 대상이 된다(회원은 이 상한과 무관 — 기존 정원 규칙 그대로). 승급 로직은 단일 헬퍼 `promote_next_waitlisted(session_id)` 로 모아 상한 규칙이 한 곳에 살게 했고(`cancel_attendance`·`cancel_guest_attendance`·`admin_cancel_attendance`·`set_late_minutes` 가 공유; `set_session_capacity` 는 배치라 인라인 반영), 헬퍼는 알림을 넣지 않는다(호출자가 상황별 알림 INSERT). 대기 1순위 선택식은 `status='waitlisted' AND (invited_by IS NULL OR <확정 게스트 수> < 2) AND (정원 여유 OR 운영진 프리패스) ORDER BY position ASC` — 운영진 프리패스는 **빈자리가 0이어도** 승급시킨다(부과 없는 일정). **신규회원 프리패스는 이 식에 없다** — 부여는 본인이 누른 순간뿐이다(§5.1). 게스트도 프리패스 대상이 아니다. **확정 게스트 수는 `session_counters` FOR UPDATE 락 안에서만 읽으므로 `count(*)` 로 판정**한다(§5.1 `count(*)` 금지의 예외 — 정원 총량이 아니라 락 안의 하위상한이라 경쟁 없음; 6개 전이 지점 카운터 배선 드리프트 회피). 도입 시 기존 위반(확정 게스트 >2)인 open 세션을 함께 정리(먼저 신청한 2명 유지, 나머지 대기 강등 후 빈 정원은 대기 회원으로 재승급, **알림 없음**).
- **동명 회원 게스트 차단** — 마이그레이션 `20260712010000`: `add_guest_attendance` 는 활성 회원(`is_guest=false AND is_active`)과 **이름이 같은 게스트 신청을 거부**한다(`name_is_member` 예외 → 클라 "이미 같은 이름의 회원이 있어요…"). 게스트가 실제 회원과 구분되지 않아 "회원처럼" 참여하는 혼동을 서버에서 근본 차단(회원 본인은 직접 참석 신청). 이름 비교는 `btrim(lower(...))`.
- **게스트 members 행 재사용** — 마이그레이션 `20260819030000`: 같은 게스트가 다시 오면 **기존 행에 붙인다**(이름 `btrim(lower(...))` + 성별 일치, 여러 행이면 `created_at desc` 최신 1행, `is_guest AND auth_user_id is null` 인 행만). 종전에는 신청마다 members 를 무조건 insert 해 프로덕션에 게스트 47행(실인원 30명, 잉여 17행)이 쌓였고, 그 잉여가 새는 화면이 **정산함 납부자 후보·검색**이었다(회원관리는 `is_guest=false` 로 걸러 게스트를 안 보여줘 운영진이 손댈 방법도 없었다).
  - **성별까지 같아야 재사용**한다 — 이름만으로 합치면 동명이인 게스트가 한 사람으로 뭉쳐 과거 참석·회계가 남의 것으로 붙는다. 오합치는 회계 CASCADE 때문에 분리보다 훨씬 비싸므로 애매하면 새 행을 만든다.
  - `skills` 는 덮지 않는다(과거 편성의 근거). 저장된 skills 에 `grade` 가 아예 없을 때만 이번 입력으로 채운다.
  - **같은 세션 중복 차단**: 그 게스트 행이 이미 그 세션에 있으면 `guest_already_joined` 예외(클라 "이미 이 일정에 신청된 게스트예요…"). `attendances` PK `(session_id, member_id)` 라 어차피 충돌하지만 raw 23505 는 안내가 안 된다. 실측 사고(session 103 김지훈×2, 114 공태호×2)를 이 게이트가 막는다. 취소했던 게스트를 다시 초대하면 그 참석 행을 되살리고 `invited_by` 를 재초대자로 갱신한다(소유권 검사가 `invited_by` 기준이라 필수).
  - **기존 47행 병합(백필)은 하지 않았다** — 같은 세션에 잔재 두 행이 함께 있는 사례가 있어 PK 충돌이고, `dues_charges`/`dues_allocations` 귀속이 바뀌어 공개회계 수치가 움직인다. 이 마이그레이션의 목적은 증가를 멈추는 것.
- **편집 권한**: 회차 개별 수정/취소/일회성 추가는 `sessions` anon_all 정책 하 클라이언트 직접 쓰기(운영진 UI 게이트). 규칙 CRUD 는 `recurring_schedules` RLS(select authenticated / write `is_admin()`).
- UI: 회원=노출 회차 목록(Home), 운영진=`/schedule` 달력+규칙 패널(요일·주차 규칙 등록 → 달력 자동 생성 → 회차별 예외 편집).

### 4.4 끝시간 + 카풀 on/off — 마이그레이션 `20260622120000`

일정에 **시작·종료 시간**과 **카풀 노출 토글**을 추가. 카풀(`attendances.carpool_role`)은 이제 일정별로 켜야 노출된다.

```sql
alter table public.recurring_schedules
  add column end_time        time,                    -- 종료 시각(Asia/Seoul 벽시계)
  add column carpool_enabled boolean not null default false;
alter table public.sessions
  add column ends_at         timestamptz,             -- 종료 시각
  add column carpool_enabled boolean not null default false;  -- on이면 참석자가 카풀 가능/필요 선택
-- 백필: 종료 = 시작+3h, 카풀 = 주말(토/일)만 on
```

- **종료 시각**: 규칙은 `end_time`, 회차는 `ends_at`. `recurring_valid_occurrences` 뷰가 `occ_ends_at`(종료<시작이면 다음날)을 계산, `sync` B/C 단계가 회차 `ends_at`·`carpool_enabled`를 규칙값으로 전파(미오버라이드 draft 한정).
- **카풀 토글**: 회차 `carpool_enabled`가 true 일 때만 ScheduleCard 에 카풀 가능/필요 선택·집계 노출. 신규 일정 기본값은 **요일이 주말이면 on**(편집기에서 자동 추종, 운영진 수동 변경 가능).
- **식사 체크 토글**(`20260811010000`): 회차 `meal_enabled` + `is_regular` 가 **둘 다** true 일 때만 식사 참여 선택·집계 노출(회식 없는 정모가 있어 정모 플래그만으로 자동 노출하지 않는다). 카풀과 달리 `recurring_schedules` 에 미러 컬럼을 두지 않아 규칙 sync 가 회차 값을 덮지 않는다(`is_regular` 와 동일 취급). 식사 인원 집계 기준 = **확정 + 정원 외 늦참** 중 참여(대기자는 승격돼야 오므로 제외하되, 선택 UI 는 대기자에게도 노출).
- **회식 가게**(`20260811020000` + `20260811030000`): `sessions.meal_place`(가게명) + `meal_place_lat/lng`(카카오 검색으로 고른 좌표). 식사 토글을 켜면 편집기에 **공용 `KakaoLocationSearch`**(장소 등록·거주지 입력과 같은 컴포넌트 — 타이핑 자동완성 + 지도 미리보기)가 열리고, 결과를 고르면 이름+좌표가 함께 저장된다. **이름을 직접 타이핑하면 좌표를 버린다**(검색 결과와 어긋난 좌표로 엉뚱한 핀을 띄우지 않기 위해) → 그때는 이름 검색으로 폴백. 카드·정모 안내 페이지에서 `MealPlaceLink` 로 표시 — `buildPlaceMapTarget`(좌표 핀 → 이름 검색) + `openPlaceMap` 경로를 모임 장소와 공유한다. 도입 당일 `meal_place_url`(링크 수동 붙여넣기)은 값 0건 확인 후 제거 — 검색이 있으면 링크를 찾아 붙여넣을 이유가 없다. **`places` 행으로 만들지 않는다**: places 는 대관장소 마스터(`charges_court_fee` 게이트 + 일정 장소 드롭다운 원본)라 음식점을 섞으면 목록이 오염되고 대관비 부과 판정과 얽힌다. 회식 가게는 회차마다 바뀌는 1회성 정보라 세션 행에 직접 둔다.
- **대진표 버튼 게이트**: `notice_md` 가 **비어 있으면** 카드의 '대진표 · 안내 보기' 버튼을 렌더하지 않는다(빈 채로 띄우면 눌러도 "준비 중"만 나온다). 페이지 자체의 "준비 중" EmptyState 는 직접 URL 진입 대비로 남긴다.
- **홈 진행 하이라이트**: 시작 시각(`scheduled_at`)이 지난 `open` 회차는 목록 맨 위로 분리·하이라이트되고 운영진에게 `세션 시작 · 보드 열기` 버튼 노출. 시작 전에는 버튼을 숨긴다(시작 이후 **종료 시각 전까지** 유지). 30초 tick 으로 도달 감지.
- **종료 일정 숨김(홈)**: 종료 시각(`ends_at`)이 지난 `open` 회차는 홈 목록에서 제외한다(`isPastSchedule`, 30초 tick 으로 재평가) — 위 `ends_at` 상한 가드와 동일 기준의 클라이언트 미노출 처리. `active`(진행중) 회차는 종료 시각과 무관하게 유지(운영 중 세션을 목록에서 지우지 않음). 30초 tick 윈도우의 stale 클릭은 서버 `session ended` 가드가 막고, 홈은 이를 "이미 종료된 일정입니다"로 표시.

---

## 5. RPC 계약 (시그니처 + 동작 + 동시성)

모든 RPC는 `SECURITY DEFINER SET search_path = ''`. 잠금 순서 통일로 데드락 회피: **sessions(검증) → session_counters(직렬화) → attendances**.

| RPC | 시그니처 | 권한 | 동작 |
|-----|---------|------|------|
| `join_session` | `(p_session_id bigint) → attendances` | 로그인 회원 | 정원 여유면 confirmed. 만석이면 **부과 없는 일정에서만 프리패스 두 갈래**(①운영진: 확정 운영진 총수<2 ②신규회원: 가입 2주 이내, **상한 없음** · §5.1)로 정원 초과 confirmed, 그 외 waitlisted. 신규 프리패스가 **부여되는 지점은 이 함수와 `set_late_minutes` 뿐**이다. **비활성 회원 차단**(`member inactive`, 20260821020000 — 이 함수를 재정의할 때 반드시 함께 옮긴다). 중복신청 차단, 취소후재신청은 같은 행 갱신. 참여 가능 = `status='open'` + **종료 상한(`ends_at<=now()`→`session ended`)** 가드 |
| `cancel_attendance` | `(p_session_id bigint) → void` | 로그인 회원(본인) | 본인 취소(멱등). 카풀 의향(`carpool_role`/`carpool_seats`) 함께 해제(재참석 시 부활 방지). confirmed였으면 카운터 감소 + 대기 1순위 자동 승급 + 알림 |
| `admin_cancel_attendance` | `(p_session_id bigint, p_member_id uuid) → void` | 운영진 | 운영진이 참여목록에서 임의 참석자(회원/게스트) 제거. cancel_attendance 패턴 + is_admin() 게이팅. confirmed였고 open이면 대기 1순위 자동 승급. 제거 당사자에게 `removed` 알림(누가 제거했는지 by_name 포함, 게스트면 초대회원에 guest_name). 수신자가 운영진 본인이면 생략 |
| `promote_waitlist` | `(p_session_id bigint) → int` | 운영진 | 정원 상향 후 여유만큼 대기자 일괄 승급 + 각자 알림. 승급 수 반환. ⚠️ 미배선(dead) — 실제 승급/강등은 `set_session_capacity` 가 담당 |
| `set_session_capacity` | `(p_session_id bigint, p_capacity int) → jsonb{promoted,demoted}` | 운영진 | 정원 UPDATE+재조정 원자 RPC. open 세션만 재조정: **position ASC 단일 패스 그리디**로 전원을 다시 배분한다 — 앞에서부터 정원을 채우고(게스트는 확정 2명 미만일 때만), 만석 이후엔 프리패스 자격자(운영진 총수<2 / 초과 확정 신규<2)만 초과 confirmed, 나머지는 waitlisted. 승격도 강등도 그 한 패스의 결과다(정원↓ 시 초과분 강등이 따로 있는 게 아니다). position 은 보존한다. 신규 유예를 **세션 날짜**로 판정하므로 며칠 뒤 다시 돌려도 같은 답이 나온다(멱등). 알림 대상 `coalesce(invited_by, member_id)`(게스트면 payload.guest_name). 승격 `promoted`/강등 `demoted`. 잠금 sessions→session_counters→attendances. open 이 아닌 세션도 **카운터는 실제값으로 정합**(20260806010000 — 종료 세션 드리프트 잔존 방지) |
| `add_guest_attendance` | `(p_session_id bigint, p_name text, p_gender text, p_skills jsonb) → attendances` | 로그인 회원(참석 중) | 게스트(계정 없는 member) 신청. 본인 참석(confirmed/waitlisted/late_pool) 필수. **동명 활성 회원 차단(`name_is_member`)**. **이름+성별이 같은 기존 게스트 행 재사용**, 같은 세션 중복은 `guest_already_joined`(2026-08-19, §4.3). 정원 여유 + **확정 게스트 2명 미만**이면 confirmed, 아니면 waitlisted(초대자 late_pool이면 게스트도 late_pool). §4.3 게스트 확정 상한 |
| `cancel_guest_attendance` | `(p_session_id bigint, p_guest_member_id uuid) → void` | 로그인 회원(초대자) | 본인이 데려온 게스트 취소(멱등). confirmed였으면 카운터 감소 + open이면 대기 1순위 승급(상한 인식). 승급 알림 `coalesce(invited_by, member_id)` |
| `promote_next_waitlisted` | `(p_session_id bigint) → attendances` | 내부(SECURITY DEFINER RPC 전용) | 대기 1순위 승급 헬퍼. 게스트는 확정 2명 미만일 때만 대상. 자격식은 `게스트 상한 통과 && (정원 여유 ‖ 운영진 프리패스)` — 운영진 갈래는 **빈자리가 0이어도** 승격시킨다(부과 없는 일정). **신규회원 프리패스는 여기 없다**(§5.1 — 넣으면 앞 순번 일반 회원이 영구히 밀린다). 락은 스스로 확보(`session_counter_sync`), 정원 판정은 **실제 confirmed 행 수** 기준, confirmed_count 를 실제값+1 로 세팅, **알림 없음**(호출자 책임). 대상 없으면 NULL 로우. `FOR UPDATE`(SKIP LOCKED 아님 — 후보가 잠겨 조용히 0명이 되는 것을 막는다). 마이그레이션 20260806010000 |
| `promote_waitlist_fill` | `(p_session_id bigint) → int` | 내부 | **자격자가 없을 때까지** 반복 승격 + 각자 `promoted` 알림(빈자리 개수를 세는 게 아니다 — 운영진 프리패스가 빈자리 0에서도 자격을 열기 때문). 승격 인원 반환. 취소/늦참풀진입 계열 RPC가 open 세션에서 호출한다(이벤트당 1명만 채우던 규칙 때문에 한 번 생긴 빈자리가 영구히 남던 문제를 제거). 마이그레이션 20260806010000 |
| `session_counter_sync` | `(p_session_id bigint) → int` | 내부 | `session_counters` 행을 잠그고 **실제 confirmed 행 수로 덮어써** 드리프트를 자가 치유하고 그 값을 반환. 모든 정원 판정 지점이 ±1 산술 대신 이 함수를 쓴다(카운터를 파생값으로 강등). 마이그레이션 20260806010000 |
| `cancel_session` | `(p_session_id bigint) → void` | 운영진 | status='cancelled' + 전체 참석자 알림 |
| `bridge_confirmed_to_players` | `(p_session_id bigint) → void` | 운영진 | **Phase 6**: confirmed 참석자를 session_players로 일괄 INSERT(members→스냅샷, gender NULL 가드). 보드 로직 0변경 |
| `set_session_status` | `(p_session_id bigint, p_status text) → void` | 운영진 | 상태 전이(draft→open→active→closed) |

### 5.1 join_session / cancel_attendance 동시성 규칙 (핵심)

- **직렬화 지점은 `session_counters` 행의 `FOR UPDATE` 단독.** sessions는 status 검증용 `SELECT`(필요 시 `FOR SHARE`)만 — 편성 경로(sessions UPDATE)와 락 분리.
- 카운터 행 보장: `INSERT … ON CONFLICT (session_id) DO NOTHING` 후 `SELECT … FOR UPDATE`.
- 정원 판정은 **`session_counters` 행 락 안에서 실제 `count(*)`**(마이그레이션 `20260806010000` `session_counter_sync()`). `confirmed_count` 는 **정원을 소비하는 확정 인원**이다 — `capacity_exempt`(신규 프리패스 자리)와 `late_pool` 은 세지 않는다(`20260903010000`). 직렬화는 여전히 카운터 행 `FOR UPDATE` 가 담당하지만 **값의 권위는 attendances 실제 행**이고, `confirmed_count` 는 그 값으로 덮어써지는 **파생 캐시**다.
  - 변경 이유: `confirmed_count` 를 ±1 산술로만 관리하던 동안, 어떤 이유로든 실제 행보다 커지면(유령 자리) 빈자리가 있어도 승격이 **영구 정지**했고 감지·복구 장치가 없었다(2026-08-06 목 세션 30시간 정지 사고). 이제 모든 정원 판정 지점이 호출 시마다 자가 치유한다.
  - `late_pool` 은 `confirmed` 가 아니므로 자동으로 카운터에서 빠진다(정원 외 유지).
- `position = nextval('attendance_position_seq')` — 경쟁 없는 단조 순번. 대기 1순위 = `status='waitlisted' ORDER BY position ASC`.
- 자동 승급: `… FOR UPDATE LIMIT 1`(`SKIP LOCKED` 제거, `20260806010000`) — 후보 행이 순간 잠겼을 때 조용히 "승격자 없음"이 되던 위험을 없앴다. 중복 승급은 카운터 행 락으로 이미 배제된다. 그리고 승격은 **빈자리 수만큼 루프**(`promote_waitlist_fill`) — 이벤트당 1명만 채우면 한 번 생긴 빈자리가 남는다.
- **운영진 프리패스(부과 없는 일정)**: 만석이어도 **확정 운영진 총수 < 2** 일 때 대기 중 운영진 1명을 정원 초과 확정. **정원 안에 이미 들어와 있는 운영진도 이 2명에 포함**된다(2026-08-06 운영자 확정, 마이그레이션 `20260806020000`). 정원 18 기준: ①회원16+운영진2=18 만석 → 3번째 운영진 대기 ②거기서 운영진 1명 취소 → 대기 1순위가 누구든 참여 ③회원17+운영진1=18 만석에서 운영진 참여 → 초과 확정 19명 ④거기서 회원 1명 취소 → 회원16+운영진2=18 → 아무도 승격 안 됨.
- **신규회원 2주 프리패스(부과 없는 일정)**: 만석이어도 **가입 2주 이내 회원**은 대기에 걸리지 않고 확정된다(2026-09-03, 마이그레이션 `20260903000000` → `20260903010000`).
  - **그 자리는 정원을 소비하지 않는다**(`attendances.capacity_exempt = true`, 마이그레이션 `20260903010000`). `session_counter_sync` 가 이 행을 세지 않으므로 `confirmed_count` 의 뜻이 **'정원을 소비하는 확정 인원'** 으로 좁혀졌고, 정원 안 자리는 언제나 `capacity` 칸이 그대로 있다.
    - 정원 5 + 신규 1(정원 외) → 참석 6명, 카운터 5
    - 정원 안 회원 1명 취소 → 카운터 4 < 5 → **대기 1번 즉시 승격** → 참석 6명 유지
  - 왜 이렇게 바꿨나: 종전에는 프리패스 자리가 카운터에 섞여 있어, 확정자가 취소되면 그 자리가 신규의 초과분을 상쇄하는 데 쓰였다(카운터 6→5=정원, 정원 미달이 아니라 승격 없음). 대기 1번에게는 "자리가 났는데 왜 순서가 오지 않나"가 되어 불만이 컸다(운영자 보고 2026-09-03). 프리패스는 정원 안 빈자리를 흡수하는 게 아니라 **정원 밖에 자리를 하나 더 만드는 것**이어야 한다.
  - 파생(position 순)이 아니라 **기록**이라 자리 성격이 흔들리지 않는다: 취소가 나도 신규가 정원 안으로 슬며시 들어오지 않고, 정원을 낮춰도 정원 외 자리는 살아남으며(정원 안 자리들끼리만 다시 줄을 선다), 유예가 끝나도 이미 받은 자리는 재계산으로 사라지지 않는다.
  - **운영진 프리패스는 그대로다**(재론 금지) — 종전처럼 정원 카운트에 들어가고 '확정 운영진 총수 < 2' 로 판정한다. 두 프리패스의 성격이 갈리는 것은 의도다: 운영진은 정원을 함께 쓰는 구성원이고, 신규 유예는 정원과 무관한 한시적 예외다.
  - **부여 시점은 본인이 누른 순간뿐** — `join_session`, `set_late_minutes`(정원외늦참 → 정시 복귀). **승격 루프(`promote_next_waitlisted`)에는 넣지 않는다.** 넣으면 대기 신규가 **앞 순번 일반 회원을 추월**한다 — 만석이라 정원 분기가 닫힌 상태에서도 신규 분기만 열려, 취소로 자리가 날 때마다 뒤 순번 신규가 먼저 들어간다. 프리패스가 "정원을 초과해 자리를 더 만드는 것"에서 "정원 안 빈자리를 가로채는 것"으로 변질되는 것이다(상한이 있던 설계에서는 초과 신규 수가 취소마다 0으로 리셋돼 앞 순번이 **영구히** 밀리는 형태로 드러났다).
  - 그 결과 **`position` 이 여전히 유일한 승격 순서**이고(클라 `waitDisplay` 미러가 정확하다), 20260806020000 검증 예시 ④ "만석 && 프리패스 소진이면 아무도 승격 안 됨"이 그대로 성립하며, 취소 1건에 들어오는 인원도 종전과 같다. 초과 자리가 2칸 다 찬 뒤 신청한 신규는 평범한 대기자가 된다.
  - 그리디(`set_session_capacity`)는 **이미 confirmed 인** 신규의 초과 자리만 유지하고 대기 신규에게 새로 주지 않는다(`v_att.status = 'confirmed'` 조건 — 상한이 없어도 그리디가 부여까지 하면 위와 같은 추월이 난다). 그래서 정원을 같은 값으로 다시 저장해도 승격/강등 0이다.
  - 비활성(정지·탈퇴) 회원은 `session_newbie_grace` 가 false — 신규 자격으로 되살아나지 않는다.
  - **인원 상한 없음**(2026-09-03 운영자 확정). 유예 중인 신규회원은 몇 명이든 만석을 넘어 확정된다 — 정원 18인 회차의 확정 인원은 `18 + (그때 유예 중인 신규 신청자 수) + 운영진 최대 2`. 인원으로 자르면 같은 유예 기간의 신규끼리 선착순 경쟁이 생겨 "첫 2주는 무조건 나올 수 있게"라는 목적이 무너지기 때문이다.
  - 상한이 없어도 폭주하지 않는 근거: 유예가 가입 후 2주뿐이고, 부여 지점이 '본인이 누른 순간' 하나뿐이라(아래) 한 사람이 한 회차에서 한 자리만 만든다.
  - 운영진 프리패스는 그대로 '확정 운영진 총수 < 2' 캡을 유지한다(별개 규칙, 재론 금지 — 20260806020000).
  - 운영진 캡과 기준이 다른 건 의도다. 운영진은 '총수'라 정원 안 운영진도 2명에 포함되지만, 신규는 '초과분'만 센다 — 정원 안 신규를 포함시키면 일찍 신청한 신규가 늦게 가입한 신규의 자리를 잡아먹기 때문이다.
  - **기산은 세션 날짜**: `가입일 <= 세션 날짜(KST) <= 가입일 + 14일`. `now()` 가 아니라 세션 날짜라서 `set_session_capacity` 그리디가 며칠 뒤 다시 돌아도 같은 답을 낸다(멱등 — 나중에 강등되어 `demoted` 알림이 날아가는 사고가 없다).
  - **가입일 = `member_join_date(member_id)`** = `coalesce(membership_started_at, created_at@KST)` — 회비 부과와 **같은 정의**를 단일 헬퍼로 뽑았다(회비 함수들은 아직 이 식을 인라인해 두었고, 다음에 손댈 때 헬퍼로 옮긴다). 두 축이 갈라지면 "회비는 신규인데 참여는 아니다"가 생긴다.
  - **하한(`가입일 <=`)이 왜 있나**: 회비 면제 회원을 별도 플래그 없이 `membership_started_at` 을 미래로 두어 처리하는 관행이 있다(20260713130000). 상한만 보면 그 회원은 `세션날짜 <= 미래+14` 를 영원히 만족해 **영구 프리패스**가 된다.
  - **가입일 컬럼은 회원이 못 바꾼다**: `members_update` 정책이 본인 행 UPDATE 를 허용하고 `membership_started_at`·`created_at` 에 컬럼 UPDATE 권한이 남아 있어, 게이트가 없으면 회원이 자기 가입일을 2주마다 오늘로 밀어 **영구 프리패스**를 얻을 수 있었다(같은 값이 회비 부과 시작월도 정하므로 회비 회피 경로이기도 했다 — 이 기능 전에도 열려 있던 구멍). `trg_members_guard_join_date`(BEFORE UPDATE, SECURITY INVOKER)로 막는다 — 운영진 직접 수정과 SECURITY DEFINER 서버 경로는 통과. `is_active` 게이트(20260821010000)와 같은 패턴이고 같은 이유로 RLS·컬럼 REVOKE 로는 안 된다.
  - **'정원 초과'의 정의** = 확정 행을 `position` 오름차순으로 줄 세워 앞 `capacity` 명이 정원 안(base), 그 뒤가 초과분. 증분 경로(`rn > capacity`)와 그리디(`v_cc >= capacity` 이후 분기)가 같은 정의라 런타임 판정과 재계산이 항상 일치한다. 운영진이면서 신규인 사람이 운영진 예산으로 들어오면 **그 행도 '초과 확정 신규'로 센다**(증분·그리디 양쪽 동일).
  - 클라이언트 미러 `splitConfirmedByCapacity` 는 base/초과 분할까지는 같은 정의지만, 초과분을 `freepassOps`/`freepassNewbies` 로 **배타 분류**한다 — 한 사람이 두 번 보이지 않게 하려는 **표시용**이다. 서버의 신규 예산 집계와 다르므로 `freepassNewbies.length` 를 '남은 신규 자리'로 읽으면 안 된다.
  - 게스트는 대상 아님 — 게스트 행은 재사용되어 `created_at` 이 과거일 수 있고(`20260819030000`), 게스트 상한은 별도 규칙이다.
  - 게이트는 **장소 플래그**(`session_op_free`)다. 회차 단위로 총액을 0 이하로 둔 무부과 회차(`sessions.court_fee <= 0`, `20260823000000`)는 돈은 0원이지만 프리패스 대상이 **아니다** — 운영진 프리패스와 같은 게이트를 쓰기 위한 의도된 선택이다.
  - 헬퍼 `session_newbie_grace(session_id, member_id)`. 반영 지점: `join_session` · `promote_next_waitlisted` · `set_late_minutes`(정원외늦참 복귀) · `set_session_capacity`(그리디).
  - 승격 루프 종료성: 매 호출마다 초과 확정 신규를 다시 세므로 2명이 되는 순간 신규 분기가 닫힌다(운영진 분기는 총수 2, 정원 분기는 count=capacity 에서 멈춤).
- **우선참여권(대기 포인트 티켓) — 세 번째 프리패스** (2026-09-04, 마이그레이션 `20260904000000`)
  - 목적: 오래 대기했는데 계속 못 들어오는 회원의 구제책. **대기인 채로 회차가 마감되면 +1점**, **7점**을 모으면 만석 회차에 **정원 외 자리**로 확정할 수 있다. 잔액은 0~7이고 7에서 더 쌓이지 않는다(티켓은 최대 1장 = '잔액이 7인 상태').
  - **자리 성격은 신규 프리패스와 같다**(`capacity_exempt = true` + `exempt_reason = 'ticket'`). 정원 안 빈자리를 소비하지 않으므로 **티켓 사용자가 대기 1번의 승격 기회를 빼앗지 않는다.**
  - **게이트가 다르다 — 모든 일정에서 쓸 수 있다.** 운영진·신규가 쓰는 `session_op_free`(부과 없는 일정) 게이트를 티켓에는 걸지 않는다. 대기가 실제로 밀리는 것이 인기 있는 정규 일정이라 거기서 못 쓰면 구제책이 되지 않기 때문이다. 대관비는 참석했으니 정상 부과된다(`dues_court_targets` 는 `capacity_exempt` 를 보지 않으므로 코드 변경 없이 자동 포함).
  - **회차당 2명** (`wait_ticket_session_cap()`). 게스트 상한과 같은 단위이며, 같은 규약으로 **카운터 락 안에서 `count(*)`** 로 판정한다. 세는 대상은 `status='confirmed' AND exempt_reason='ticket'` 인 **살아 있는 행**이라 취소하면 슬롯이 저절로 돌아온다(저장 카운터 없음 = 드리프트 없음).
  - **명시적 사용**: `join_session(p_session_id, p_use_ticket)`. 시그니처가 넓어졌으므로 구 1인자 함수를 **`drop function` 후 재생성**했다(오버로드가 남으면 PostgREST 가 후보를 못 골라 참석 신청 전체가 죽는다). 분기 순서상 정원 여유·운영진·신규로 들어갈 수 있으면 티켓을 **소모하지 않는다**.
  - **부여 지점은 본인이 누른 순간뿐** — `join_session`, `set_late_minutes`(정시 복귀 시 이미 지불한 자리 되찾기, **재차감 없음**). **`promote_next_waitlisted` 에는 티켓 조건이 없다(재론 금지)** — 넣으면 정원 안 대기 1순위가 티켓 보유자에게 영구 추월당해, 대기 구제가 목적인 기능이 대기 1번을 막는 역설이 된다(신규 프리패스와 같은 starvation 논증).
  - **−1 차감**: 확정 자리를 **본인이 당일에 취소**하면 −1(하한 0). 판정선은 회계와 같은 단일 술어 `dues_is_day_cancel_chargeable`(당일 KST + 확정 후 1시간 유예)이다. **운영진 제거는 벌하지 않는다**(귀책이 불분명). 노쇼는 회차 종료 시 `confirmed` 인데 `session_players` 행이 없는 경우로 판정한다 — 시작 RPC 가 확정자 전원을 시드하므로 부재는 '운영진이 보드에서 뺐다'는 뜻이다. `matches` 가 1건도 없는 회차(열리지 않은 유령 회차)는 통째로 건너뛴다.
  - **환원**: 사전 취소·운영진 제거·회차 취소(`cancelled`)는 7점 전액 환원. **당일 취소·노쇼는 몰수**(C10). 이중 환원은 `wait_ticket_spent`(spend 건수 > refund 건수)가 스스로 막는다.
  - **잔액은 세지 않고 기록한다**: `wait_point_ledger` 가 append-only 권위이고 `wait_point_balances` 는 파생 캐시다(`session_counter_sync` 와 같은 자가 치유). 원장의 `delta` 는 요청량이 아니라 **clamp 후 실제 적용량**이라 잔액 = `sum(delta)` 가 항상 성립한다.
  - **멱등은 인덱스가 만든다**: 부분 유니크 `(member_id, session_id, kind) where kind in ('earn','penalty')`. 종료 트리거는 `closed→open→closed` 재전이에서 다시 발화하고 소급 백필도 같은 경로를 타므로, 트리거 WHEN 절이 아니라 원장 제약이 재실행 면역을 준다. `spend`/`refund` 는 **일부러 제외** — 환원 뒤 같은 회차에 다시 쓰는 경로가 삼켜지면 '공짜 재사용'이 된다.
  - 종료 훅 `trg_session_wait_points_on_close` 는 `search_path=''` + 본문 전체 예외 격리다. 포인트 실패가 `sync_schedule_occurrences` A단계를 죽이면 회차 공개가 전면 중단된다(2026-07-26 실사고).
  - 소급 적립: **2026-08-01 이후 종료된 회차**만 대상(운영자 확정). 노쇼 차감은 소급하지 않고 알림도 보내지 않는다.
  - 클라 미러: `src/lib/schedule/waitStatus.ts` 의 `POINT_MAX`·`TICKET_COST`·`TICKET_SESSION_CAP` 과 `splitConfirmedByCapacity.freepassTickets`. 사유를 안 보면 티켓 자리가 화면에 **'신규'로 거짓 표기**된다.
- 알림 INSERT는 **같은 트랜잭션**에서 → 승급 롤백 시 알림도 미발생(불일치 차단).
- `cancel_attendance`는 이미 취소/미신청이면 예외 없이 `RETURN`(멱등).

### 5.2 기존 RPC 가드 (Phase 9)

`assign_match` · `complete_match` · `set_player_resting` · 콕 체크 함수에 `if not is_admin() then raise exception 'forbidden'; end if;` 주입. **전 운영진 로그인 완료 후에만.** 콕 체크는 운영진 전용이므로 본인검증 RPC 불필요.

---

## 6. 스냅샷 격리막 (왜 보드가 안 바뀌나)

- 편성 추천(`rankCandidates`, `recommendPool`), 매치(`matches`), 동반이력(`pair_history`)은 전부 `session_players`의 `gender`/`skills` **사본**만 읽는다.
- `members`는 권위 소스, `session_players`는 **세션 시작 시점의 사본**. 회원이 나중에 프로필을 고쳐도 과거 세션 기록·진행 중 편성 공정성은 흔들리지 않는다.
- 따라서 알고리즘·보드 코드 **0변경**. `startSession` row 빌더에서 `member_id` 추가 + `gender/skills`를 members에서 복사하는 것만 바뀐다.
- `docs/TEAM_GENERATION_RULES.md` 갱신 의무는 발생하지 않음(입력 출처만 members로 바뀜). `recommendPool.ts`에 "입력 출처=members 스냅샷" 주석만 추가 권장.

---

## 7. RLS 정책 계약

- **신규 테이블은 처음부터 좁게**(anon_all 부채를 새로 만들지 않음). 쓰기는 거의 SECURITY DEFINER RPC 경유.
- **기존 4테이블(sessions·session_players·matches·pair_history)만** anon_all → RBAC 단계 전환 대상(Phase 9).
- 최종 상태(결정 5): **로그인 사용자 read + 운영진 write**.

| 테이블 | SELECT | INSERT/UPDATE/DELETE |
|--------|--------|----------------------|
| members | authenticated 전체 | 본인(`id = current_member_id()`) update / admin write |
| user_roles | admin (또는 본인 역할만) | admin only |
| places | authenticated | admin only |
| sessions | authenticated | admin write (RPC) / 최종 전환 Phase 9 |
| session_players | authenticated | admin write (RPC) / 콕 체크 포함 |
| matches · pair_history | authenticated | RPC(admin) |
| attendances | authenticated | RPC only(join/cancel/promote) — 직접 write 정책 없음 |
| session_counters | (차단 또는 admin) | RPC only |
| notifications | 본인(`recipient_member_id = current_member_id()`) | read_at 표시만 본인 update / INSERT는 RPC |
| push_subscriptions | 본인 | 본인 CRUD |

- 과도기(Phase 9 진행 중): 기존 4테이블은 `public_read (SELECT, USING true)`를 먼저 추가해 읽기를 유지하고, 쓰기만 좁힌 뒤, 전원 로그인 완료 후 read를 authenticated로 조이고 anon_all DROP.

---

## 8. Realtime 채널

- 기존: `session-bc:{id}`(broadcast), `session-meta:{id}`(postgres_changes). (`app-session-watch`는 2026-07 제거 — §8.1.)
- 추가:
  - `notifications` postgres_changes (filter `recipient_member_id`) → 앱내 알림 1차(toastStore 연결).
  - 일정 목록/참석 현황: `attendances` 또는 sessions 변경 구독(필요 시).
- 웹푸시(보조): `notifications` INSERT → Database Webhook(pg_net) → `send-push` Edge Function(`@negrel/webpush`) → 410/404 시 `push_subscriptions` 정리. (Phase 8)

### 8.1 Realtime 메시지 감축(2026-07, 마이그레이션 `20260717000000`)

Supabase Realtime 메시지 초과(주범: 사용자 활동과 무관한 연속 트래픽)를 줄이기 위해 편집 락 모델을 단순화하고 중복 브로드캐스트를 제거했다.

- **편집 락 = sticky 소유 + 하트비트 폐기**: 기존엔 편집자가 lease(20s)를 하트비트(7s)로 계속 갱신 → sessions row UPDATE가 접속자 전원에게 팬아웃(연속 최대 트래픽). 이제 락은 `editor_client_id`(신원)만으로 결정되고 **lease 만료로 자동 해제되지 않는다**(`computeLockFromRow` 신원만; `board_claim_editor`/`board_save_drafts`/`board_assert_editor` CAS에서 `editor_lease_until < now()` 조항 제거). 하트비트 제거로 연속 UPDATE 스트림 소멸.
  - **점유 = 진입 1회 자동 + 이후 수동(2026-07)**: 보드 편집(콕체크·경기 조작·드래그)이 전부 `isEditor` 게이팅이라 opener는 editor여야 한다. 그래서 **세션을 연 사람이 자유 보드에 들어오면 진입 시 1회 자동 점유**(`useSessionBoardEffects`의 `autoClaimTriedRef` one-shot; 자유+혼자+운영진일 때 `claimEditingIfFree`). **단 "진입 1회만"** — 이후 편집자 이탈로 free가 돼도 재점유하지 않는다. 즉 **연속 재점유(`maybeClaimIfAlone` + reeval 타이머 + 창복귀/presence 재점유)는 폐기** → "혼자 남으면 자동 점유→남이 뺏고→반복"하던 호깅/플래핑 방지. 진입 이후 편집권 이동은 `board_takeover_editor`("편집 권한 가져오기") / `board_handoff_editor`(명시 양도)로만. crash로 붙잡힌 락도 takeover 한 번으로 회수. 뺏긴 편집자는 `EditorTakenNotice` 다이얼로그로 통지(명시 takeover일 때만). ⚠️ 진입 자동점유를 통째로 없애면 opener가 콕체크 등 편집을 못 함(2026-07 회귀 → 진입 1회로 복구).
  - **`board_assert_editor`(경기 RPC 가드)**: 이미 편집자면 sessions WRITE 없이 통과(매 경기조작 lease 갱신 팬아웃 제거). 자유면 self-claim(운영진만), 남이 보유면 `'not editor'`. 단일 편집자 불변식은 그대로(서버 CAS·신원 검사).
  - `editor_lease_until` 컬럼은 잔존하나 만료 판정에 미사용(향후 정리).
- **중복 브로드캐스트 제거**: `player_updated`·`board_drafts_updated` 브로드캐스트를 삭제. 각각 `session_players` postgres_changes / sessions-row UPDATE(board_drafts+version)라는 **권위 경로와 중복**이었다(같은 버전 리듀서로 수렴). 발신자 로컬 즉시 반영은 `applyBroadcast` 직접 호출로 유지(네트워크 미사용). `session-bc` 잔여 브로드캐스트: `match_started`/`match_completed`/`match_roster_updated`/`session_refresh_required`.

### 8.2 자동참여 폐지 + `app-session-watch` 제거(2026-07)

기존엔 앱을 켠 **모든 회원**이 `app-session-watch`(sessions 테이블 **무필터** postgres_changes)를 앱 전역 구독해, 세션이 활성화되면 자동으로 보드로 끌려 들어갔다(`applySession`→`/session`). 이 무필터 구독이 세션의 *모든* 변화(편집·경기·카운터)를 접속 전원에게 팬아웃하는 큰 비용원이었는데, 정작 필요한 건 시작/종료 신호뿐이었다.

- **자동참여 폐지**(기획 결정): 세션 시작 시 회원을 자동 소환하지 않는다. `app-session-watch` 구독과 앱 마운트 시 자동 `/session` 이동을 **제거**. 진행 중 보드 입장은 **Home의 '진행 중 세션 입장' 버튼(수동)** 으로만 — `sessionMeta`가 있으면 노출되고(마운트/포그라운드 복귀/새로고침 시 `checkActiveSession`이 세팅), 탭하면 `/session`으로 이동해 그때 세션 채널을 구독한다.
- **종료 처리**: 보드에 들어가 있는 사용자는 `session-meta` onEnd가 이탈시키므로 앱 전역 감시 불필요. 세션을 시작한 운영진은 자기가 명시적으로 `/session`으로 이동(유지).
- **알려진 소소한 트레이드오프**: 회원이 세션 진행 중 앱을 열어 `sessionMeta`가 로드된 뒤 입장하지 않은 채 세션이 끝나면 '입장' 버튼이 잠깐 남을 수 있다(탭하면 `session-meta` onEnd가 곧바로 홈으로 되돌려 자기교정). 실시간 push가 없으므로 진행 중 세션은 회원이 Home을 열거나 새로고침할 때 나타난다(즉시 알림 아님 — 자동참여 폐지의 의도된 결과).
- 이 제거로 Tier2 계획의 **E(sessions↔session_runtime 테이블 분리)는 불필요**해졌다(앱 전역 팬아웃 자체가 사라짐).

---

## 9. 인증 플로우 계약

- 클라이언트 `createClient` 옵션: `flowType: 'pkce'`, `detectSessionInUrl: true`, `persistSession: true`, `autoRefreshToken: true`.
- 카카오(Phase 1): `signInWithOAuth({ provider: 'kakao', options: { redirectTo: <GitHub Pages base URL> } })`. Supabase Redirect allow list + Site URL에 base 경로 등록. 404.html SPA 폴백 유지.
- 첫 로그인 시 `members` upsert(auth_user_id 기준) — **단일 지점**에서만(중복 호출 금지).
- admin 시드: `sam@dooub.com` 계정을 `user_roles`에 admin으로.
- 네이버(Phase 10): `naver-auth` Edge Function이 콜백 받아 userinfo `{response}` 언랩 → `admin.createUser`(선행) → `generateLink(magiclink)` → 클라이언트 `verifyOtp`. service_role 키는 **Edge Function 환경변수에만**(클라 번들 금지).

---

## 10. 10단계 마이그레이션 순서 (무중단)

| Phase | 산출 | 의존 | 위험 |
|-------|------|------|------|
| 0 | **이 계약서** | — | 없음 |
| 1 | 카카오 로그인(RLS 무변경) | 0 | 낮음 |
| 2 | members · user_roles · `is_admin()` · `current_member_id()` + admin 시드 | 1 | 낮음 |
| 3 | session_players.member_id + 스냅샷 빌더(백필 부담 낮음) | 2 | 중간 |
| 4 | sessions 일정화(상태기계) + places + 시간대(Asia/Seoul) | 2 | 낮음 |
| 5 | attendances · session_counters · notifications + join/cancel/promote RPC | 4 | 중간 |
| 6 | **브릿지** `bridge_confirmed_to_players` | 5,3 | 중간 |
| 7 | 카풀 표시(carpool_role) + 집결 공지 + 운영진 집계 뷰 | 5 | 낮음 |
| 8 | Service Worker + 웹푸시(보조) + send-push Edge Function | 5 | 낮음 |
| 9 | **기존 4테이블 RLS 전환 + RPC is_admin() 가드** | 5(전원 로그인) | **높음** |
| 10 | 네이버 OAuth(Edge Function) | 9 | 낮음 |

- 마이그레이션 파일은 `supabase/migrations/`에 타임스탬프 규약(`YYYYMMDDHHMMSS_*.sql`)으로 추가.
- Phase 9는 **전 운영진 로그인 + admin 시드 확인 + 비활성 세션 시간대**에만 적용, 직후 편성 1회 스모크 테스트, 문제 시 즉시 롤백(anon_all 재생성 / 가드 없는 RPC `create or replace`).

---

## 11. 향후/보류

- 카풀 매칭 보조 툴(누가 누구 차에) — **라이트 구현 완료**: 운영자 지도 편성 + 공지 텍스트 생성·복사(`sessions.carpool_groups`, `CARPOOL_MATCHING_DESIGN.md`). 확장 여지: 인앱 탑승자 결과 화면 · 배정 푸시.
- 한 일정 다중 세션(오전/오후) — 현재 1 sessions 행 = 1 모임으로 충분(하루 여러 모임은 행 여러 개).
- Google Sheets/googleAuth 완전 폐지 시점 — sheet_player_id 백필 충분 후 점진.
