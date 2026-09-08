## 이 디자인 시스템으로 만들 때 (콕타임 회비 관리)

한국어 화면입니다. 모든 UI 문구는 한국어로 씁니다. 대상은 동호회 운영진(총무) 1~2명이고,
매체는 **모바일 우선 PWA**(설치형 포함)입니다. 화면의 본업은 *한 달치 금액 16~40건을 눈으로
대조하는 것*입니다.

### 1. 반드시 감싸기 — 토큰이 스코프에 선언되어 있다

모든 `--ac-*` 토큰은 `.accounting-screen` 에 선언됩니다. 이 클래스로 감싸지 않으면 컴포넌트가
전역 기본 스타일로 렌더되어 색·간격·활자가 전부 어긋납니다. 다크 모드는 조상의 `.dark` 클래스로
토글합니다(`prefers-color-scheme` 아님).

```jsx
<div className="dark">                     {/* 다크는 이 클래스로만 */}
  <div className="accounting-screen">      {/* 토큰 스코프 — 생략 금지 */}
    <TransactionCard data={data} transaction={tx} disabled={false}
      onDone={refresh} onPendingChange={() => {}} onMonth={() => {}} />
  </div>
</div>
```

화면 단위 컴포넌트(`AccountingAdmin`, `AccountingMember`)는 라우터와 스토어(로그인 회원·회계
모드)를 읽습니다. 데이터 없이 렌더하면 '불러오는 중…' 한 줄로 굳으므로, 표본 데이터로 감싼
`DuesPreview` 를 쓰세요 — 라우터(`/dues/:ym/:page`)와 스토어 시딩, RPC 스텁을 함께 제공합니다.
`duesFixture` 는 그 표본 `AccountingData` 이고, prop 으로 데이터를 받는 컴포넌트에도 그대로
넘길 수 있습니다.

### 2. 스타일 어휘 — 유틸리티가 아니라 **행 프리미티브**부터

레이아웃 글루는 Tailwind v4 유틸(`flex`, `gap-3`, `text-strong`, `text-muted`)을 쓰되,
**금액이 있는 줄은 반드시 `.ac-row`** 로 만듭니다. 그래야 4탭에서 금액이 같은 x 좌표에
떨어집니다(이 시스템의 존재 이유). 자식 순서가 곧 열입니다.

| 역할 | 클래스 |
|---|---|
| 행 | `.ac-row` = `거터 | 본문 | 금액 레일`, 회계 탭은 `.ac-row.has-balance`(잔액 레일 추가) |
| 행 내부 | `.ac-row-gutter`(입/출·상태 글리프, `.is-ok`·`.is-ask`·`.is-stop`), `.ac-row-body`, `.ac-row-note`(근거줄), `.ac-row-state`(상태어) |
| 금액 | `.ac-amount`(우측 고정 레일, tabular+nowrap 강제), `.ac-amount-2`(잔액), 합계 행은 `.ac-row.ac-total` |
| 표면(화면당 3종) | `.ac-sheet` + `.ac-sheet-head`(목록 시트) · `.ac-card`(단건 카드) · `.ac-armed`(지금 편집 중인 전표) |
| 구획 | `.ac-band`(3px 틴트 밴드), `.ac-empty`(빈 상태) |
| 컨트롤 | `.ac-chip`(선택은 `aria-pressed="true"` → 잉크 반전), `.ac-segment`(3지 세그먼트), `.ac-badge.is-green\|is-amber\|is-neutral\|is-blue`, `.ac-field`(입력), `.ac-search`, `.ac-link`, `.ac-meter` + `.ac-meter-line` |
| 알림·위험 | `.ac-notice.is-ask\|is-stop`, `.ac-undo-block` + `.ac-btn-undo`(비가역 처리는 채움 버튼이 아니라 외곽선), `.ac-inline-confirm`(확정) |
| 셸 | `.ac-month`, `.ac-tabs`(현재 탭은 `aria-current="page"`), `.ac-bar` + `.ac-bar-jump`(이동 링크) |

토큰으로 직접 그릴 때: 먹 `--ac-ink` / `--ac-ink-2` / `--ac-ink-3`, 지면 `--ac-paper` ·
`--ac-fill`, 규칙선 `--ac-rule` · `--ac-rule-strong`, 상태 `--ac-ok`(+`-soft`, 채움 버튼은
`--ac-ok-solid`) · `--ac-ask`(+`-soft`) · `--ac-stop`(+`-soft`), 행동 `--ac-act`(+`-soft`,
`-line`), 선택 `--ac-sel-bg` / `--ac-sel-fg`, 레이아웃 `--ac-gutter` · `--ac-rail`,
간격 `--ac-s-1`…`--ac-s-6`, 반경 `--ac-r-chip|field|card|sheet`, 활자
`--ac-fs-meta|body|name|input|amount|total|metric`. 앱 전역 토큰(`--ios-blue`, `--tone-strong`)과
알약 버튼(`.btn-lq-primary`·`.btn-lq-secondary`)도 같은 스타일시트에 있습니다.

### 3. 지켜야 하는 규율 네 개

1. **금액은 항상** `won()`/`signed()` 문구 + `.ac-amount`. tabular-nums·줄바꿈 금지가 레일에
   걸려 있으니 개별 노드에 직접 쓰지 마세요.
2. **상태를 색 하나로 말하지 않습니다.** 거터 글리프(`✓ ? ! —`) + 상태어(완납·미납·납기 이월·
   부과 제외) + 색의 3중 인코딩입니다.
3. **선택은 잉크 반전 하나**(`aria-pressed`). 현재 탭(`aria-current`)은 지면 색으로 구분합니다.
4. **고정높이·내부 스크롤·`position: sticky` 금지.** 앱 셸이 body 자연 스크롤이라 카드 안에
   스크롤 박스를 만들면 iOS 에서 하단이 잘립니다. 확정 버튼은 편집 중인 블록 바로 아래 자연
   흐름에 둡니다. 터치 타깃은 44px.

### 4. 진짜 근거는 파일에

스타일 단일 소스는 `_ds/<folder>/styles.css`(→ `_ds_bundle.css`)입니다. 색·간격·활자를 고칠 때는
거기 선언된 토큰을 보고 쓰세요. 컴포넌트별 API 는 `<Name>.d.ts`, 조합 예시는 `<Name>.prompt.md`
입니다. 화면 규약(표기·깊이·레이아웃)은 저장소의 `docs/ACCOUNTING_SPEC.md` §3.7 에 있습니다.
