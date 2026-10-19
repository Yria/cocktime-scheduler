import { describe, expect, it } from "vitest";
import { splitDrift, splitPerHead } from "./splitDrift";
import type { BillingGroup, Charge } from "./types";

const group = (total: number | null, head = 17): BillingGroup => ({
	id: "g",
	source_key: "court:395",
	kind: "court",
	label: "10/18 #395",
	occurred_on: "2026-10-18",
	session_id: 395,
	basis: { rule: "court", total, head, per_head: 6000 },
});
const charges = (n: number, amount: number, cancelled = 0): Charge[] =>
	Array.from({ length: n + cancelled }, (_, i) => ({
		id: `c${i}`,
		legacy_id: null,
		group_id: "g",
		member_id: `m${i}`,
		amount,
		state: i < n ? "live" : "cancelled",
		previous_id: null,
		payer_hint: null,
		issued_at: "2026-10-19T02:28:07Z",
	}));

describe("splitPerHead", () => {
	it("정액 근처는 정액으로 내린다(104,000÷17=6,120→6,000)", () => {
		expect(splitPerHead(104000, 17, 6000)).toBe(6000);
	});
	it("밴드 밖은 그대로(104,000÷16=6,500)", () => {
		expect(splitPerHead(104000, 16, 6000)).toBe(6500);
	});
});

describe("splitDrift", () => {
	it("발행 그대로면 어긋남 없음(정액 맞춤 포함)", () => {
		expect(splitDrift(group(104000), charges(17, 6000), 6000)).toBeNull();
	});
	it("#395 실제: 17명 발행 뒤 1명 취소 → 16명 6,500원으로 재분배 필요", () => {
		const d = splitDrift(group(104000), charges(16, 6000, 1), 6000);
		expect(d).toMatchObject({
			head: 16,
			issuedHead: 17,
			perHead: 6500,
			charged: [6000],
			shortfall: 8000,
		});
		expect(d?.liveIds).toHaveLength(16);
	});
	it("재분배 후(16명 6,500원)엔 basis.head 가 17로 남아도 정상", () => {
		expect(splitDrift(group(104000), charges(16, 6500, 1), 6000)).toBeNull();
	});
	it("사람마다 금액이 다르면(운영진 개별 조정) 묻지 않는다", () => {
		const cs = charges(16, 6000, 1);
		cs[0] = { ...cs[0], amount: 3000 };
		expect(splitDrift(group(104000), cs, 6000)).toBeNull();
	});
	it("진행 중 회차 선납 2명만 발행된 그룹은 범위 밖이라 보지 않는다", () => {
		expect(splitDrift(group(78000, 13), charges(2, 6000), 6000)).toBeNull();
	});
	it("엔빵이 아니면(총액 없음) 보지 않는다", () => {
		expect(splitDrift(group(null), charges(16, 6000, 1), 6000)).toBeNull();
	});
});
