# 카풀 공지 빌더 설계 (Carpool Announcement Builder) — 라이트 버전

> 운영자가 **지도로 "누가 누구 차에 타면 좋은지" 보고 그룹을 편성**하면,
> 그 편성으로 **카카오톡 공지 텍스트를 자동 생성 → 복붙**한다.
> 라이더↔동승자 조율은 수다방(채팅)에서. **앱은 운영자의 편성·공지 생성만 돕는다.**

상태: **설계 확정안(구현 전, 라이트)**. EXPANSION_SPEC §7 백로그 "카풀 매칭 보조 툴"의 **최소 구현**.

목표 공지 출력 예시:
```
[0628 일요일 오후 행복체육관]

상진-성민
형일-지윤,지인,필립

*라이더분들과 동승자분들은 장소, 시간 수다방에서 조율하시면 됩니다.
*동승자분들은 감사의 마음으로 ⭐콕 1개 ⭐라이더분께 전달해주세요!
*추가 카풀 필요하신 분들 연락주세요!
```

---

## 1. 범위 — 한다 / 안 한다

| 한다 | 안 한다 (의도적 제외) |
|---|---|
| 운영자가 지도(거주 동 중심점)로 가까운 사람 보며 **수동 편성** | 거리·자동 매칭/배정/경로 |
| 운전자–동승자 그룹을 짜고 **서버에 저장** | 정원 초과 차단 같은 강제 검증(운영자 판단에 맡김) |
| 편성으로 **공지 텍스트 자동 생성 + 복사** | 카카오톡 **자동 전송**(복붙은 사람이) |
| 일반 회원의 카풀 의향(`carpool_role`) 재사용 | **인앱 탑승자 결과 화면** (수다방 공지로 대체) |
| | **푸시/인앱 알림** (`carpool_assigned` 등) |
| | 배정 테이블·다수 RPC·정합성 RPC 재작성 |

**기획 결정(사용자 확정, 2026-06-29):** 인앱 탑승자 화면·알림은 안 함. 편성정보만 서버에 저장하면 공지는 그 편성으로 매번 생성. "복붙하기 편하게 하는 정도"가 목표.

> 이전 헤비 설계(배정 테이블 `carpool_assignments`, `get_my_carpool`, `set_carpool_seats`, 알림 타입, send-push 연동, 정합성 RPC 3종 재작성)는 **전부 폐기**. 필요해지면 §8 확장으로.

---

## 2. 데이터 — 컬럼 하나만 추가

기존 `sessions.board_drafts jsonb` 패턴 그대로. **신규 테이블 없음.**

```sql
-- 20260629010000_carpool_groups.sql
alter table public.sessions
  add column if not exists carpool_groups jsonb;   -- 편성 + 공지 옵션. null = 미편성
```

### `carpool_groups` 형태
```jsonc
{
  "v": 1,
  "groups": [                                  // 운전자별 그룹(순서 = 공지 줄 순서)
    { "driver_member_id": "uuid", "rider_member_ids": ["uuid", "uuid"] }
  ],
  "header": null,         // 운영자가 헤더를 직접 고쳤으면 그 문자열, 아니면 null(세션정보로 자동 생성)
  "footer": null          // 고정 안내문 override. null이면 기본 템플릿(§5)
}
```

- **이름이 아닌 member_id를 저장** → 회원 개명 시 공지도 자동 반영. 공지 텍스트는 렌더 시점에 이름 조회로 생성(저장 안 함).
- 게스트도 member 행이라 동일하게 id로 들어감. 명단에 없는 즉석 인원은 §5의 수동 추가(이름 문자열)로 보강.
- 의향 원천은 기존 `attendances.carpool_role`(confirmed 한정): `can_drive`=운전자 후보, `need_ride`=동승자 후보. 편성은 이 위에 얹는 레이어일 뿐 role을 바꾸지 않는다.

### 저장 RPC (단 1개)
| RPC | 시그니처 | 권한 | 동작 |
|---|---|---|---|
| `set_carpool_groups` | `(p_session_id bigint, p_groups jsonb) → void` | `is_admin()` | `sessions.carpool_groups = p_groups` UPDATE. `language plpgsql security definer set search_path=''`, `revoke from anon; grant to authenticated`. |

조회는 별도 RPC 불필요 — 세션 fetch에 `carpool_groups` 컬럼이 함께 온다.

**동시성:** 카풀 편성은 운영자 1인이 가끔 하는 저빈도 작업 → **last-write-wins 허용**(board의 lease/version 같은 장치 불필요). 정말 필요하면 board_drafts식 `version` 필드를 jsonb 안에 두는 정도로 충분(MVP 미적용).

---

