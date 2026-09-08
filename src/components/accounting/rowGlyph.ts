/**
 * 행 거터의 상태 표기. 색 하나로 상태를 말하지 않기 위해 글리프·색·상태어를
 * 한 곳에서 함께 결정한다(흑백 인쇄·색각·야간 저조도에서도 3분류가 유지된다).
 *
 * - settled 정착: 확인만 하면 되는 것 / 완납 / 연결 완료
 * - ask     대기: 판단이 필요한 것 / 미납 / 미연결
 * - stop    차단: 막힌 것 / 되돌림 / 오류
 * - none    해당 없음: 부과 제외처럼 금액이 죽은 행
 */
export type RowTone = "settled" | "ask" | "stop" | "none";

const GLYPH: Record<RowTone, string> = {
	settled: "✓",
	ask: "?",
	stop: "!",
	none: "—",
};
const CLASS: Record<RowTone, string> = {
	settled: "is-ok",
	ask: "is-ask",
	stop: "is-stop",
	none: "",
};

export function rowGlyph(tone: RowTone): string {
	return GLYPH[tone];
}

/** 거터·상태어에 붙일 색 클래스. */
export function toneClass(tone: RowTone): string {
	return CLASS[tone];
}

/** 입출금 방향은 색이 아니라 한 글자로 거터에 둔다(적록색각에서도 읽힌다). */
export function directionMark(direction: "in" | "out"): "입" | "출" {
	return direction === "in" ? "입" : "출";
}
