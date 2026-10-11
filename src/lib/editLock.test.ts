import { describe, expect, it } from "vitest";
import {
	computeLockFromRow,
	computePresenceList,
	detectEditorLoss,
	type LockInfo,
	type PresenceState,
} from "./editLock";

function presence(
	...entries: { clientId: string; name?: string }[]
): PresenceState {
	const state: PresenceState = {};
	entries.forEach((e, i) => {
		state[`ref${i}`] = [{ clientId: e.clientId, name: e.name ?? e.clientId }];
	});
	return state;
}

describe("computePresenceList — 접속자 목록(편집권과 무관)", () => {
	it("중복 clientId는 1개로, 이름 유지", () => {
		const r = computePresenceList(presence({ clientId: "a", name: "기기A" }, { clientId: "b" }));
		expect(r.presenceCount).toBe(2);
		expect(r.presenceList).toEqual([
			{ clientId: "a", name: "기기A" },
			{ clientId: "b", name: "b" },
		]);
	});

	it("clientId 누락 항목은 무시", () => {
		const state: PresenceState = { ref0: [{ name: "noid" }], ref1: [{ clientId: "a", name: "A" }] };
		const r = computePresenceList(state);
		expect(r.presenceCount).toBe(1);
		expect(r.presenceList).toEqual([{ clientId: "a", name: "A" }]);
	});
});

describe("computeLockFromRow — 서버 권위 편집 락(sticky, 신원만)", () => {
	it("락이 비었으면(clientId null) lockFree, 누구도 보유자 아님", () => {
		const r = computeLockFromRow({ clientId: null, name: null, leaseUntilMs: 0 }, "me");
		expect(r.lockFree).toBe(true);
		expect(r.holderClientId).toBeNull();
		expect(r.isEditor).toBe(false);
	});

	it("보유자가 나면 isEditor=true", () => {
		const r = computeLockFromRow({ clientId: "me", name: "내기기", leaseUntilMs: 0 }, "me");
		expect(r.holderClientId).toBe("me");
		expect(r.holderName).toBe("내기기");
		expect(r.lockFree).toBe(false);
		expect(r.isEditor).toBe(true);
	});

	it("보유자가 남이면 isEditor=false(보기 전용)", () => {
		const r = computeLockFromRow({ clientId: "other", name: "남", leaseUntilMs: 0 }, "me");
		expect(r.holderClientId).toBe("other");
		expect(r.lockFree).toBe(false);
		expect(r.isEditor).toBe(false);
	});

	it("sticky: lease 만료(과거)여도 보유자가 있으면 계속 held — 자동 해제 없음", () => {
		// leaseUntilMs 는 더 이상 판정에 쓰이지 않는다(하트비트 폐기). editor_client_id 존재 = held.
		const r = computeLockFromRow({ clientId: "other", name: "남", leaseUntilMs: 1 }, "me");
		expect(r.lockFree).toBe(false);
		expect(r.holderClientId).toBe("other");
		expect(r.isEditor).toBe(false);
	});

	it("myClientId가 null이면 절대 editor 아님", () => {
		const r = computeLockFromRow({ clientId: "me", name: "x", leaseUntilMs: 0 }, null);
		expect(r.isEditor).toBe(false);
	});
});

describe("detectEditorLoss — 편집권 뺏김 전이 감지", () => {
	const lock = (over: Partial<LockInfo> = {}): LockInfo => ({
		holderClientId: null,
		holderName: null,
		lockFree: true,
		isEditor: false,
		...over,
	});

	it("내가 편집자였다가 남이 가져가면 그 사람 이름 반환", () => {
		const next = lock({ holderClientId: "other", holderName: "철수", lockFree: false, isEditor: false });
		expect(detectEditorLoss(true, next, "me")).toBe("철수");
	});

	it("보유자 이름이 없으면 기본 문구로 대체", () => {
		const next = lock({ holderClientId: "other", holderName: null, lockFree: false, isEditor: false });
		expect(detectEditorLoss(true, next, "me")).toBe("다른 사용자");
	});

	it("애초에 내가 편집자가 아니었으면 null(뺏김 아님)", () => {
		const next = lock({ holderClientId: "other", holderName: "철수", lockFree: false });
		expect(detectEditorLoss(false, next, "me")).toBeNull();
	});

	it("lease 만료로 자유(holder=null)가 된 것은 뺏김 아님", () => {
		expect(detectEditorLoss(true, lock(), "me")).toBeNull();
	});

	it("내가 계속 편집자면 뺏김 아님", () => {
		const next = lock({ holderClientId: "me", holderName: "나", lockFree: false, isEditor: true });
		expect(detectEditorLoss(true, next, "me")).toBeNull();
	});

	it("새 보유자가 다시 나면(재획득) 뺏김 아님", () => {
		const next = lock({ holderClientId: "me", holderName: "나", lockFree: false, isEditor: true });
		expect(detectEditorLoss(false, next, "me")).toBeNull();
	});
});

describe("동시 편집(multiEditor) 분기", () => {
	const held = { clientId: "other", name: "남", leaseUntilMs: 0 };
	const free = { clientId: null, name: null, leaseUntilMs: 0 };

	it("켜져 있으면 운영진은 editor_client_id 와 무관하게 편집자", () => {
		expect(computeLockFromRow(free, "me", { multiEditor: true, isAdmin: true }).isEditor).toBe(true);
		expect(computeLockFromRow(held, "me", { multiEditor: true, isAdmin: true }).isEditor).toBe(true);
		expect(computeLockFromRow(free, null, { multiEditor: true, isAdmin: true }).isEditor).toBe(true);
	});

	it("켜져 있어도 회원은 편집자가 아니다(내가 보유자로 적혀 있어도)", () => {
		expect(computeLockFromRow(free, "me", { multiEditor: true, isAdmin: false }).isEditor).toBe(false);
		expect(computeLockFromRow({ clientId: "me", name: "나", leaseUntilMs: 0 }, "me", { multiEditor: true, isAdmin: false }).isEditor).toBe(false);
	});

	it("꺼져 있으면 옵션을 줘도 기존 판정과 같다", () => {
		for (const editor of [free, held, { clientId: "me", name: "나", leaseUntilMs: 0 }]) {
			for (const isAdmin of [true, false]) {
				expect(computeLockFromRow(editor, "me", { multiEditor: false, isAdmin })).toEqual(computeLockFromRow(editor, "me"));
			}
		}
	});

	it("holder/lockFree 는 표시용으로 그대로 남는다", () => {
		const r = computeLockFromRow(held, "me", { multiEditor: true, isAdmin: true });
		expect(r).toMatchObject({ holderClientId: "other", holderName: "남", lockFree: false });
	});

	it("detectEditorLoss: 동시 편집 중이거나 전환 직후면 null", () => {
		const next: LockInfo = { holderClientId: "other", holderName: "철수", lockFree: false, isEditor: false };
		expect(detectEditorLoss(true, next, "me")).toBe("철수");
		expect(detectEditorLoss(true, next, "me", { multiEditor: true })).toBeNull();
		expect(detectEditorLoss(true, next, "me", { transition: true })).toBeNull();
		expect(detectEditorLoss(true, next, "me", { multiEditor: false, transition: false })).toBe("철수");
	});
});
