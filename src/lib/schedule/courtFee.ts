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

/** 총액 변경 결과 숫자(서버 dues_set_session_fee 반환의 부분집합). */
export interface CourtFeeResetResult {
	per_head?: number | null;
	unchanged?: boolean;
	cancelled?: number;
	paid_cancelled?: number;
	released_amount?: number;
	reused_amount?: number;
	left_as_balance?: number;
	reissued?: number;
	issued_new?: number;
	held: number;
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/**
 * 총액 변경 확인창 본문 — 미리보기 결과로 무엇이 일어나는지 문장으로.
 * total = 새 총액(null=정액), closed = 종료 회차(종료 전이면 발행은 종료 때).
 */
export function courtFeeResetLines(
	r: CourtFeeResetResult,
	opts: { total: number | null; closed: boolean },
): string[] {
	const cancelled = r.cancelled ?? 0;
	const reissued = r.reissued ?? 0;
	const issuedNew = r.issued_new ?? 0;
	const reused = r.reused_amount ?? 0;
	const balance = r.left_as_balance ?? 0;
	const noCharge = opts.total != null && opts.total <= 0;
	const perHead = r.per_head != null && r.per_head > 0 ? r.per_head : null;
	const lines: string[] = [];
	if (r.unchanged)
		lines.push("인당 금액은 그대로라 부과는 바뀌지 않아요. 총액만 저장합니다.");
	if (cancelled > 0) {
		lines.push(
			noCharge || reissued === 0
				? `기존 대관비 ${cancelled}건을 모두 취소합니다.${noCharge ? " 이 회차는 대관비를 걷지 않아요." : ""}`
				: `기존 대관비 ${cancelled}건을 모두 취소하고${perHead ? ` 인당 ${won(perHead)}으로` : ""} 다시 발행합니다.`,
		);
		if (cancelled > reissued && reissued > 0)
			lines.push(`대상에서 빠진 ${cancelled - reissued}명은 취소만 돼요.`);
		const paid = r.paid_cancelled ?? 0;
		if (paid > 0) {
			lines.push(
				`이미 낸 ${paid}건(${won(r.released_amount ?? 0)})은 납부 연결이 풀려요.`,
			);
			if (reused > 0)
				lines.push(`그중 ${won(reused)}은 같은 회원의 새 부과에 자동으로 다시 연결돼요.`);
		}
		if (balance > 0)
			lines.push(
				`${won(balance)}은 낸 회원의 잔액으로 남아요. 환불·이월은 회비 관리에서 처리해 주세요.`,
			);
	}
	if (issuedNew > 0)
		lines.push(
			cancelled > 0
				? `새로 대상이 된 ${issuedNew}명에게도 발행해요.`
				: `${perHead ? `인당 ${won(perHead)}으로 ` : ""}${issuedNew}명에게 발행합니다.`,
		);
	if (r.held > 0)
		lines.push("인당 금액이 평소와 달라 회비 관리의 발행 대기로 보내요.");
	if (lines.length === 0)
		lines.push(
			noCharge
				? "총액만 저장합니다. 이 회차는 대관비를 걷지 않아요."
				: opts.closed
					? "총액만 저장합니다. 경기 기록이 없어 발행되지 않아요 — 필요하면 회비 관리에서 직접 발행해 주세요."
					: "총액만 저장합니다. 부과는 회차 종료 때 발행돼요.",
		);
	return lines;
}

/** 회차 수정 후 토스트. recharged=총액·대관장소 여부가 바뀌어 부과를 다시 맞춤. */
export function occurrenceEditToast(
	r: CourtFeeResetResult & { recharged: boolean },
): string {
	if (!r.recharged) return "회차를 저장했어요";
	if (r.unchanged) return "회차를 저장했어요 · 부과는 그대로예요";
	return ["회차를 저장했어요", ...resetParts(r)].join(" · ");
}

/** 확인창을 띄울 만큼 부과가 바뀌는가(취소·발행·발행 대기 중 하나라도). */
export function resetTouchesCharges(r: CourtFeeResetResult): boolean {
	return (
		!r.unchanged &&
		(r.cancelled ?? 0) + (r.reissued ?? 0) + (r.issued_new ?? 0) + r.held > 0
	);
}

function resetParts(r: CourtFeeResetResult): string[] {
	const parts: string[] = [];
	if ((r.cancelled ?? 0) > 0) parts.push(`기존 ${r.cancelled}건 취소`);
	const issued = (r.reissued ?? 0) + (r.issued_new ?? 0);
	if (issued > 0) parts.push(`${issued}건 발행`);
	if ((r.left_as_balance ?? 0) > 0)
		parts.push(`잔액 ${won(r.left_as_balance ?? 0)} 남음`);
	if (r.held > 0) parts.push("발행 대기");
	return parts;
}
