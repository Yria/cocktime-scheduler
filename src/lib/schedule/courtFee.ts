// 대관비 부과 방식 안내(엔빵 / 정액) — 규칙·회차 에디터 공용.
// total = 대관 총액(원). null/0 = 총액 없음 → 정액(회계 설정의 인당 대관비). >0 = 엔빵(참석 인원으로 나눔).

/** 총액 문자열을 부과용 값으로 파싱. 빈값 → null(규칙 기본값/정액). 음수·비정수는 null 취급하지 않고 그대로 반환해 검증은 호출부가. */
export function parseCourtFee(raw: string): number | null {
	const t = raw.trim();
	if (t === "") return null;
	const n = Number(t);
	return Number.isFinite(n) ? Math.round(n) : null;
}

/** 부과 방식 한 줄 안내. total>0 → 엔빵, 아니면 정액. */
export function courtFeeChargeHint(total: number | null): string {
	if (total != null && total > 0) {
		// 부과 대상 = 참석 + 당일취소(자리값). 인당은 10원 절상하고, 정액과 200원 미만 차이면 정액으로 맞춘다.
		return `엔빵 · 총 ${total.toLocaleString("ko-KR")}원을 참석·당일취소 인원으로 나눠 부과(10원 절상)`;
	}
	return "총액 미입력 · 정액(회계 설정의 인당 대관비)이 부과돼요";
}
