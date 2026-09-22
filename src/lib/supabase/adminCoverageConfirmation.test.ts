import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({ supabase: { rpc } }));
import { dbAssignMatch } from "./actions";
import type { GeneratedTeam } from "../../types";

const team = { teamA: ["a", "b"], teamB: ["c", "d"], gameType: "남복" } as GeneratedTeam;
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ error: null }); });
describe("운영진 전원 출전 확인 전송", () => {
	it("기본 시작은 예외 없이 요청한다", async () => {
		await dbAssignMatch(1, "match", team, 2, "editor", "운영진");
		expect(rpc).toHaveBeenCalledWith("assign_match_with_admin_coverage", expect.objectContaining({ p_allow_admin_absence: false }));
	});
	it("확인한 경기의 RPC에만 허용 값을 담는다", async () => {
		await dbAssignMatch(1, "confirmed", team, 2, "editor", "운영진", true);
		await dbAssignMatch(1, "next", team, 2, "editor", "운영진");
		expect(rpc.mock.calls.map(call => [call[1].p_match_id, call[1].p_allow_admin_absence])).toEqual([["confirmed", true], ["next", false]]);
	});
});
