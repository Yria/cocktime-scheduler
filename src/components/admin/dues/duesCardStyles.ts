// 회비 관리 카드의 **공용 시각 언어** — 스타일 편. 원래 SessionsHome 안에만 있었다.
//
// 왜 꺼냈나: 같은 화면에 사는 부과 카드(회비·대관비·수동 부과)가 각자 자기 파일에서 배지와 막대를
// 다시 그리고 있었고, 그래서 수동 부과만 다르게 보였다("수동부과도 다른 부과처럼 보이게" 2026-08-23).
// 배지·판정 아이콘·진행 막대를 여기 한 곳에 두면 카드가 늘어도 같은 언어로 읽힌다.
//
// 읽는 규칙(중요): `mark` 의 ✓/! 는 **사람이 처리해야 할 일이 남았는지**만 말한다 — 금액·인원 같은
// 사실은 마크 없이 적는다. 마크를 정보 표시에 남용하면 빨간 !가 흔해져서 아무도 안 본다.

import type { CSSProperties } from "react";

/** 카드 우상단 상태 배지. ok=마감 / warn=미완 / info=예정 / bad=확인 필요. */
export function pill(kind: "ok" | "warn" | "info" | "bad"): CSSProperties {
	const map = {
		ok: { background: "rgba(52,199,89,0.16)", color: "#1c8a3b" },
		warn: { background: "rgba(255,149,0,0.16)", color: "#c2670a" },
		info: { background: "rgba(11,132,255,0.14)", color: "#0b84ff" },
		bad: { background: "rgba(209,54,44,0.14)", color: "#d1362c" },
	}[kind];
	return { fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, ...map };
}

/** 판정 한 줄 앞의 원형 아이콘 — 끝났으면 초록 ✓, 남았으면 빨간 !. */
export function mark(ok: boolean): CSSProperties {
	return { width: 14, height: 14, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 9, fontWeight: 900, color: "#fff", background: ok ? "#1c8a3b" : "#d1362c", flexShrink: 0 };
}

/** 부과 카드의 겉면 — 흰 카드 + 같은 라운드/패딩. 끝난 카드는 살짝 흐리게. */
export const cardBox = (done = false): CSSProperties => ({
	borderRadius: 12,
	padding: "11px 13px",
	opacity: done ? 0.85 : 1,
});

/** 겉면 클래스(다크 모드 포함) — style 과 함께 쓴다. */
export const CARD_CLASS =
	"bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]";
