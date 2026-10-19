import type { BillingGroup, Charge } from "./types";

/** 서버 엔빵 규칙 미러: 10원 절상 후, [정액, 정액+200) 이면 정액으로 내린다(한방향). */
export function splitPerHead(
	total: number,
	head: number,
	flatFee: number | null,
): number {
	const per = Math.ceil(total / head / 10) * 10;
	return flatFee !== null && per >= flatFee && per < flatFee + 200
		? flatFee
		: per;
}

export interface SplitDrift {
	total: number;
	head: number; // 지금 살아 있는 부과 인원
	issuedHead: number | null; // 발행 당시 인원(basis.head)
	perHead: number; // 지금 인원으로 다시 나눈 1인 금액
	charged: number[]; // 현재 부과된 금액 종류
	shortfall: number; // 재분배하면 더 걷을 총액(음수면 돌려줄 돈)
	liveIds: string[];
}

/**
 * 엔빵 회차인데 부과가 지금 인원으로 나눈 금액과 어긋났는가.
 * 엔빵 발행 뒤 누군가의 부과를 취소하면(예: 당일취소 면제) 남은 사람 금액은 그대로라
 * 총액이 덜 걷히는데도 '완납'으로 보인다. 그 상태를 잡아 재분배 금액을 알려 준다.
 */
export function splitDrift(
	group: BillingGroup,
	charges: Charge[],
	flatFee: number | null,
): SplitDrift | null {
	const total = group.basis?.total;
	if (group.kind !== "court" || typeof total !== "number" || total <= 0)
		return null;
	const live = charges.filter(
		(c) => c.group_id === group.id && c.state === "live",
	);
	if (!live.length) return null;
	// 금액이 사람마다 다르면 운영진이 일부러 조정한 것 — 일괄 재분배로 덮지 않는다.
	if (new Set(live.map((c) => c.amount)).size > 1) return null;
	const perHead = splitPerHead(total, live.length, flatFee);
	if (live.every((c) => c.amount === perHead)) return null;
	// 서버 생성기 amount_out_of_range 와 같은 기준(정액의 0.5~2.5배). 진행 중 회차의 선납 몇 명처럼
	// 아직 전원이 발행되지 않은 그룹은 여기서 걸러진다(서버도 종료 회차만 재분배한다).
	if (flatFee !== null && (perHead * 2 < flatFee || perHead * 2 > flatFee * 5))
		return null;
	const issuedHead = group.basis?.head;
	return {
		total,
		head: live.length,
		issuedHead: typeof issuedHead === "number" ? issuedHead : null,
		perHead,
		charged: [...new Set(live.map((c) => c.amount))].sort((a, b) => a - b),
		shortfall:
			perHead * live.length - live.reduce((sum, c) => sum + c.amount, 0),
		liveIds: live.map((c) => c.id),
	};
}
