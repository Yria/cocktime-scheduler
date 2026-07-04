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
| 8 | **정원 상향 시 자동 승급** | `promote_waitlist` RPC |
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
| `attendances.status` | `'confirmed'` `'waitlisted'` `'cancelled'` | confirmed/waitlisted/cancelled 로 동결(going/waitlist 표기 금지) |
| `attendances.carpool_role` | `'none'` `'can_drive'` `'need_ride'` | 기본 `'none'` |
| `notifications.type` | `'promoted'` `'session_cancelled'` `'session_closed'` `'carpool_muster'` `'noshow'` | 신규 타입은 여기 추가 |

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
  is_active     boolean not null default true,
  sheet_player_id text unique,                         -- Sheets player-N 매핑 키(폐지 후 deprecated)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

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
- **`sync_schedule_occurrences()` RPC**(SECURITY DEFINER, authenticated 호출 — 앱 로드 시 멱등 실행): A) 어제 이전 미진행 draft/open → `closed`, B) 누락 회차 `draft` 생성, C) 미오버라이드 draft 를 규칙 최신값으로 갱신, D) 규칙 변경/비활성으로 무효해진 미오버라이드 draft 삭제, E) **scheduled_at(KST 날짜)이 오늘~공개 상한이면 `draft`→`open`**. 공개 상한은 `reveal_horizon_kst_date()`: 공개 시점은 **매주 일요일 18:00 KST**이고 그 시점이 지나면 "직전 공개 일요일 +7일"(=다음 일요일)까지 한번에 공개(일요일 18:00 이전엔 이번 일요일까지만). 즉 rolling "1주 전 노출"이 아니라 **일요일 저녁 일괄 공개**(마이그레이션 `20260703010000`). pg_cron 잡 `reveal-weekly-sessions`(`0 9 * * 0` UTC = 일요일 18:00 KST)가 앱 접속 없이도 정각에 sync 를 실행해 open 전환+`session_open` 푸시를 보장한다.
- **상태기계 활용**: `draft`(운영진만, 미노출) → `open`(노출·참석시작, `join_session` 진입 조건) → `active`(보드) → `closed`/`cancelled`. 명절 등 예외는 해당 회차만 `cancelled`(행 유지 → 재생성 방지) 또는 개별 `is_overridden=true` 수정.
- **참여 가능 판정 = `status='open'`**: `join_session`·`add_guest_attendance`는 status(+아래 종료 가드)만 검사한다. open 은 sync E단계(공개 창 안)만 만들므로 **status 가 노출·참여의 단일 진실원천** — 공개 창 밖 open 은 운영진의 의도적 개별 조작뿐이라 참여를 막을 이유가 없다. 과거엔 노출 시간 가드(`scheduled_at <= now()+7d`)를 이중으로 재검증했으나(`20260623040000` 도입 → `20260703010000` 공개 상한과 일치 → `20260703020000` rolling 롤백), status 와 시간 가드의 이중 기준이 노출 규칙 변경 때 전환기 회귀를 낳아 `20260703040000`에서 **제거**. 시작 시각이 지난 `open` 회차의 늦참(late join)은 홈 진행 하이라이트(아래)와 함께 의도적으로 허용한다.
- **종료(`ends_at`) 상한 가드**: status 검사에 더해 **종료 시각이 지나면 마감**한다 — `ends_at is not null and ends_at <= now()` 이면 `session ended` 예외. `join_session`·`add_guest_attendance`·`start_session_from_schedule`(경기 시작) 세 RPC 모두에 적용해 종료된 일정은 회원·운영진 누구도 참석/게스트신청/경기시작을 할 수 없다. `ends_at`이 NULL인 즉석/미정 회차는 가드 통과(차단 안 함). sync A단계(어제 이전 draft/open→closed)는 일(日) 단위 정리라, 당일 종료 직후의 미세 구간은 이 가드 + 홈 필터(아래)가 실시간으로 막는다. 마이그레이션 `20260624030000_attendance_end_time_guard.sql`.
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
- **홈 진행 하이라이트**: 시작 시각(`scheduled_at`)이 지난 `open` 회차는 목록 맨 위로 분리·하이라이트되고 운영진에게 `세션 시작 · 보드 열기` 버튼 노출. 시작 전에는 버튼을 숨긴다(시작 이후 **종료 시각 전까지** 유지). 30초 tick 으로 도달 감지.
- **종료 일정 숨김(홈)**: 종료 시각(`ends_at`)이 지난 `open` 회차는 홈 목록에서 제외한다(`isPastSchedule`, 30초 tick 으로 재평가) — 위 `ends_at` 상한 가드와 동일 기준의 클라이언트 미노출 처리. `active`(진행중) 회차는 종료 시각과 무관하게 유지(운영 중 세션을 목록에서 지우지 않음). 30초 tick 윈도우의 stale 클릭은 서버 `session ended` 가드가 막고, 홈은 이를 "이미 종료된 일정입니다"로 표시.

