-- 하드삭제로 사라진 회원 1명(이한비)을 복구하고 2026-07 부과를 되살린다.
--
-- 무엇이 없어졌나 (실측 2026-08-19)
--   · members 행이 없다. 이름에 '한'이 든 회원은 게스트 한충희 2행뿐이고 이한비는 0행.
--   · 그런데 보드 이력에는 남아 있다 — session_players 4행(sessions 94·108·117·181)이
--     `player_id = 'b22094fb-eca9-4226-9895-0a27a812a53c'`(옛 member uuid) + `member_id = null`.
--     같은 세션의 다른 사람은 전원 member_id 가 채워져 있어(94: 18행 중 15, 108: 24행 중 23,
--     117: 17행 중 16) 이 null 은 "원래 있었는데 지워졌다"는 FK on delete set null 흔적이다.
--   · 적요에 이름이 든 입금 5건이 전부 `unmatched` — 6월 3건(6/7·6/21·6/29 각 6,000)과
--     **7월 2건: id 2 = 2026-07-12 '7월회비 이한비' 5,000 / id 8958 = 2026-07-26 '0726이한비' 6,000.**
--     운영진이 본 "7월 정산에 이한비 두 건이 풀려 있다"가 정확히 이 2건이다.
--
-- 원인은 하드삭제 CASCADE(`20260819010000_member_soft_delete_only.sql` 에서 경로 봉인).
-- 이 파일은 그 사고의 데이터 복구다.
--
-- 복구 방침
--   · **옛 uuid 를 그대로 되살린다.** session_players.player_id 가 그 uuid 라서, 같은 값으로
--     넣으면 보드 이력이 새 행을 만들지 않고 그대로 이어붙는다(사람 유니크성 보존).
--   · `is_active = false` — 실제로 나간 사람이다. 명단·편성 후보에 다시 띄우지 않는다.
--     (회비는 2026-08-19 정책상 비활성에도 부과된다. 앞으로 걷지 않기로 하면 [면제] 를 누른다.)
--   · `membership_started_at = 2026-06-01` — 6월부터 대관비를 내고 있었고, 회비 룰
--     (가입월+offset 다음 달부터)에 넣으면 첫 회비 달이 정확히 2026-07 이 된다. 실제 입금
--     '7월회비 이한비'와 일치하므로 이 값이 실측에 부합한다.
--   · 개인정보(전화·거주지·생년·사진)는 복구하지 않는다 — 남은 근거가 없고 정산에 필요 없다.
--
-- 금액은 재계산하지 않는다
--   · 세션 108 은 `sessions.court_fee`(실제 총액)가 null = **정액 모드**이고 기존 22건 전부 6,000원.
--     대상이 23명이 되어도 엔빵 분모가 없으므로 다른 사람 금액이 흔들리지 않는다.
--   · 세션 94·117 은 성남실내체육관(`places.charges_court_fee = false`, 부과 없는 일정)이라
--     대관비 부과가 애초에 없다 → 만들지 않는다. 세션 181 은 날짜 없는 레거시 세션.
--   · 6월 입금 3건은 서비스 시작월(2026-07) 이전이라 통장 정리 대상이 아니다 — 미분류로 둔다.
--
-- 남은 수작업(운영진): 정산함 2026-07 에서 위 입금 2건의 납부자로 이한비를 골라 배분하면 7월이 닫힌다.

-- ── 1. 회원 행 복구 ──────────────────────────────────────────────────
insert into public.members (id, name, gender, skills, is_guest, is_active, membership_started_at, created_at)
values ('b22094fb-eca9-4226-9895-0a27a812a53c', '이한비', 'F', '{}'::jsonb, false, false, '2026-06-01', '2026-06-01')
on conflict (id) do nothing;

-- ── 2. 보드 이력 재연결 ──────────────────────────────────────────────
-- player_id 가 곧 옛 member uuid 인 행만 되돌린다(레거시 'player-NN' 행은 원래 member_id 가 없다).
update public.session_players
set member_id = 'b22094fb-eca9-4226-9895-0a27a812a53c'
where player_id = 'b22094fb-eca9-4226-9895-0a27a812a53c'
  and member_id is null;

-- ── 3. 2026-07 부과 복구 ─────────────────────────────────────────────
-- 회비: 룰(dues_generate_monthly)이 내놓을 값과 같은 금액을 dues_settings 에서 읽어 쓴다.
insert into public.dues_charges (kind, member_id, period_ym, amount_due)
select 'monthly_fee', 'b22094fb-eca9-4226-9895-0a27a812a53c', '2026-07', s.monthly_fee
from public.dues_settings s
where s.id = 1
on conflict (member_id, period_ym) where period_ym is not null do nothing;

-- 대관비: 세션 108(2026-07-26 TK배드민턴아레나) 정액. 대상 판정은 손으로 쓰지 않고
-- dues_court_targets 에 맡긴다 — 2번에서 board_added 로 잡히므로 나중에 재생성해도 결과가 같다.
insert into public.dues_charges (kind, member_id, session_id, amount_due, payer_hint, is_day_cancel)
select 'court_fee', t.member_id, 108, 6000, t.payer_hint, t.is_day_cancel
from public.dues_court_targets(108, false) t
where t.member_id = 'b22094fb-eca9-4226-9895-0a27a812a53c'
on conflict (member_id, session_id) where session_id is not null do nothing;

-- ── 4. 감사 ─────────────────────────────────────────────────────────
insert into public.dues_audit_log (actor_member_id, action, detail)
select null, 'restore_hard_deleted_member',
       jsonb_build_object(
         'member', 'b22094fb-eca9-4226-9895-0a27a812a53c',
         'name', '이한비',
         'restored_charges', (select jsonb_agg(jsonb_build_object('charge', id, 'kind', kind, 'ym', period_ym, 'session', session_id, 'due', amount_due))
                              from public.dues_charges
                              where member_id = 'b22094fb-eca9-4226-9895-0a27a812a53c'),
         'unmatched_bank_tx', jsonb_build_array(2, 8958),
         'why', '하드삭제 CASCADE 로 부과·배분이 사라져 2026-07 입금 2건이 미분류로 남아 있었다.'
       )
where exists (select 1 from public.members where id = 'b22094fb-eca9-4226-9895-0a27a812a53c');
