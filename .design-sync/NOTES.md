# design-sync 메모 (콕타임 회비 관리 → Claude Design)

## 이 저장소의 성질

- **앱 저장소이고 컴포넌트 라이브러리가 아니다.** `package.json` 에 엔트리·`dist` 라이브러리 산출이
  없다. 그래서 `.design-sync/entry.tsx`(회비 화면 10개 재export)를 만들어 `--entry` 로 넘긴다.
  엔트리를 안 주면 변환기가 `node_modules/<pkg>/package.json` 을 찾다가 ENOENT 로 죽는다.
- Storybook 없음 → `shape: "package"`. `.d.ts` 트리가 없어 컴포넌트 자동 발견이 0건이므로
  `componentSrcMap` 에 10개를 **명시**한다(비우면 `[ZERO_MATCH]`).
- `cssEntry` 는 **컴파일된 앱 CSS**(`dist/assets/index-*.css`)를 안정 경로로 복사한
  `.design-sync/compiled.css` 다. Tailwind v4 유틸 + `index.css` 전역 토큰 + `accounting.css` 가
  한 파일에 다 들어와야 카드가 앱과 같은 모습이 된다. 해시가 매 빌드 바뀌므로 `buildCmd` 가
  빌드와 복사를 같이 한다.
- 프리뷰 셀 이름은 **PascalCase ASCII 만 인식된다.** 한글 export 로 쓰면 셀 0개(빈 카드)가 된다.

## 프리뷰 런타임 (`.design-sync/preview-runtime.tsx`)

앱 소스를 건드리지 않기 위해 프리뷰 전용 코드는 전부 여기 있다. `extraEntries` 로 번들에 합쳐
`window.Cocktime.DuesPreview` / `.duesFixture` 로 노출된다.

- `duesFixture` — 표본 `AccountingData`. **자기정합성을 지켜야 한다**: 입금 한 건의
  `positions`+`allocations` 합이 입금액과 같아야 환불 후보의 '환불 가능액'이 맞게 나온다
  (입금 91 을 3,000 만 표현했다가 환불 카드가 '잔액 없음'으로 굳었던 적 있음).
- `DuesPreview` — ①`MemoryRouter` + `Routes`(`/dues/:ym/:page`, 진입 `/dues/2026-09/inbox`).
  라우트를 실제로 물려야 `useParams` 가 채워진다. 안 물리면 화면 단위 컴포넌트가 `currentYm()`
  으로 떨어져 픽스처가 없는 달의 0원 화면이 된다. ②`useAuthStore`/`useAccountingStore` 시딩.
  ③`window.fetch` 스텁(`/rest/v1/rpc/<name>` → `RPC_STUB`). 스텁이 없으면 인라인 정산의 프리뷰
  요청이 네트워크에서 실패해 확정 버튼이 영구 비활성으로 보인다.
- `src/lib/supabase/client.ts` 는 Vite 밖에서 로드될 때를 대비해 env 없으면 자리값으로 떨어지게
  고쳐 뒀다(모듈 스코프 `createClient` 가 던지면 임포트 그래프 전체가 죽는다).

## Known render warns (재동기화 때 이 목록과 대조할 것)

- `[TOKENS_MISSING]` — `--join-delay, --party-progress, --x, --y, --d, --delay, --dx, --dy`.
  보드·파티 애니메이션이 **런타임에 인라인 style 로 주입**하는 변수다. 정상.
- `[FONT_MISSING]` 은 `runtimeFontPrefixes`(SF Pro / Apple SD Gothic Neo / Pretendard / 이모지)로
  억제했다. 이 앱은 **웹폰트를 배포하지 않는다**(저장소에 woff2 0개) — 스택 전체가 OS 제공
  시스템 폰트이고, 그게 앱의 의도다. 대체 폰트를 끼워 넣지 말 것.

## 캡처 환경 특성

- 캡처용 chromium 의 시계가 **2024-05** 로 보인다(호스트는 2026-09). `currentYm()` 을 쓰는
  UI(회원 화면의 '이번에 낼 돈', 월 셀렉터 기본값)는 그래서 카드에서 0원/과거 달로 보일 수
  있다. 제품(claude.ai/design)에서는 실제 시계로 계산되므로 카드 채점 때만 감안한다.


## 재동기화 위험 (Re-sync risks)

- **`duesFixture` 가 `AccountingData` 타입과 어긋날 수 있다.** 서버 payload/타입이 바뀌면 픽스처는
  조용히 낡는다. 타입 변경 커밋에서 이 파일도 같이 고칠 것.
- **`.design-sync/entry.tsx` 는 손으로 관리한다.** `src/components/accounting/` 에 컴포넌트를
  추가/삭제하면 엔트리와 `componentSrcMap` 을 같이 고쳐야 한다(자동 발견이 없다).
- **`RPC_STUB` 은 실제 RPC 응답 모양을 흉내낸 것**이다. `dues_v2_ledger` 등의 반환 모양이 바뀌면
  카드가 조용히 빈 상태로 렌더된다.
- `cssEntry` 가 컴파일 산출이라 **`pnpm run build` 를 먼저 돌려야** 최신 스타일이 반영된다
  (`buildCmd` 가 그것까지 한다).
- **`guidelinesGlob` 을 좁혀 뒀다**(`docs/ACCOUNTING_SPEC.md` 하나). 기본값(`docs/*.md`)은 팀매칭·
  보드·DB 설계 등 회비와 무관한 내부 문서 21개(604KB)를 디자인 프로젝트로 올린다 — 에이전트가
  잘못된 맥락을 참고하고, 프로젝트를 공유하면 내부 스펙이 함께 나간다. 넓히려면 이 값을 고칠 것.
- 재동기화는 업로드된 `_ds_sync.json` 을 앵커로 쓴다. 드라이버 한 줄로 끝난다(§5 "Re-syncs are
  one command"): 앵커를 `.design-sync/.cache/remote-sync.json` 으로 받아 `resync.mjs --remote` 로
  실행하면 바뀐 컴포넌트만 다시 검증한다.

## 업로드 기록

- 프로젝트: **콕타임 디자인 시스템** `9b0c4244-eed1-4710-b4fb-6316f80eb780`
  (https://claude.ai/design/p/9b0c4244-eed1-4710-b4fb-6316f80eb780) — `config.json` 의
  `projectId` 가 이 프로젝트를 가리킨다.
- 증분 경로(빈 프로젝트)로 승인 1회. 65개 파일 업로드 후 `list_files` 로 원격=최종 빌드 확인.
  정리할 고아 파일 없음. 앵커(`_ds_sync.json`)를 마지막에 올렸다.

## 검증 상태 (이번 실행)

- `package-validate.mjs`: 11/11 렌더 클린, `.d.ts` 11/11 파싱, `window.Cocktime` 14 exports.
- 프리뷰: 10개 컴포넌트 24셀 전부 authored + `good` 채점. 전체 캡처에서 10개 carried forward.
- 프리뷰가 실제 결함 1건을 잡아 앱 CSS 를 고쳤다: 아바타형 픽커의 체크 아이콘이 모든 행에
  보였다(`.ac-person-check` 를 `aria-pressed` 로 게이팅).
