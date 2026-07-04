import type { CSSProperties } from "react";

/**
 * 폼 필드 공용 스타일 — schedule/styles.ts 에 있던 labelCls/inputCls/inputStyle/selectStyle/labelStyle
 * 를 표준으로 승격. schedule 에디터·ProfileSetup·KakaoLocationSearch·MemberAdminPage 계열이
 * 이 모듈을 import 한다.
 */

export const labelCls = "text-muted block mb-1.5";
export const inputCls =
	"w-full bg-white dark:bg-[rgba(30,30,35,0.8)] text-strong border border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.12)]";
export const inputStyle: CSSProperties = {
	padding: "11px 13px",
	borderRadius: 10,
	fontSize: 15,
	outline: "none",
	// flex 행(시간 input·장소 select 등)에서 네이티브 위젯의 intrinsic min-content가
	// 부모를 밀어내 모달 밖으로 넘치지 않도록 input 자체의 최소폭을 0으로. (selectStyle 도 상속)
	minWidth: 0,
};

// select 전용: 네이티브 화살표를 끄고 커스텀 화살표를 우측에서 14px 띄워 배치.
// paddingRight 로 옵션 텍스트가 화살표에 닿지 않게 한다.
export const selectStyle: CSSProperties = {
	...inputStyle,
	paddingRight: 38,
	appearance: "none",
	WebkitAppearance: "none",
	MozAppearance: "none",
	backgroundImage:
		"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5l3.5 3.5 3.5-3.5' fill='none' stroke='%2394a3b8' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
	backgroundRepeat: "no-repeat",
	backgroundPosition: "right 14px center",
	backgroundSize: "12px 12px",
};
export const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600 };
