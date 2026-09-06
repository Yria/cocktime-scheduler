# 세션 보드 PixiJS 전환 설계

작성/구현: 2026-09-06. 상태: **Pixi 기본 렌더러 적용, 실기기 성능 비교는 남음**.

## 구현 현황

- `SessionBoardRenderer`가 Pixi를 기본으로 lazy load한다. `?boardRenderer=konva`로 기존 화면을 비교할 수 있으며, 초기화 실패/context loss에서는 같은 shell 안에서 Konva 한 개로 전환한다. 세션 동기화 effect는 중복 mount하지 않는다.
- 드래그/핀치는 native Pointer Events와 `BoardRuntime`에서 처리한다. 위치는 드롭 시, 배율은 제스처 종료/레이아웃 조정 시 확정한다. 단일 frame scheduler는 정지 시 멈춘다.
- 외형 캐시는 아래 초기안의 `generateTexture` 대신 **offscreen Canvas 2D → Texture → Pixi Sprite**로 구현했다. 기존 Konva의 글꼴·그림자·그레이스케일 합성에 맞추기 위한 선택이며, 매 프레임 화면을 그리는 백엔드는 WebGL이다. 본체 shadow 변형·사진·CTA flash를 공유 캐시에 준비한다.
- 초기화 실패를 직접 await/catch하기 위해 `<Application>` 대신 공식 `createRoot`를 얇은 host에서 사용한다. `patches/@pixi__react@8.0.5.patch`는 기존 reconciler 해제 함수를 export하고 초기화 실패 시 stage만 안전하게 정리하도록 보완한다. 내부 렌더링 알고리즘은 변경하지 않는다. 바인딩 업그레이드 시 이 패치와 lifecycle 테스트를 함께 검토해야 한다.
- context loss 시 자동 texture 재구축보다 호환 렌더러 전환을 우선 구현했다. 기존 위치·팀 구성 store는 유지한다.
- 아래 절의 Phase 0~5는 설계/검증 기준이다. 기기별 FPS·입력 지연·메모리 예산 최적화 및 Konva 최종 제거까지 완료했다는 의미는 아니다.

검증 명령: `pnpm test`, `pnpm build`, `pnpm test:board:browser`. 브라우저 테스트 첫 실행 전 `pnpm exec playwright install chromium`이 필요하다. `e2e/board.html`은 외부 서버에 연결하지 않는 로컬 테스트 fixture이며 production 빌드 진입점에 포함되지 않는다.

최종 구현 검증: 단위/통합 **506개**, Chromium 브라우저 **11개**, TypeScript/production build 통과. 변경 파일 ESLint 통과. 전체 저장소 lint에는 이번 변경 밖 파일의 기존 오류 7개가 남아 있다. 모바일 기기 자체에서의 FPS/발열/메모리 비교는 아직 측정하지 않았다.

## 1. 결정과 범위

**보드 그림은 PixiJS(WebGL), 선언적 장면 구성은 `@pixi/react`, 프레임 단위 움직임은 별도 런타임이 담당한다.** 툴바·모달·상하단 드롭존 등 기존 React DOM UI는 유지한다.

단순히 Konva 컴포넌트를 Pixi 컴포넌트로 치환하는 작업이 아니다. 렌더링·입력·캐시의 소유권을 새로 설계하되, 팀 편성·예약·경기·편집권·서버 동기화는 기존 검증된 명령을 재사용한다. 기존 렌더 구조를 유지할 이유는 없지만 도메인 규칙까지 재작성할 성능 근거도 없다.

| 항목 | 결정 |
| --- | --- |
| 검증 시작 버전 | `pixi.js 8.20.1`, `@pixi/react 8.0.5` 고정 후 lockfile 반영 |
| React 연결 | 공식 `@pixi/react`의 `Application`, `extend`, JSX 사용 |
| 그래픽 백엔드 | `preference: ["webgl"]`; 자동 WebGPU/Canvas 전환을 제한 |
| 화면 갱신 | 전용 ticker 자동 실행 중지, 변경 시 단일 rAF로 렌더 |
| 화면 수 | 보드 canvas 한 개. 여러 canvas/WebGL context로 나누지 않음 |
| 카메라 | 현재와 같은 좌상단 고정 줌, 팬 없음. `pixi-viewport` 불필요 |
| 상태 | 기존 Zustand store와 액션 유지. 이동 중 좌표·핀치는 런타임 소유 |
| 제외 | UX 재기획, DB/payload 변경, 추천·매칭 알고리즘 변경, worker/ECS 도입 |