---

## 5. RPC 계약 (시그니처 + 동작 + 동시성)

모든 RPC는 `SECURITY DEFINER SET search_path = ''`. 잠금 순서 통일로 데드락 회피: **sessions(검증) → session_counters(직렬화) → attendances**.

| RPC | 시그니처 | 권한 | 동작 |
|-----|---------|------|------|
| `join_session` | `(p_session_id bigint) → attendances` | 로그인 회원 | 정원 여유면 confirmed, 아니면 waitlisted. 중복신청 차단, 취소후재신청은 같은 행 갱신. 참여 가능 = `status='open'` + **종료 상한(`ends_at<=now()`→`session ended`)** 가드 |
| `cancel_attendance` | `(p_session_id bigint) → void` | 로그인 회원(본인) | 본인 취소(멱등). 카풀 의향(`carpool_role`/`carpool_seats`) 함께 해제(재참석 시 부활 방지). confirmed였으면 카운터 감소 + 대기 1순위 자동 승급 + 알림 |
| `promote_waitlist` | `(p_session_id bigint) → int` | 운영진 | 정원 상향 후 여유만큼 대기자 일괄 승급 + 각자 알림. 승급 수 반환 |
| `cancel_session` | `(p_session_id bigint) → void` | 운영진 | status='cancelled' + 전체 참석자 알림 |
| `bridge_confirmed_to_players` | `(p_session_id bigint) → void` | 운영진 | **Phase 6**: confirmed 참석자를 session_players로 일괄 INSERT(members→스냅샷, gender NULL 가드). 보드 로직 0변경 |
| `set_session_status` | `(p_session_id bigint, p_status text) → void` | 운영진 | 상태 전이(draft→open→active→closed) |

### 5.1 join_session / cancel_attendance 동시성 규칙 (핵심)

- **직렬화 지점은 `session_counters` 행의 `FOR UPDATE` 단독.** sessions는 status 검증용 `SELECT`(필요 시 `FOR SHARE`)만 — 편성 경로(sessions UPDATE)와 락 분리.
- 카운터 행 보장: `INSERT … ON CONFLICT (session_id) DO NOTHING` 후 `SELECT … FOR UPDATE`.
- 정원 판정은 **`count(*)` 금지**, `session_counters.confirmed_count`만 권위.
- `position = nextval('attendance_position_seq')` — 경쟁 없는 단조 순번. 대기 1순위 = `status='waitlisted' ORDER BY position ASC`.
- 자동 승급: `… FOR UPDATE SKIP LOCKED LIMIT 1` 로 1순위 선택(동시 취소 시 중복 승급 방지).
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

- 기존: `session-bc:{id}`(broadcast), `session-meta:{id}`(postgres_changes), `app-session-watch`.
- 추가:
  - `notifications` postgres_changes (filter `recipient_member_id`) → 앱내 알림 1차(toastStore 연결).
  - 일정 목록/참석 현황: `attendances` 또는 sessions 변경 구독(필요 시).
- 웹푸시(보조): `notifications` INSERT → Database Webhook(pg_net) → `send-push` Edge Function(`@negrel/webpush`) → 410/404 시 `push_subscriptions` 정리. (Phase 8)

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