## 3. 화면 — 운영자 카풀 공지 빌더 (단일 화면, 운영자 전용)

**진입:** `SessionParticipantsModal`(또는 세션 상세)의 운영자 영역에 **"🚗 카풀 공지 만들기"** 버튼. `is_admin() && carpool_enabled`일 때만.

**구성(위→아래, 모바일 세로):**

1. **헤더 미리보기(편집 가능):** `[0628 일요일 오후 행복체육관]` — 세션정보로 자동 채움(§5), 탭하면 인라인 편집.
2. **지도(접이식 보조):** 카카오맵에 운전자(초록 🚗)·동승자 후보(주황 🙋)를 **거주 동 중심점**으로 표시 → "누가 누구랑 가까운지" 눈으로 확인. 같은 동은 한 점에 겹쳐 카운트 뱃지. 키 없거나 지오코딩 실패 시 지도 영역을 안내로 대체하고 아래 편성기만으로 운영(§6).
3. **그룹 편성기(주력):**
   - 운전자 카드 스택: 카드마다 배정된 동승자 칩 + `× 해제`. (선언 좌석수 `carpool_seats`가 있으면 `N/M` **참고 표시만**, 강제 차단 없음.)
   - 미배정 동승자 풀: **동(洞)별 그룹 헤더**(예: `역삼동 · 2명`)로 묶어 표시.
   - **2탭 편성:** 동승자 칩 탭(선택) → 운전자 카드 탭(그 차로 이동). 데스크톱은 drag&drop 진보적 향상.
   - 명단 밖 인원 **수동 추가**(이름 입력) — 게스트/임시 인원용.
4. **공지 미리보기 + 복사:** 편성으로 생성된 전체 텍스트(헤더+그룹줄+안내문)를 그대로 보여주고 **[복사]** 버튼(`navigator.clipboard.writeText`). 복사 후 "복사됐어요" 토스트.

**상태:** 신청자 0(빈 상태 안내) · 운전자 0(경고) · 미배정 잔여 표시 · `carpool_enabled=false`(버튼 비노출) · 위치 미상(지도 밖 리스트, 편성은 가능).

**저장 타이밍:** 편성 변경 시 낙관적 업데이트 + 디바운스로 `set_carpool_groups` 저장(board 저장 패턴 참고). 공지 텍스트는 저장 안 하고 매번 생성.

---

## 4. 공지 텍스트 생성 규칙

`carpool_groups` + 세션정보 + 회원 이름으로 **렌더 시점 생성**.

```
{header}

{group line 1}
{group line 2}
...

{footer}
```

- **헤더** `header`가 있으면 그대로, 없으면 자동: `[{MMDD} {요일} {오전|오후} {장소}]`
  - `MMDD` = `scheduled_at`의 월일(Asia/Seoul), `요일` = 일~토요일, `오전/오후` = 시각 기준
  - `{장소}` = 세션의 place 이름(`placeName`) → 없으면 빈칸. 헤더 전체 인라인 편집 가능(수정 시 `carpool_groups.header`에 저장)
- **그룹 줄** = `{운전자이름}-{동승자1},{동승자2},…` (이름 = members.name 조회). 동승자 없는 운전자 줄은 생략 옵션.
- **안내문(footer)** `footer`가 있으면 그대로, 없으면 기본 템플릿:
  ```
  *라이더분들과 동승자분들은 장소, 시간 수다방에서 조율하시면 됩니다.
  *동승자분들은 감사의 마음으로 ⭐콕 1개 ⭐라이더분께 전달해주세요!
  *추가 카풀 필요하신 분들 연락주세요!
  ```
  안내문도 인라인 편집 가능(편집 시 `footer`에 저장 → 다음에도 유지).

---

## 5. 지도 / 좌표 (보조 기능, 최대한 가볍게)

**프라이버시 원칙 — 동(洞) 단위까지만, 정밀 좌표는 저장하지 않는다.**
회원 개개인의 정밀 집 좌표(lat/lng)는 사실상 집주소이며 **개인정보**다. 따라서 회원 행에는 좌표를 두지 않고 `residence`(동 텍스트)만 유지한다. 지도에 쓰는 좌표는 **"그 동의 중심점"**(같은 동 주민 전부 동일한 한 점)일 뿐이라, 이미 저장된 동 텍스트보다 더 드러나는 정보가 없다. "같은 동은 한 점에 겹친다"는 것은 UX 특성이자 **프라이버시 보호 장치**다(지도에 찍혀도 '이 사람 역삼동'까지만, 집은 드러나지 않음).

