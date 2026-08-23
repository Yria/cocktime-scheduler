// 대관비 부과 방식 안내(엔빵 / 정액 / 무부과) — 규칙·회차 에디터 공용.
// total = 대관 총액(원). null = 미입력 → 정액(회계 설정의 인당 대관비) / 0 이하 = 이 회차는 안 걷음 /
// >0 = 엔빵(부과 대상 인원으로 나눔).
// ⚠ 서버 dues_generate_session_court 의 분기와 **반드시 일치**시킬 것 — 0 을 정액으로 읽어
//   총액 0원 회차에 6,000원이 부과된 사고가 있었다(세션 228, 2026-08-22 / 20260823000000).

/** 총액 문자열을 부과용 값으로 파싱. 빈값 → null(규칙 기본값/정액). 음수·비정수는 null 취급하지 않고 그대로 반환해 검증은 호출부가. */
export function parseCourtFee(raw: string): number | null {
	const t = raw.trim();
	if (t === "") return null;
	const n = Number(t);
	return Number.isFinite(n) ? Math.round(n) : null;
}

/** 부과 방식 한 줄 안내. 서버 분기와 1:1 — 미입력=정액 / 0 이하=무부과 / 0 초과=엔빵. */
export function courtFeeChargeHint(total: number | null): string {
	if (total == null) return "총액 미입력 · 정액(회계 설정의 인당 대관비)이 부과돼요";
	if (total === 0) return "0원 · 이 회차는 회원에게 대관비를 걷지 않아요";
	if (total < 0) return "총액이 음수예요 · 부과되지 않습니다(0 이하는 안 걷음)";
	// 부과 대상 = 참석 + 당일취소(자리값). 인당은 10원 절상하고, 정액과 200원 미만 차이면 정액으로 맞춘다.
	return `엔빵 · 총 ${total.toLocaleString("ko-KR")}원을 참석·당일취소 인원으로 나눠 부과(10원 절상)`;
}
