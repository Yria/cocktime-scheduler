import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("./client", () => ({ supabase: client }));

import { fetchSessionSettingsForConflictCheck, startSession, updateSession } from "./session";

function query(data: unknown) {
	const result = { data, error: null };
	const promise = Promise.resolve(result);
	return {
		select: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		single: vi.fn().mockResolvedValue(result),
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

});