- 회원엔 좌표가 없고 `residence`(동 텍스트)만 있음 → 카카오 `Geocoder.addressSearch`로 **동→중심점** 변환. **신규 테이블 없음.**
- 캐시는 **메모리(컴포넌트 생존 동안 `Map`으로 동명 중복 제거)** 만으로 충분. 한 세션의 서로 다른 동은 5~15개 수준이라 화면 열 때 호출 몇 번이면 끝나고, 편집 중 재호출도 없음. **localStorage는 쓰지 않는다**(막아주는 건 "새로고침/재방문 시의 그 몇 호출"뿐 — 이득 미미, 기기·브라우저별이라 공유도 안 됨).
- 반복 지오코딩이 거슬려 저장하더라도 **`동명 → 중심점` 매핑만**(공유 lookup 테이블 예: `region_centroids(region pk, lat, lng)`). 이는 개인별 좌표가 아니라 동 텍스트와 동일 민감도라 프라이버시 문제 없음. **회원별 정밀 lat/lng를 저장하는 안(이전 초안의 'ProfileSetup 픽 좌표 저장')은 개인정보 측면에서 후퇴이므로 채택하지 않는다.**
- 같은 동 = 같은 좌표로 의도적 겹침 → 카운트 뱃지 마커(`역삼동 3`), 탭하면 리스트 팝오버. 지도는 "대략 같은 동네" 확인용 보조이고 실제 편성은 동별 패널에서.
- 동 미입력/지오코딩 실패 → 지도 밖 **'위치 미상'** 리스트, 편성은 그대로 가능.
- `hasKakaoKey()` false거나 SDK 실패 → 지도 숨기고 편성기만으로 정상 동작(graceful degrade).
- (선택 개선) `ProfileSetup`이 거주지 등록 시 현재 **버리는 lat/lng를 저장**하도록 보강하면 동명 지오코딩 불안정을 우회 가능 — 후순위.

---

## 6. 기존 사실 (재확인 — 설계 전제)

- **집결지(muster)는 죽은 기능**: `carpool_muster_*` 컬럼·`announce_carpool_muster` RPC가 `20260623030000`에서 DROP됨 → 참조 금지.
- **카카오맵 SDK 통합 완료**: `loadKakaoMaps()`/`hasKakaoKey()`, `services`(addressSearch). `KakaoLocationSearch`/`PlaceLocationPicker`가 마커·검색 패턴 제공.
- **`carpool_seats` write 경로 없음**: 현재 좌석수를 입력하는 UI/RPC가 없어 사실상 항상 null → 정원은 **참고 표시만**, 강제하지 않음(필요해지면 §8).
- `carpool_role`는 `set_carpool_role`로 회원 본인이 ScheduleCard에서 선택(기존 그대로).

---

## 7. 컴포넌트 / 파일

```
supabase/migrations/
  20260629010000_carpool_groups.sql        # sessions.carpool_groups jsonb + set_carpool_groups RPC

src/components/schedule/carpool/
  CarpoolAnnounceBuilder.tsx   # 운영자 단일 화면(헤더·지도·편성기·공지 미리보기 오케스트레이션)
  CarpoolMap.tsx               # 카카오 지도(동 centroid 마커·클러스터). graceful degrade
  DriverGroupCard.tsx          # 운전자 카드 + 배정 동승자 칩 + 해제
  RiderPool.tsx                # 미배정 동승자(동별 그룹) + 수동 추가
  announcementText.ts          # carpool_groups + 세션 + 이름 → 공지 텍스트 생성(§4)
src/lib/carpool/geocodeResidence.ts   # 동→중심점 지오코딩 + 메모리 캐시(Map)
src/lib/supabase/carpool.ts           # setCarpoolGroups RPC 래퍼
src/components/schedule/SessionParticipantsModal.tsx  # '🚗 카풀 공지 만들기' 진입 버튼(수정)
```

---

## 8. 단계화 / 확장 여지

- **이번(라이트):** §2 컬럼+RPC 1개, §3 운영자 화면, §4 공지 생성·복사, §5 보조 지도. 끝.
- **확장(필요 시):** 인앱 탑승자 결과 화면 / `carpool_assigned` 푸시(편성정보가 이미 서버에 있으므로 그 위에 알림만 얹으면 됨) / 정원 강제 / 거주지 좌표 영속화 / 차량별 집결지.

---

## 9. 문서 동기화 (구현 시)

- EXPANSION_SPEC §7 백로그에서 본 항목 이동, §22 "좌석 매칭 테이블 없음"은 **여전히 유효**(이번엔 테이블 안 만들고 jsonb만 사용)이나 `sessions.carpool_groups` 추가 사실 반영.
- 추천 알고리즘 변경 아님 → `TEAM_GENERATION_RULES.md` 해당 없음.
