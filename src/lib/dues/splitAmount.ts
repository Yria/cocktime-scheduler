// 수동 부과 금액 계산 — 총액 엔빵 또는 인당 직접.
//
// 대관비 엔빵(서버 dues_generate_session_court)과 **별개 규칙**이다. 대관비는 10원 절상 + 정액 근처
// 스냅이 붙지만, 여기는 회식·공동구매처럼 "1,000원 단위로 딱 떨어지게 걷는" 실무가 흔해서 절상 단위를
// 운영진이 고른다. 그래서 서버 산식을 재사용하지 않고 이 모듈로 분리했다(둘을 엮으면 한쪽 규칙을
// 바꿀 때 다른 쪽이 조용히 따라 움직인다).
//
// 부과합이 총액과 어긋나는 건 정상이다(절상하면 더 걷힌다). 그 차액을 숨기지 않고 `diff` 로 돌려주는 게
// 이 모듈의 요점 — 화면이 "남는 돈 3,400원"을 항상 보여줘야 총무가 총액을 다시 안 센다.

export const ROUND_UNITS = [10, 100, 1000] as const;
export type RoundUnit = (typeof ROUND_UNITS)[number];

export type SplitMode = "total" | "perHead";

export interface SplitInput {
	mode: SplitMode;
	/** 엔빵할 총액(원). mode='perHead' 면 비교용(없으면 null). */
	total: number | null;
	/** 인당 금액(원). mode='total' 이면 무시. */
	perHead: number | null;
	/** 부과 대상 인원. */
	head: number;
	/** 인당 금액을 올릴 단위. */
	unit: RoundUnit;
}

export interface SplitResult {
	/** 1인당 부과액(원). */
	perHead: number;
	head: number;
	/** 실제 부과 합계 = perHead × head. */
	charged: number;
	/**
	 * 부과합 − 총액. >0 = 총액보다 더 걷힘(잔돈이 통장에 남는다), <0 = 모자람(통장이 메꿔야 한다).
	 * 비교할 총액이 없으면 0.
	 */
	diff: number;
}

const EMPTY: SplitResult = { perHead: 0, head: 0, charged: 0, diff: 0 };

/**
 * 인당 금액과 부과합을 구한다. 순수함수 — 화면은 입력이 바뀔 때마다 그냥 다시 부른다.
 * 음수·비정수 입력은 0 이하로 눌러 정리한다(부과에 음수가 흘러가면 정산이 어긋난다).
 */
export function splitAmount(input: SplitInput): SplitResult {
	const head = Math.max(0, Math.floor(input.head));
	const total = input.total != null && input.total > 0 ? Math.round(input.total) : null;

	if (head === 0) {
		// 대상이 없으면 나눗셈을 하지 않는다(총액만 있으면 전액이 '모자람'으로 보인다).
		return { ...EMPTY, diff: total != null ? -total : 0 };
	}

	const perHead =
		input.mode === "total"
			? total == null
				? 0
				: Math.ceil(total / head / input.unit) * input.unit
			: Math.max(0, Math.round(input.perHead ?? 0));

	const charged = perHead * head;
	return { perHead, head, charged, diff: total == null ? 0 : charged - total };
}

/** 차액 한 줄 설명 — 화면 세 곳에서 같은 문구를 쓰도록 여기 둔다. */
export function diffHint(diff: number): string | null {
	if (diff === 0) return null;
	const won = Math.abs(diff).toLocaleString("ko-KR");
	return diff > 0 ? `${won}원 더 걷힘` : `${won}원 모자람`;
}
