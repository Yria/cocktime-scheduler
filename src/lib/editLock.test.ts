import { describe, expect, it } from "vitest";
import { computePresence, nextClaimAt, type PresenceState } from "./editLock";

function presence(
	...entries: { clientId: string; name?: string; claimAt: number }[]
): PresenceState {
	const state: PresenceState = {};
	entries.forEach((e, i) => {
		state[`ref${i}`] = [{ clientId: e.clientId, name: e.name ?? e.clientId, claimAt: e.claimAt }];
	});
	return state;
}

describe("computePresence — 양도형 편집 락 보유자 산정", () => {
	it("아무도 claim 안 하면 lockFree, 누구나 편집 가능", () => {
		const info = computePresence(presence({ clientId: "a", claimAt: 0 }, { clientId: "b", claimAt: 0 }), "a", 0);
		expect(info.lockFree).toBe(true);
		expect(info.holderClientId).toBeNull();
		expect(info.isEditor).toBe(true);
		expect(info.presenceCount).toBe(2);
	});

	it("claimAt이 가장 큰 기기가 보유자", () => {
		const info = computePresence(presence({ clientId: "a", claimAt: 10 }, { clientId: "b", claimAt: 5 }), "b", 5);
		expect(info.holderClientId).toBe("a");
		expect(info.lockFree).toBe(false);
		expect(info.isEditor).toBe(false); // 나(b)는 보유자 아님
	});

	it("claimAt 동률이면 clientId 작은 쪽이 보유자(결정적 타이브레이크)", () => {
		const info = computePresence(presence({ clientId: "b", claimAt: 7 }, { clientId: "a", claimAt: 7 }), "a", 7);
		expect(info.holderClientId).toBe("a");
		expect(info.isEditor).toBe(true);
	});

	it("내 최신 claim이 presence에 늦게 반영돼도 로컬 myClaimAt로 보정", () => {
		const info = computePresence(presence({ clientId: "a", claimAt: 3 }, { clientId: "me", claimAt: 1 }), "me", 9);
		expect(info.holderClientId).toBe("me");
		expect(info.isEditor).toBe(true);
	});
});

describe("nextClaimAt — 보유자를 이기는 최소 claim", () => {
	it("presence 최대 claimAt + 1", () => {
		expect(nextClaimAt(presence({ clientId: "a", claimAt: 3 }, { clientId: "b", claimAt: 8 }), 2)).toBe(9);
	});
	it("내 claim이 더 크면 그 기준 +1", () => {
		expect(nextClaimAt(presence({ clientId: "a", claimAt: 3 }), 20)).toBe(21);
	});
});
