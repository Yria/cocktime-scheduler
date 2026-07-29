# 실전 경기로그 분석 런북

> "최근 세션 실로그로 알고리즘/운영을 분석해줘" 요청 시의 표준 절차.
> 2026-07 팀매칭 개편(그룹 재결성 회피·ghost 자동편성, `TEAM_GENERATION_RULES.md`) 검증 과정에서
> 확립된 방법론이며, **아래 함정 체크리스트는 전부 실제 감사에서 한 번씩 터졌던 것들**이다.

## 1. 데이터 접근

Supabase REST(PostgREST)로 읽기 전용 조회한다. 키는 `.env.local`의 `SUPABASE_SERVICE_ROLE_KEY`.

```bash
KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d= -f2)
URL=https://sfxbrheavypjsjgbzjom.supabase.co/rest/v1
# 헤더 두 개 모두 필요
curl -s "$URL/matches?session_id=eq.108&status=eq.completed&order=started_at.asc" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

핵심 테이블·필드:

| 테이블 | 분석에 쓰는 필드 |
|---|---|
| `sessions` | `id`, `court_count`, `started_at`, `ended_at`, `status`, `match_assign_count` |
| `matches` | `session_id`, `court_id`, `game_type`, `team_a_p1..team_b_p2`(session_players.id), `status`, `started_at`, `ended_at`, **`player_snapshot`**(4인 `{id,name,gender,skills:{grade}}`) |
| `session_players` | `id`, `name`, `gender`, `skills{grade}`, `game_count`, `status`, `joined_at`, `wait_since` |

**★ 등급은 반드시 `player_snapshot`의 "당시" 등급을 쓴다.** 사후 로스터 등급은 세션 중 변경분이 소급 적용돼 지표를 왜곡한다(실사례: 2026-07-26 김길환이 세션 후반 3→1로 변경 — 로스터 값 1을 쓰면 스프레드가 과대측정됨). `joined_at`은 세션 open 시 일괄 생성이라 실제 도착 시각이 아님에 주의.

구(舊) 데이터 참고: `pair_history` 테이블은 2026-07-27 삭제됨(마이그레이션 `20260727090000`) — 동반 이력은 완료 `matches`의 4인 구성에서 파생한다.

## 2. 표준 지표 정의

경기는 **완료(ended_at) 순** 정렬 후 계산한다.

- **overlapK / reunion4**: 각 경기의 4인 집합 vs *이전 모든 완료 경기*의 최대 교집합이 K 이상인 경기 비율. K=2/3, 4(=reunion4, 완전 재결성). overlap2 ⊇ overlap3 ⊇ reunion4.
- **pairs_met_3plus**: 3회 이상 함께 뛴 쌍 ÷ C(참가자 수, 2).
- **개인 2인 겹침**: 1인당 "2회 이상 동반한 상대 수", "동일인 최다 동반 횟수", "3회+ 동반자 보유 선수 비율".
- **avg_distinct_coplayers**: 1인당 함께 뛴 고유 인원.
- **판수 형평**: 세션 종료 시 game_count의 std·range(max−min).
- **스프레드**: 경기 4인 등급 max−min의 평균, spread≤2 경기 비율.
- **tier hard-game**: 구간 low 1-3 / mid 4-6 / high 7-10. hard = 나머지 3인 전원 등급 ≥ 본인−1. **본인 등급의 단조 함수이므로 tier 간 비교 금지** — 같은 tier의 시점 간/시나리오 간 비교만 유효.
- **노출 분포**: 동반자 등급 − 본인 등급이 ≤−2 below / ±1 mid / ≥+2 above. **절대 목표(예: 3:4:3)와 비교하지 말고, 같은 로스터의 무작위 4인 추출 기대치(random feasible) 대비로 평가** — 로스터 등급 분포(종형)가 편차의 주범이다.
- **대기**: 본인 경기 종료 → 다음 경기 시작 간격(분). 합류 전·세션 종료 후 구간 제외.

## 3. 실로그 vs 알고리즘 시뮬 비교

### 하네스 원칙
- 점수 로직을 **재구현하지 말고 `src/lib/teamSelection/*` 실제 함수를 import** 한다(tsx/bun 실행, 외부 import는 전부 type-only라 가능). 포팅 오차가 최대 리스크.
- ctx 형태: `groupHistory = {matchId, members(4인 id)}[]`, `lastGameType`, `playingIds`. 자동편성은 `autoFillTeammates(confirmed, pool, ctx, count, undefined, { maxPlaying: 1 })`.
- `Math.random`·`Date.now`를 **시드 PRNG·가상 클록으로 몽키패치**(pairPlayers 동점 랜덤·W_WAIT 분당 가중 재현에 필수).
- 운영 흐름 재현: t=0 코트 순차 채움 → 완료 즉시 그 코트 자동편성 → ghost는 본인 경기 종료 후 팀 합류 → 완료 시 gameCount+1·waitSince=now·groupHistory append. 경기 시간 분포를 명시(예: 10~15분 균등)하고 실제 평균(≈11분)과의 차이를 wallclock 해석에서 분리한다.
- 과거 하네스는 세션 스크래치패드(휘발)에 있었음 — 재구축 시 이 문서가 기준.

### ★ 함정 체크리스트 (전부 실제 감사에서 적발된 것)
1. **시드별 로스터 셔플 필수** — 정렬 고정 로스터 + stable sort 동점 타이브레이크가 특정 집단(예: 여성 먼저)에 계통 편향을 만든다. 셔플 없이는 성별/등급 효과 결론이 오염된다.
2. **우측절단 median·표본 min 인용 금지** — "60판 내 미발생"이 절반쯤이면 median이 계단식으로 튀고, min은 시드 수에 단조 감소한다. p01/p05/p25/p75/p95를 쓴다.
3. **표본 수 확인** — 비율 지표는 200시드로 부족할 수 있다(SE = sd/√n 명시, 필요 시 1000+). 소표본 셀(n<30)은 인용 금지.
4. **actual은 1회 실현치** — sim 분포의 sd 대비 z(또는 %seeds<actual)로 유의성을 표기하고, |z|<2는 tie로 판정한다.
5. **귀무기준은 조건부로** — 예: "겹친 3인의 여성 쏠림"은 로스터 성비가 아니라 *실제 경기 성별 구성* 조건부 기대치와 비교해야 한다.
6. **스냅샷 등급 사용** (§1 참조).
7. 실로그에는 **수동 개입·휴식·지연이 섞여 있다** — 대기/시간 지표는 actual이 구조적으로 유리하고, 겹침/다양성 지표는 불리함을 해석에 명시한다.

## 4. 기준점 (2026-07-26 세션 108, 감사 교정 수치)

24명·4코트·50경기. actual vs 새 알고리즘 완전자동(300시드):

| 지표 | actual | 완전자동 | 판정 |
|---|---|---|---|
| overlap3 / reunion4 | 24% / 2% | 0.6% / 0% | sim |
| pairs 3회+ / distinct | 9.8% / 15.1명 | 2.6% / 18.9명 | sim |
| gcStd / spread / mid hard | 0.69 / 3.48 / 48.7% | 0.55 / 3.42 / 49.2% | tie |
| 평균 대기 / wallclock | 7.1분 / 158분 | 10.1분 / 194분 | actual |

부속 결론: 수동 상급자전 세션당 ~2회 하이브리드가 권장 운영(판수는 W_GAME이 자기보정, 조합은 groupHistory가 흡수 — AGENT_HISTORY #56). 상세 이력: AGENT_HISTORY #51~#56.

## 4b. 개편 후 실측 (2026-07-28 세션 73) — 개편(2026-07-27 `64f3f44`) 배포 후 첫 감사

29명(M19/F9 실참가)·4코트·매치로우 42건 중 **실경기 38건**(1분 미만 즉시종료 4건은 운영 오조작으로 제외). 지표는 같은 로스터·같은 성별구성의 **무작위 4인 추출(random feasible)** 대비로 평가.

| 지표 | 세션 73 actual | 대조 | 판정 |
|---|---|---|---|
| overlap2+ / overlap3+ / reunion4 | 73.7% / 2.6% / 0% | 108 actual 24%/2%(overlap3/reunion4) | **개편 성공** |
| 3회+ 동반쌍 / 최다 동반 | 2.8% / 4회 | 108 actual 9.8%, sim 2.6% | **sim 수준** |
| 판수(전 구간 참여 20명) | std 0.92, 5~8판 | — | 양호 |
| 스프레드 전체 | 4.03 | random 4.40 | −0.38 |
| └ 남복(4M0F, n=16) | 2.94, ≤2 44% | random 3.82, 25% | **작동** |
| └ **혼복(2M2F, n=19)** | **5.05** | **random 5.05 / 완전자동 sim 4.50** | **구조적 열위** |
| 페어 최적성 / interDiff | 37/38 최적, 1.34 | — | pairPlayers 정상 |
| 타입 로테이션 반복률 | 47.2% | 무작위 50% | W_ROTATE 무력 |
| 대기 평균/p95/max | 10.1 / 23.6 / 40.5분 | 108 sim 10.1분 | 자동 수준 |
| 코트 가동률 | 73% (c3·c4 공회전 20%) | — | — |

**★ 핵심 발견 — 혼복에서 skillDiff가 반쯤 꺼진다.** 실제 `recommendTeammates` 하네스로 확인: 시드가 **1남1녀**면 남녀 등급 격차(이 로스터 남 6.7 / 여 3.8)로 밴드가 이미 3~8로 벌어져, 남은 2슬롯의 등급 4~8 후보 **전원이 skillDiff=0으로 동점**이 되고 판수만으로 결정된다("밴드 안은 전부 0" 규칙의 부작용). 시드가 여2(밴드 1~3)면 정상 작동한다. 즉 개편이 없앴다고 본 "중간 등급 만능 필러" 비대칭이 **혼복 경로에 형태만 바꿔 남아 있다**.

> **정도 판정 주의** — actual 5.05는 random과 같지만, 같은 로스터 **완전자동 시뮬은 4.50**(300시드)이다. 즉 알고리즘이 무력한 게 아니라 ① 개선 폭이 동성 경기의 절반이고(동성 −0.81 vs 혼복 −0.55) ② **실전이 시뮬보다 나빴다**(수동 편성분이 random 수준). actual 한 값만으로 "미작동"이라 단정하면 안 되는 사례 — 런북 함정 4(actual은 1회 실현치)의 변형이다.

**처방(2026-07-29 적용)**: `skillDiff`를 확장폭의 **제곱**으로(`W_SKILL 1.5 · W_SKILL_EXP 2`). 벌어진 밴드를 사후에 메울 방법은 없으므로 **처음부터 벌어지지 못하게** 막는 방향이다. 300시드 × 로스터 3종: 혼복 4.49→4.11 / 3.07→2.92 / 5.14→4.37, 전체 3.70→3.39, interDiff 1.33→1.15, **판수 형평 비용 0**(gcStd 0.54 유지), 3인 겹침 0.4→0.8%. 선형 `W_SKILL 6.0`으로 같은 스프레드를 내면 gcStd·interDiff가 열위라 제곱이 파레토 우월. **기각**: 혼복 전용 실력 배수 — 혼복 비중이 46%→36%로 떨어져 여성 출전 기회를 깎는다. 상세: `docs/TEAM_GENERATION_RULES.md` §2.

부속: ① 잘못 완료한 경기를 되돌리는 수단이 없어(취소/삭제 RPC 부재) 오조작 4건이 `game_count` 16슬롯 + groupHistory를 오염 — 알고리즘이 본 이력 기준 overlap3+는 7.9%로 부풀려졌고 실제 편성 판단에도 영향(#4가 취소된 #1과 3인 겹침). ② tier hard-game은 high만 유의하게 개선(30.6% vs random 16.4%, z≈2.6), mid는 54.3% vs 60.4%로 열위이나 유의하지 않음(SE 7.3%p). ③ 노출 mid 44% vs random 38%(유의). ④ 콕확인 후 합류 보정(gc=활성평균)을 받고 0판으로 끝난 사례 1건 — 보정 후 회복 경로가 W_WAIT뿐.

## 5. 빠른 시작

"세션 N 실로그 분석" 요청 시: §1로 completed 매치+스냅샷 수집 → §2 지표 산출 → (알고리즘 비교가 필요하면) §3 하네스로 동일 조건 시뮬 → §4 기준점과 대조. 분석 스크립트는 스크래치패드에, 결론과 교훈은 AGENT_HISTORY·이 문서에 남긴다.