확인한 npm 메타데이터상 `@pixi/react 8.0.5`의 peer 범위는 React `>=19.0.0`, Pixi `^8.2.6`이다. 프로젝트의 React `19.2`는 범위에 포함되지만 실제 조합의 초기화·StrictMode·해제 검증을 별도로 통과해야 한다. 공식 바인딩은 Pixi 객체를 JSX로 표현하는 얇은 계층이다. [공식 시작 가이드](https://react.pixijs.io/getting-started/), [8.0.5 패키지 정의](https://github.com/pixijs/pixi-react/blob/v8.0.5/package.json)

## 2. 현재 비용과 이번 설계의 대응

현재 `SessionBoard.tsx`는 **Canvas 2D인 Konva의 단일 Layer**에 모든 팀·선수·코트를 그린다. 이미 자유 자석 이동은 ref 기반이고 hover는 rAF로 제한되어 있다. “모든 드래그가 React state를 매번 갱신한다”는 진단은 맞지 않는다.

| 코드에서 확인한 비용 | 변경 방향 |
| --- | --- |
| 하나가 움직여도 Layer 전체의 도형·문자·사진 클립을 재생성하는 그리기 경로 | 복잡한 외형을 공유 텍스처로 만들고 화면에서는 Sprite 합성 |
| 팀 `dragmove → setTeamAnchor → drafts Map` 갱신, 각 팀의 넓은 구독 재평가 | 이동 중 프리뷰만 변환, 종료 시 위치 한 번 확정 |
| `boardStore.subscribe`에서 위치 변경도 drafts 직렬화·JSON 비교에 진입 | 우선 프레임별 write 제거. 후속으로 동기화 대상 변경 여부를 직렬화 전에 검사 |
| 코트 dragmove마다 `setCourtAnchor` | 종료 시 한 번 확정 |
| 핀치마다 `setScale`, localStorage 저장, 논리 영역 갱신·구독 전파 | 런타임 배율로 표시, 종료 시 배율·논리 영역을 함께 확정 |
| hover마다 파생 집합 생성·후보 순회 | 최신 도메인 입력별 캐시, 프레임당 최대 한 번 평가 |
| 고해상도 화면의 픽셀 처리량 | 기본 화질을 유지해 측정한 뒤 해상도 정책을 별도 판단 |

이는 코드로 확인한 비용 경로이지 실기기 병목 순위나 FPS 측정 결과가 아니다. Pixi로 바꾼다는 사실만으로 빨라졌다고 판정하지 않는다. DPR 3이면 CSS 면적 대비 픽셀 수가 9배라는 점도 고려한다.

## 3. 기획 동등성 계약

기준은 **현재 실행 코드와 회귀 테스트**다. 기존 `docs/session-board.md`에는 오래된 규칙이 섞여 있다. 실제 경로는 `/session`이고, `/session/board`는 리다이렉트다. 아래 표를 구현·리뷰·검증의 기준으로 사용한다.

### 3.1 편성 및 경기

| 대상 | 보존할 동작 |
| --- | --- |
| 자유 자석 | 자유끼리 페어, 팀 빈 슬롯 합류, 점유 슬롯 교체, 빈 공간 로컬 이동 |
| anchor | 다른 팀 빈 슬롯으로 **실제 이동**, 점유 슬롯 맞교환, 같은 팀 슬롯 변경/교환, 빈 공간 탈퇴 |
| ghost | 다른 팀 **bounds 전체**에 재예약 가능. 자기 팀/불가 대상은 복귀, 빈 공간·상단 빼기존은 예약 취소 |
| 경기중 선수 | 다른 팀 **빈 슬롯만** 예약 가능. 자유 선수와 페어를 만들 때 본인은 ghost. 원본 코트는 유지, 나머지 드롭은 복귀 |
| 예약 정합성 | 다중 ghost 허용. anchor 합류 시 해당 선수의 다른 예약 정리. 경기 종료 후 조건에 따라 예약 선수가 anchor로 승격되고 예약 삭제 |
| 팀 생명주기 | 유효 멤버 2명 미만 해체 및 연쇄 정리, 4명 미만 확정 해제. 4명 유지 스왑은 기존 확정 순서 보존 |
| 경기 시작 | 기존 추천·대진·확정/대기 순번·코트 선택 규칙 유지. 성공 및 동일 4인 배치 확인 뒤 원 팀 제거, 팀 위치를 코트에 인계 |
| 경기 완료 | 예약 승격 등 기존 후처리 유지. **manualLayout=true여도 전체 정렬** |
| 휴식/콕 | 휴식 선수는 흐린 자석으로 계속 표시, 편성 불가. 하단 드롭으로 휴식/복귀, 휴식자는 더블탭 복귀. 콕 미확인은 기존 편성 제한·확인 모달 유지 |

페어 반경은 자유→자유 57.6, anchor/경기중→자유 32다. 합류·교체 슬롯 반경은 32다. 겹친 팀의 드롭 우선순위는 기존 Map 순서 및 source별 분기를 유지한다. 화면 z-order나 최근접 순서로 바꾸지 않는다. 특히 경기중 선수는 먼저 만난 bounds의 불가 슬롯에서 멈추는 현 분기까지 fixture로 고정한다.

상단 빼기존/더블탭의 `detachMember`는 정렬 위치로 복귀하지만, 보드 빈 공간에 드롭해 탈퇴하면 놓은 좌표를 유지한다. 둘을 하나의 위치 정책으로 통합하지 않는다.

### 3.2 입력·권한·시각

- 단일 탭 280ms 대기, 더블탭 분기, 롱프레스 500ms 디버그 표시 유지. 롱프레스 이동 취소 임계값 8 CSS px와 현재 Konva 드래그 시작 임계값 3 CSS px를 호환성 테스트로 고정한다. 지연 제거는 이번 범위 밖이다.
- 드래그 시작 시 자석 및 부모 카드의 시각 순서 상승, 원본 슬롯의 `+`, 기존 hover·상하단 드롭존 피드백 유지. 현재 경기중 자석에는 `onDragMove`가 연결되지 않아 hover가 없으므로 새 피드백을 몰래 추가하지 않는다.
- 뷰어는 자유 자석·팀 카드의 **로컬 위치** 변경 및 정렬·줌 가능. anchor/ghost 편성 및 코트 카드 이동은 편집자만 가능하다. 경기중 자석은 underlying magnet의 `teamId == null`이면 뷰어도 시각적으로 끌 수 있지만 드롭은 무효이며 슬롯으로 복귀한다.
- 공유 변경은 기존 `isEditor` 및 서버 편집권 검사로 제한한다. 빈 락을 드롭으로 자동 획득하지 않는다. 첫 진입의 기존 1회 자동 획득 처리는 `useSessionBoardEffects`에서 유지한다.
- 편집권 상실 시 드래그·hover·배정 표시와 추천/경기수정/콕확인 모달을 기존 `cancelEditActions` 경로로 정리한다.
- 자석 지름 64, 클릭 기준 반경 26, 카드 폭 158·높이 218, 상하 비대칭 bounds, 슬롯 offset ±35 등은 `constants.ts`/`geometry.ts`를 재사용한다.
- 사진 원형 crop·이니셜·성별 링·스킬 arc·한글 이름·그라데이션·이름 그림자·다크 테마를 유지한다. ghost의 실제 배지 문구는 **“경기중”**, 휴식은 “휴식”, 콕 미확인은 “콕?”이다. 흐림은 본체에만 적용하고 배지는 선명하게 남긴다.
- 팀 라벨·생성자·확정 순번·버튼의 모든 상태별 문구/색과 코트의 “보기 전용” 표시를 유지한다. 다음 차례 CTA의 조건부 550ms 점멸도 유지한다.
- 위치 변경 시 기존 0.22초 EaseInOut 흩어짐 애니메이션을 재현한다. 방금 드롭한 대상은 제외하고 무효 드롭 복귀는 즉시 처리한다.

### 3.3 줌·배치

- 좌상단 `(0,0)` 고정, pan 없음, 배율 0.5–1.0, 버튼/휠 step 0.1, 소수 둘째 자리 반올림을 유지한다. 핀치 중심을 따라 카메라가 이동하지 않는다.
- 자동 fit은 0.05 간격으로 계산하고 `min(userScale, fit)`을 적용한다. 자동 fit이 사용자 저장 배율을 덮지 않으며 여유가 생기면 그 상한으로 복귀한다.
- 수동 정렬 버튼은 현재 줌을 유지한다. 편집자의 수동 배치 표식과 뷰어의 자동 fit/정렬 트리거를 유지한다. 단, 위의 경기 완료 예외를 잊지 않는다.
- 자동 정렬 순서는 경기중 코트 → 완성팀 → 나머지 팀(인원·생성시각) → 자유 선수(대기/콕 미제출/휴식, 경기수)다. 경기수는 배치에 영향을 주며 현재 자석에는 표시하지 않는다.
- 기존 화면 크기 측정, 좌우 16px 여백, PWA `app-shell-h`, safe-area, 상하단 UI와 드롭존 위치를 보존한다.

근거 파일: `src/components/board/{SessionBoard,PlayerMagnet,TeamBackground,CourtMatchCard}.tsx`, `src/hooks/usePlayerMagnetGestures.ts`, `src/hooks/useBoardStageLayout.ts`, `src/hooks/useBoardDragHandlers.ts`, `src/store/board/{membershipSlice,matchSlice,viewSlice}.ts`, `src/store/boardStore.test.ts`, `src/lib/board/*.test.ts`.

## 4. 새 구조와 소유권

```text
SessionBoard                         React DOM: 화면·모달·기존 동기화 effect
├─ BoardToolbar / Chrome / Overlays   기존 DOM 유지
└─ BoardRendererHost                  선택한 렌더러 하나만 mount
   └─ PixiBoardCanvas                 Application·수명·측정·복구
      ├─ BoardRuntime                입력·프레임·texture pool·scene registry
      └─ BoardScene                  @pixi/react: 도메인 변경 시 장면 구성
         └─ WorldRoot                좌상단 고정 scale; 선택적으로 RenderGroup
            ├─ EntityRoot            팀/자유 자석/코트, 기존 시각 순서
            │  └─ owner feedback     해당 자석/카드 내부의 hover·선택 표시
            └─ DragPreviewRoot       활성 제스처의 별도 Sprite/카드 복제
```

`EntityRoot` 내부에서 각 카드의 배경·슬롯·멤버·라벨은 동일 부모 밑에 둔다. 모든 배경을 별도 전역 레이어로 빼면 겹친 카드의 앞뒤 관계가 달라질 수 있다. 레이어 분리는 **갱신 책임과 시각 순서의 분리**이지 모든 항목을 종류별로 재정렬하라는 뜻이 아니다.

hover도 전역 최상단에 모으지 않는다. 예를 들어 팀 슬롯의 hover ring은 현재처럼 자기 카드 안에서 멤버 뒤에 두고 앞 카드에 가려지는 관계를 유지한다. 전역 최상단은 활성 드래그 preview에만 사용한다.

| 소유자 | 소유하는 것 | 소유하지 않는 것 |
| --- | --- | --- |
| 기존 stores/액션 | 선수·팀·예약·코트·권한·확정된 위치/줌·서버 저장 | 매 pointermove 좌표 |
| BoardProjection | 읽기 전용 scene 모델·파생 집합·히트 후보, 안정적인 엔티티 참조 | 두 번째 편성 데이터 원본, DB 쓰기 |
| React/Pixi scene | 객체 생성·제거, 확정 배치, 외형과 문구, 의미상 표시 상태 | 프레임마다 drag x/y props 전달 |
| BoardRuntime | 현재 포인터·제스처·프리뷰 transform·애니메이션·유효 배율 | 멤버십의 임의 변경 |
| TexturePool | renderer별 생성 텍스처·원본 asset lease·메모리 회수 | 선수 원본 데이터 |

React와 런타임이 같은 `x/y/scale/visible`을 동시에 쓰지 않는다. 기본 배치는 React의 `PlacementContainer`, 애니메이션 보정은 런타임의 자식 `MotionContainer`로 분리한다. WorldRoot scale은 runtime만 설정하고 store의 확정 scale도 그 경로로 반영한다. 프리뷰·원본 숨김 상태는 runtime의 저빈도 gesture snapshot을 React에 발행해 반영한다.

드래그 프리뷰는 같은 텍스처를 공유하는 **별도 객체**다. JSX로 생성된 원본을 `addChild`로 다른 부모에 옮기지 않는다. React의 실제 부모 인식과 어긋나는 해제 문제를 피한다. 초기 버전에는 실험적 `RenderLayer`를 쓰지 않는다. 해당 API는 hit 순서와 렌더 순서가 다르고 `addChild`도 허용하지 않는다. [reconciler 제거 구현](https://github.com/pixijs/pixi-react/blob/v8.0.5/src/helpers/removeChild.ts), [RenderLayer 제약](https://pixijs.download/release/docs/scene.RenderLayer.html)

## 5. 그리기: on-demand + 재사용 텍스처

### 5.1 단일 프레임 스케줄러

Application은 `autoStart: false`, `sharedTicker: false`, `autoDensity: true`로 초기화한다. 크기는 기존 컨테이너의 ResizeObserver 결과를 사용하며 `resizeTo` 자동 경로와 병행하지 않는다. ticker 기반 `useTick`도 함께 사용하지 않는다. 초기 resolution은 현재 native DPR에 맞추며 DPR cap 2 등은 화질 비교 후 별도 적용한다. [TickerPlugin](https://pixijs.com/8.x/guides/components/application/ticker-plugin), [ResizePlugin 구현](https://github.com/pixijs/pixijs/blob/v8.20.1/src/app/ResizePlugin.ts)

`BoardFrameScheduler.invalidate(reason)`은 이미 예약된 rAF가 있으면 추가 예약하지 않는다. 프레임은 다음 순서로 수행한다.

1. pending resize 및 최신 committed scene 등록 상태 확인.
2. 마지막 pointer sample·유효 scale을 적용하고 필요한 hover만 계산.
3. 활성 애니메이션의 transform 갱신.
4. 실제 시각 변경이 있을 때 `app.render()` 한 번.
5. 애니메이션 또는 새 dirty가 남아 있을 때만 다음 프레임 예약.

포인터 이벤트가 1프레임에 여러 번 와도 마지막 위치만 표시한다. 반면 wheel의 누적 step·핀치 ratio는 이벤트 순서대로 런타임에 반영해 입력량을 잃지 않는다. 정지 상태에서는 지속 rAF를 돌리지 않는다. 기존 CTA 점멸·서버 변경·asset 도착 등 실제 시각 변경은 예외적으로 렌더한다.

**React commit과 draw는 별개다.** `@pixi/react 8.0.5`의 `resetAfterCommit`은 자동 render/invalidate를 하지 않는다. `onInit`도 자식 장면 commit보다 먼저 실행된다. 따라서 onInit에서 한 번 그리기만 하면 빈 화면이 남을 수 있다. [resetAfterCommit](https://github.com/pixijs/pixi-react/blob/v8.0.5/src/helpers/resetAfterCommit.ts), [createRoot](https://github.com/pixijs/pixi-react/blob/v8.0.5/src/core/createRoot.tsx)

모든 독립 시각 컴포넌트에 `useInvalidateOnCommit()`을 적용한다. layout effect 및 노드 등록/해제에서 **rAF 예약만** 한다. 상위 bridge 하나만으로는 하위 단독 갱신을 포착할 수 없다. 이미지 promise 완료가 아니라 실제 texture 적용/JSX commit 이후 invalidate한다. React commit이 아직 안 된 동안은 이전에 확정된 장면/프리뷰를 유지하며 pointermove마다 `flushSync`하지 않는다.

### 5.2 텍스처 단위

| 부분 | 표현/캐시 | 다시 만들 조건 |
| --- | --- | --- |
| 자석 본체 | 사진/이니셜·이름·그라데이션·기본 링을 합성한 공유 Texture + Sprite | 외형 키 변경 |
| ghost 본체 | 사진 회색화·기본 링 중립색을 반영한 별도 공유 변형 | 위 조건 + normal/ghost 변형 |
| 그림자 | 기존 player drag 동안 꺼지는 표현을 캐시 변형 또는 별도 Sprite로 재현 | 시작/종료 시 선택만 변경 |
| 배지·ghost 점선·hover | 본체 밖의 별도 Sprite/Graphics, 색/alpha 분리 | 상태/대상 변경 |
| 카드 외곽·버튼 바탕 | 크기·색·상태별 공유 chrome 텍스처 또는 단순 Graphics | 해당 키 변경 |
| 팀명·생성자·순번·버튼 문구 | 변경 시에만 Text texture 갱신 | 문자열·스타일 변경 |
| 드래그 프리뷰 | 위 자원을 공유하는 Sprite/Container | 제스처 시작/종료; 이동은 transform만 |

`renderer.generateTexture`로 detached 외형 컨테이너를 텍스처화해 여러 ghost/프리뷰에서 공유한다. 한글은 우선 일반 Pixi Text로 정확한 폰트·크기·배치를 맞추고 캐시한다. BitmapText용 한글 atlas를 처음부터 만들지 않는다. 매 프레임 mask/filter/문자 rasterization을 하지 않는다. [generateTexture 구현](https://github.com/pixijs/pixijs/blob/v8.20.1/src/rendering/renderers/shared/extract/GenerateTextureSystem.ts), [Canvas Text](https://pixijs.com/8.x/guides/components/scene-objects/text/canvas)

외형 키는 `player appearance revision + photo revision + font revision + style/theme revision + resolution bucket + gray/shadow variant`로 구성한다. 이름·성별·스킬 등 실제 외형 의존성을 포함하고 **위치·줌 매 샘플·표시하지 않는 경기수**는 제외한다. 최대 줌 1.0에서 선명한 크기로 준비하고 핀치 중 재생성하지 않는다. 사진은 기존 `playerPhoto.ts`의 경로·실패 시 이니셜 규칙을 재사용한다.

원본 asset과 생성 texture의 lease/refcount를 나눈다. 사용 중인 texture는 퇴출하지 않고 미사용분만 LRU·추정 byte budget으로 회수한다. 회색화/이름 변경의 늦은 비동기 결과는 generation으로 버린다. 폰트 로딩 후 해당 외형을 다시 준비하며 여러 ghost 중 하나가 사라졌다고 공용 원본을 unload하지 않는다. [Assets 공유 및 수명](https://pixijs.com/8.x/guides/components/assets)

`cacheAsTexture()`는 복잡하고 드물게 변하는 개별 subtree에만 선택적으로 쓴다. 이는 ref/effect에서 호출하는 **메서드**이며 JSX boolean prop이 아니다. 내용 변경 시 `updateCacheTexture()`와 invalidate가 모두 필요하다. 화면 전체 캐시는 초기안에서 제외한다. 이동 시작마다 큰 화면을 다시 굽는 비용·최대 texture 크기·메모리 증가를 먼저 측정해야 한다. [캐시 가이드](https://pixijs.com/8.x/guides/components/scene-objects/container/cache-as-texture)

**Container/RenderGroup 분리는 픽셀 캐시가 아니다.** WorldRoot를 소수 RenderGroup으로 구성하는 것은 transform/렌더 명령 비용을 줄이는 선택이다. 매 자석에 RenderGroup을 만들지 않는다. 단일 canvas의 draw에서는 화면을 다시 합성하므로 “드래그한 부분의 픽셀만 그린다”고 설명하지 않는다. [RenderGroup 가이드](https://pixijs.com/8.x/guides/concepts/render-groups)

## 6. 입력 런타임

### 6.1 입력 경로 및 식별자

canvas의 native Pointer Events를 단일 입력 경로로 사용한다. pointer capture로 canvas 밖 이동/해제를 받으며 장식 Pixi 노드는 별도 이벤트 탐색에 참여시키지 않는다. 등록된 geometry·시각 순서로 자석/카드/버튼을 pick한다. 버튼 press는 부모 drag를 시작하지 않는다. 터치 뒤 호환 mouse click을 별도 명령으로 다시 처리하지 않는다.

canvas에만 보드 조작용 `touch-action`을 적용하고 wheel 기본 동작 차단이 필요한 listener는 해당 옵션으로 등록한다. 보드 밖 DOM 모달·스크롤·버튼 동작까지 전역 차단하지 않는다.

```ts
// 설계용 형태. 실제 ID 타입은 기존 프로젝트 타입을 재사용한다.
type DragSource =
  | { kind: "free"; playerId: string }
  | { kind: "anchor"; playerId: string; teamId: string }
  | { kind: "ghost"; playerId: string; teamId: string; reservationId: string }
  | { kind: "playing"; playerId: string; courtId: number; matchId: string }
  | { kind: "team"; teamId: string }
  | { kind: "court"; courtId: number; matchId: string };

// gestureId와 scene generation으로 오래된 cleanup/비동기 완료를 무효화한다.
// 동일 선수의 ghost가 여러 개이므로 source를 playerId 하나로 식별하지 않는다.
```

상태 전이는 `idle → pressed → dragging → committing → idle`이며, `pressed → tap/longPress`와 `pressed/dragging → pinching` 분기를 둔다. 두 번째 손가락이 들어오면 미확정 한 손가락 조작을 취소하고 핀치로 전환해 의도하지 않은 드롭을 막는다. 핀치 종료 후 남은 손가락으로 이전 드래그를 자동 재개하지 않는다.

### 6.2 좌표

```text
client 좌표 → canvas CSS 좌표 → world 좌표 → 필요한 경우 부모 카드 local 좌표
world = canvasCSS / effectiveScale       (원점 0,0; pan 없음)
viewW/H = canvasCSSWidth/Height / effectiveScale
```

canvas rect와 renderer CSS 크기가 다르면 비율을 보정한 뒤 역변환한다. DPR은 그리기 buffer의 해상도에만 사용하고 히트 판정에 섞지 않는다. 손가락이 잡은 점과 중심의 offset을 유지하며 slot offset을 두 번 더하지 않는다.

pointerdown의 pick과 grab offset은 **마지막으로 표시된 Motion transform**을 반영한다. 흩어짐 애니메이션 중인 객체만 시각 geometry를 별도 보정하고, 잡는 순간 해당 애니메이션을 멈춰 표시 위치에서 drag를 시작한다. 의미상 드롭 후보 위치는 기존처럼 committed layout을 사용한다. 시각 pick과 도메인 drop에 무조건 같은 index를 쓰지 않는다.

상단 판정은 자석 중심 `worldY <= 0`, 휴식존은 `worldY >= viewH`다. **드롭존 판정 전에 화면 안으로 clamp하지 않는다.** 이후 자유 배치와 카드 경계 처리는 기존 geometry/layout 액션으로 확정한다.

### 6.3 시작·이동·확정

1. 시작: 최신 권한과 source를 확인해 gesture snapshot을 한 번 발행한다. 같은 표시 전환에서 원본을 숨기고 별도 preview를 표시한다. 원본의 멤버 소속은 바꾸지 않는다. **편집자의 팀/코트 drag는 시작 임계값을 넘을 때 manualLayout만 한 번 확정**한다. 현행 첫 dragmove의 정책을 유지하기 위함이며, 자유 자석에는 일괄 적용하지 않는다.
2. 이동: 최신 포인터를 ref에 저장하고 rAF에서 preview transform과 필요한 hover를 갱신한다. 팀/코트의 store 위치·DB payload·localStorage는 쓰지 않는다.
3. 확정: 최신 store로 source와 권한을 재검증한다. 현 `useBoardDragHandlers`의 드롭존 우선순위를 이식하고 `handleDrop` / `handleGhostDrop` / `handlePlayingMagnetDrop` 등 기존 명령을 한 번 호출한다. 카드는 `setTeamAnchor` / `setCourtAnchor`와 현행 종료 처리만 실행한다.
4. 표시 인계: 명령 이후의 위치·부모·slot을 반영한 destination 준비 ACK를 확인한다. 그동안 destination의 중복 표시를 막고, **최종 객체 표시와 preview 제거를 하나의 presentation commit으로 전환**한다. 이전 부모의 local 좌표로 복귀하거나 destination과 preview가 겹쳐 표시되는 프레임을 끼우지 않는다. `none`으로 store가 변하지 않아도 복귀는 반드시 실행한다.

카드 이동에 새로운 전체 settle/자동 정렬을 추가하지 않는다. 기존 명령이 요구하는 드롭/생성/종료 시 정합 처리만 유지한다. UI용 dragInfo 시작/종료와 hot 대상 변경은 저빈도 store write를 허용한다. “드래그 중 store 변경 전면 금지”가 아니라 **좌표의 프레임별 쓰기 금지**다.

pointercancel·lost capture·window blur/hidden·unmount·context loss는 하나의 반복 호출 가능한 cancel 경로로 처리한다. 최신 committed 상태로 복귀하며, 시작 snapshot으로 복원해 새 원격 변경을 덮어쓰지 않는다. 원본 삭제·예약 삭제·소속 변경·matchId 변경·편집권 상실도 같은 경로를 사용한다.

단, `committing`에서 **자기 명령으로 예상된 소속 전환/예약 삭제**는 취소가 아니라 정상 인계다. 명령 token과 기대 destination을 기록해 외부 무효화와 구분한다. 2인 팀의 멤버 이동으로 원 팀이 해체돼도 자기 drop을 다시 취소하거나 중복 실행하지 않는다.

### 6.4 핀치와 저장

runtime에서 유효 scale을 반올림하며 갱신한다. WorldRoot·입력 역변환·표시용 줌 값은 같은 유효값을 본다. 도메인 store 저장은 핀치 종료 시, wheel은 연속 입력 종료 시, 버튼은 조작 시 수행한다. 다음 드롭/정렬 명령 전에 미확정 카메라를 확정한다.

기존 view slice에 좁은 `commitBoardView` 상당의 action을 추가해 **scale·사용자 설정·논리 stageW/H를 동일 transaction에서 갱신**한다. auto/user 구분과 기존 localStorage 키를 유지한다. 최대에서 `+`를 누르는 등 유효값이 안 바뀌면 새 수동 잠금을 설정하지 않는다. 현 `stageW/H` store 값은 이름과 달리 CSS 크기가 아닌 논리 영역이므로 혼동하지 않는다.

제스처 동안 `hasEffectiveChange`를 기록한다. 자동 배율 0.8에서 0.9→0.8로 돌아온 핀치는 최종 배율이 처음과 같아도 수동 0.8 설정을 기억해야 한다. 처음부터 끝까지 유효 배율이 한 번도 안 변한 입력만 no-op이다.

수동 줌·자동 fit·resize는 하나의 camera/layout 조정 경로를 사용한다. 활성 핀치/wheel 중 원격 변경이나 resize가 기존 자동 fit을 요구하면, 미확정 사용자 배율과 논리 영역을 먼저 한 번 확정한 뒤 **최신 입력으로 기존 fit/정렬 정책을 실행**한다. runtime은 그 결과를 받아 핀치 기준을 재설정한다. 오래된 store userScale이 현재 조작을 덮게 두지 않으며, 이 이벤트성 확정은 프레임별 저장과 구분한다. 수동 배치 중 자동 fit을 생략하는 기존 가드는 그대로 적용한다.

## 7. 상태·동기화 연결

`BoardProjection`은 기존 두 store 갱신을 dirty로 집계하고 최신 참조에서 읽기 전용 snapshot 하나를 발행한다. 각 엔티티는 관련 입력이 같으면 참조를 재사용한다. 모든 팀이 매번 `drafts/magnets/reservations` 전체를 구독하는 구조는 제거한다.

| 파생값 | 무효화 입력 |
| --- | --- |
| 팀 유효 멤버/slot | anchor membership·reservations·명시 slot |
| 시작 가능 판정 | 위 입력 + court roster·다른 팀 anchor 소속 |
| 확정 queue/순위 | confirmedMs·팀 생성/삭제·시작 가능성 |
| 편성 대상 집합 | 선수 상태·resting·cockChecked/cockCheckEnabled·court roster |
| world-space 히트 후보 | 확정 위치·membership·slot geometry. 카메라 scale만 바뀌면 재구축하지 않음 |
| 외형 | 이름·성별·스킬·사진·폰트·테마·표시 상태·해상도 |

처음에는 캐시된 배열/Map으로 후보 수를 감당하는지 측정한다. 공간 index는 필요하면 추가하되 기존 후보 순서를 유지해 좁힌다. 포인터 pick에서 숨겨진 drag source와 preview는 별도로 취급한다. **도메인 drop 후보에서 원래 팀/자기 slot까지 지우지 않는다.** 자기 슬롯 유지·팀내 이동·ghost 원 팀 복귀가 필요하다. 클릭할 시각 객체를 고르는 pick과 의미상 드롭 판정을 혼동하지 않는다.

`sessionStore`와 `boardStore`의 버전은 같은 시계가 아니다. `boardDraftsVersion == matchStateVersion` 같은 대기를 하지 않는다. 초기 단계에서는 `useSessionBoardEffects`를 동기화/자가치유의 기존 소유자로 유지하고 `wouldDissolveByPlaying` 등 표시 게이트도 보존한다. renderer는 그리기 중 remote apply·자가치유·RPC를 수행하지 않는다.

CAS, 저장 중 최신 payload 큐, 버전 단조 적용, 충돌 시 서버 재동기화, 편집권 검사는 유지한다. 서버 payload는 팀 구성·slot·생성자·확정 시각·예약이며 위치/zoom/hover를 추가하지 않는다.

`document/layout`으로 state schema를 나누는 것은 초기 전환의 필수조건이 아니다. 필요하면 **동일 Zustand transaction 안의 별도 필드**로 분리한다. 도메인과 레이아웃을 별도 store로 급히 나눠 합류/탈퇴 중 불일치 프레임을 만들지 않는다.

## 8. 파일 변경 계획

아래는 `src/` 기준 초기 파일 분할 계획이다. 실제 구현은 `runtime.ts`에 장면 등록을 함께 두고, 표시 부품은 `PixiVisuals.tsx`에 모았다. 현재 구현 위치는 문서 상단과 코드가 기준이다.

| 파일/영역 | 방침 |
| --- | --- |
| `components/board/SessionBoard.tsx` | DOM shell·modal·effect 유지, renderer host 삽입 |
| `components/board/pixi/PixiBoardCanvas.tsx` | Application·runtime context·renderer 초기화/해제 |
| `components/board/pixi/BoardScene.tsx` | snapshot에서 scene 구성 |
| `components/board/pixi/{PlayerMagnet,TeamCard,CourtCard,DragPreview}.tsx` | Pixi 표시 부품. 기존 DOM dialog 재사용 |
| `components/board/pixi/useInvalidateOnCommit.ts` | 독립 scene commit마다 재그리기 예약 |
| `lib/board/pixi/{runtime,frameScheduler,sceneRegistry}.ts` | 프레임 처리와 등록 인터페이스 |
| `lib/board/pixi/{interactionController,coordinates}.ts` | PointerEvent adapter로 전달된 입력의 상태 기계·좌표 변환 |
| `lib/board/pixi/{projection,texturePool}.ts` | 순수 파생·캐시와 GPU 자산 소유 |
| `hooks/useBoardStageLayout.ts` | Konva 이벤트 분리, 자동 fit·정렬 유지 |
| `hooks/useBoardDragHandlers.ts` | zone/command 의미를 보존하며 renderer 비의존 adapter로 이동 |
| `store/board/viewSlice.ts` | 확정 camera/bounds의 atomic action 추가, 기존 API 유지 |
| `lib/board/*`·membership/match slices·동기화 | 원칙적으로 재사용, 필요한 추출은 기존 테스트로 보호 |

projection·좌표·입력 상태 기계·스케줄러는 실제 브라우저/GPU 없이 단위 테스트할 수 있도록 포트를 둔다. GPU가 필요한 texture 구현은 분리한다. 범용 게임 엔진을 새로 만드는 대신 이 화면에 필요한 기능으로 제한한다.

## 9. 수명 관리·실패 처리

- GPU 생성은 React render/useMemo가 아니라 renderer 준비 이후 effect/runtime에서 수행한다. 비동기 이미지·폰트·초기화 완료 시 session/scene generation을 검사한다.
- `<Application>`이 app destroy를 소유한다. 자식은 rAF·observer·pointer listener·자기 texture lease만 해제하고 app을 이중 destroy하지 않는다. StrictMode 재mount와 초기화 중 화면 이탈을 테스트한다. [Application 8.0.5](https://github.com/pixijs/pixi-react/blob/v8.0.5/src/components/Application.tsx), [unmountRoot](https://github.com/pixijs/pixi-react/blob/v8.0.5/src/helpers/unmountRoot.ts)
- runtime 종료 시 renderer별 TexturePool을 dispose해 미사용 캐시까지 해제한다. 공유 Assets는 해당 lease만 반환한다.
- hidden 중 표시용 timer/animation을 멈추고 복귀 시 기존 foreground 동기화와 최신 scene 재그리기를 수행한다. 복귀를 위한 별도 도메인 시계를 추가하지 않는다.
- WebGL context loss에서는 입력을 취소하고 복구 후 생성 texture를 재준비해 invalidate한다. 복구 불가 시 renderer를 재초기화한다. CPU snapshot은 유지한다. [context 복구](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextrestored_event)
- 단계적 전환 동안 개발/검증용 renderer 전환 기능을 두고 WebGL 초기화 실패 시에도 기존 Konva로 돌아갈 수 있게 한다. 단, **동일 SessionBoard shell 아래 한쪽만 mount**해 동기화/편집권 effect를 중복 실행하지 않는다.
- Konva fallback은 일시적으로 lazy import로 남긴다. 최종 삭제는 지원 기기의 WebGL 확인과 실패 시 운용을 결정한 뒤 진행한다. Pixi의 Canvas fallback을 무조건 사용할 수 있다고 가정하지 않는다.

초기화 실패 감지는 Phase 1의 선결 검증이다. `@pixi/react 8.0.5`의 Application에는 공개 `onError`가 없고 내부 `root.render()` promise를 기다리거나 catch하지 않으므로, React ErrorBoundary만으로 비동기 초기화 실패를 처리한다고 가정하지 않는다. rejection의 host 전달과 실패 root 정리가 검증되지 않으면 바인딩 버전 또는 얇은 초기화 host adapter를 조정한 뒤 진행한다. 전역 unhandled rejection 가로채기를 정상 복구 설계로 삼지 않는다. [Application 초기화 구현](https://github.com/pixijs/pixi-react/blob/v8.0.5/src/components/Application.tsx#L131)

## 10. 구현 순서와 완료 조건

### Phase 0: 현행 기준 고정

기존 순수 함수/store 테스트를 실행하고 동등성 계약을 fixture로 만든다. 익명화된 30/60/100명, 여러 ghost, 꽉 찬 코트, 긴 이름, 사진 있음/없음, 휴식/콕 미확인을 포함한 대표 scene을 준비한다. 동일 fixture·화면 크기·zoom으로 현재 production build의 스크린샷과 performance trace를 확보한다. 사각형만 그리는 벤치로 대체하지 않는다.

설계 작성 시 실행 결과: `pnpm exec vitest run src/lib/board src/store/boardStore.test.ts` — **9개 파일, 179개 테스트 통과**. 아직 실기기 trace나 Pixi 구현 검증 결과는 없다.

### Phase 1: 최소 기능 연결

의존성 도입 후 React 19.2에서 초기 표시·scene 갱신·resize·지연 이미지·StrictMode·이탈을 확인한다. 초기화 rejection의 host 전달·실패 root 정리·fallback 전환까지 통과해야 다음 단계로 간다. 처음부터 on-demand scheduler와 commit-invalidate를 연결한다. 실제 외형의 자유 자석 하나와 그 ghost를 표시하고 texture 공유까지 작동시킨다.

### Phase 2: 표시 이식

projection, 모든 종류의 자석/카드, 원점 고정 zoom, DOM과의 위치 관계를 구현한다. 기존 store를 입력으로 현행/Pixi를 전환 비교한다. 아직 편집 입력은 켜지 않는다. 문구·색·crop·문자 배치·겹침·자동 배치의 동등성을 확인한다.

### Phase 3: 입력과 기존 명령 연결

자유→anchor→ghost→playing→카드 순서로 drag, tap/doubletap/longpress, 외부 zone, pinch/wheel을 연결한다. 권한 상실·source 삭제·무효 drop·동일 선수의 여러 ghost·두 손가락 개입을 테스트한다. 종료 시에만 위치/scale을 commit하는 경계를 완성한다.

추가 경계 fixture: 흩어지는 자석 중간 위치에서 잡기, 2인 팀 해체를 동반한 정상 drop 인계, 0.8→0.9→0.8 왕복 핀치의 사용자 배율 저장, 팀/코트 drag 및 핀치 중 원격 변경/resize. 시각 위치와 저장 위치의 경계를 테스트로 고정한다.

### Phase 4: 실기기 검증·조정

사용자가 느리다고 느낀 기기를 포함해 iOS Safari/PWA·Android Chrome의 production build를 비교한다. 화면 녹화/측정 자체 부하를 고려하고 같은 조건을 여러 번 측정한다. 결과에 따라 DPR, texture bucket/LRU budget, 캐시 범위, 후보 index 도입을 판단한다.

### Phase 5: 전환·구 코드 정리

새 renderer를 기본으로 전환하고 fallback 운용 기간 동안 구 renderer를 lazy load로 보유한다. 기능/성능/기기 검증을 통과하고 fallback 종료를 결정한 뒤 구 Konva 부품·전용 hooks·`konvaEvents.ts`·`konva`/`react-konva`/`use-image`를 제거한다. 다른 용도 import가 없는지 `rg`로 확인한다. DB migration은 필요 없다.

### 검증 게이트

| 축 | 합격 조건/기록 |
| --- | --- |
| 기능 | 기존 board tests 통과 + 위 입력/권한 controller 계약 테스트 + 실제 브라우저 조작 검증 |
| 외관 | 동일 fixture/viewport/scale/font 비교. 렌더러의 미세한 AA 차이와 배치/문자 누락을 구분 |
| 프레임 | drag·team/court 이동·pinch별 frame interval p50/p95/p99와 refresh interval 초과율을 현행 비교 |
| 입력 지연 | pointer sample부터 canvas 그리기 제출까지 측정, 실제 표시 지연은 화면 기록 등으로 보완. 의도된 tap 대기 280ms와 분리 |
| 목표 | 대표 fixture에서 60Hz의 16.7ms 예산 이내를 목표로 함. 120Hz는 8.3ms로 별도 평가. 달성했다고 선기재하지 않음 |
| 불필요한 그리기 | asset 준비 완료·점멸/animation 없음·상태 불변 시 draw 0, 지속 rAF 0 |
| 이동 중 부하 | team/court 좌표·pinch scale의 프레임 store write 0, 드래그에 의한 매 frame 직렬화/저장 0, 준비된 외형의 위치 이동만으로 texture 재생성 0 |
| 메모리 | texture 수/추정 bytes/cache hit 기록. 화면 출입·사진 변경·ghost 증감 시 지속 증가 및 공유 asset 오파괴 없음 |
| 복구 | 초기화 실패·context loss·비표시 복귀·통신 갱신 중 drag·편집권 상실·unmount 시 고착/이중 명령 없음 |
| 배포 | build·타입 검사, 추가 bundle size와 보드 최초 표시 시간 비교. 다른 화면에서 Pixi eager load 방지 |

성능 판정은 라이브러리 이름이 아니라 이 기준과 실측으로 한다. 매 프레임 복잡한 도형 재그리기, 이동에 따른 store 전파를 줄이고 상시 렌더 루프를 새로 만들지 않는다. 같은 기능·외형을 유지한 상태에서 개선을 확인한다.
