import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("./client", () => ({ supabase: client }));

import { fetchSessionSettingsForConflictCheck, startSession, updateSession } from "./session";
import { dbEndSession } from "./actions";

function query(data: unknown, error: { message: string } | null = null) {
	const result = { data, error };
	const promise = Promise.resolve(result);
	return {
		select: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		upsert: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		single: vi.fn().mockResolvedValue(result),
		maybeSingle: vi.fn().mockResolvedValue(result),
		then: promise.then.bind(promise),
	};
}

beforeEach(() => vi.clearAllMocks());

describe("세션 설정 저장과 읽기", () => {
	it.each([true, false])("새 세션에 설정을 저장한다 (%s)", async (enabled) => {
		const create = query({ id: 7 });
		client.from.mockReturnValueOnce(query([])).mockReturnValueOnce(create).mockReturnValueOnce(query([]));
		await startSession(2, [], [], enabled);
		expect(create.insert).toHaveBeenCalledWith({ court_count: 2, cock_check_enabled: enabled });
	});

	it.each([true, false])("진행 중인 세션의 설정을 변경한다 (%s)", async (enabled) => {
		const update = query(null);
		client.from.mockReturnValueOnce(query([])).mockReturnValueOnce(update);
		expect(await updateSession(7, 2, [], [], enabled)).toBe(true);
		expect(update.update).toHaveBeenCalledWith({ court_count: 2, cock_check_enabled: enabled });
		expect(update.eq).toHaveBeenCalledWith("id", 7);
	});

	it("충돌 확인용 읽기는 저장된 ON 설정을 포함한다", async () => {
		const read = query({ court_count: 2, cock_check_enabled: true });
		client.from.mockReturnValueOnce(read).mockReturnValueOnce(query([]));
		expect((await fetchSessionSettingsForConflictCheck(7))?.cockCheckEnabled).toBe(true);
		expect(read.select).toHaveBeenCalledWith("court_count, cock_check_enabled");
	});

	it("게스트 등록 실패를 성공으로 처리하거나 기존 참가자 삭제를 계속하지 않는다", async () => {
		const existing = [{ id: "saved-row", player_id: "old-member", status: "waiting" }];
		const insert = query(null, { message: 'duplicate key violates unique constraint "uq_session_member"' });
		client.from.mockReturnValueOnce(query(existing)).mockReturnValueOnce(insert);
		await expect(updateSession(7, 2, [{ id: "guest-new", name: "중복", gender: "M", skills: { grade: 5 } }], [], true))
			.rejects.toThrow("이미 등록된 참가자입니다");
		expect(client.from).toHaveBeenCalledTimes(2);
	});

});

describe("세션 종료 저장 결과", () => {
	it("종료한 행이 확인되어야 성공한다", async () => {
		const update = query({ id: 7 });
		client.from.mockReturnValueOnce(update);
		expect(await dbEndSession(7)).toBe(true);
		expect(update.update).toHaveBeenCalledWith({ is_active: false, status: "closed", ended_at: expect.any(String) });
	});
	it("권한 정책으로 갱신된 행이 없으면 종료 실패다", async () => {
		client.from.mockReturnValueOnce(query(null));
		expect(await dbEndSession(7)).toBe(false);
	});
});
