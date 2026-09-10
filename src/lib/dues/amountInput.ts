/**
 * 금액 입력의 키패드 계약. src/components/accounting 전체에 inputMode·enterKeyHint
 * 가 한 건도 없어서 모바일에서 숫자 칸에 문자 키보드가 떴다.
 *
 * `type="number"`(role=spinbutton)는 유지한다 — 정산함의 선택 금액 칸이 그 역할로
 * 접근되고 min/max 검증도 거기에 걸려 있다. inputMode·enterKeyHint 는 공존한다.
 */
export const amountInputProps = {
	inputMode: "numeric" as const,
	enterKeyHint: "done" as const,
	autoComplete: "off" as const,
};
