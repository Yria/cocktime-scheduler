import { describe, expect, it } from "vitest";
import type { Player, PlayerSkills } from "../../types";
import { diffSessionPlayers } from "./sessionSync";
import type { SessionPlayerRow } from "./types";

const SKILLS: PlayerSkills = { grade: 5 };

function player(id: string, over: Partial<Player> = {}): Player {
	return { id, name: id, gender: "M", skills: SKILLS, ...over };
}
function row(over: Partial<SessionPlayerRow> & { player_id: string }): SessionPlayerRow {
	return {
		id: `sp-${over.player_id}`,
		session_id: 1,
		member_id: null,
		name: over.player_id,
		gender: "M",
		skills: SKILLS,
		allow_mixed_single: false,
		status: "waiting",
		game_count: 0,
		mixed_count: 0,
		wait_since: null,
		joined_at: "t0",
		joined_at_match: 0,
		cock_checked: false,
		...over,
	};
}

describe("diffSessionPlayers", () => {
	it("새 참가자는 toAdd(waiting)로 분류", () => {
		const diff = diffSessionPlayers([], [player("a")], [], 1, "now");
		expect(diff.toAdd).toHaveLength(1);
		expect(diff.toAdd[0]).toMatchObject({ player_id: "a", status: "waiting", wait_since: "now", session_id: 1 });
		expect(diff.toUpsert).toHaveLength(0);
		expect(diff.toRemoveIds).toHaveLength(0);
	});

	it("목록에서 빠진 행은 toRemoveIds — 단 playing은 보존", () => {
		const existing = [row({ player_id: "a" }), row({ player_id: "b", id: "sp-b", status: "playing" })];
		const diff = diffSessionPlayers(existing, [], [], 1, "now");
		expect(diff.toRemoveIds).toEqual(["sp-a"]); // b(playing)는 보존
	});

	it("성별/스킬/이름/allow_mixed_single 변경 시 toUpsert", () => {
		const existing = [row({ player_id: "a", gender: "F", allow_mixed_single: false })];
		// a를 단식여성으로 지정 → allow_mixed_single이 true로 바뀜
		const diff = diffSessionPlayers(existing, [player("a", { gender: "F" })], ["a"], 1, "now");
		expect(diff.toUpsert).toHaveLength(1);
		expect(diff.toUpsert[0]).toMatchObject({ id: "sp-a", allow_mixed_single: true });
	});

	it("변경 없으면 upsert 안 함", () => {
		const existing = [row({ player_id: "a" })];
		const diff = diffSessionPlayers(existing, [player("a")], [], 1, "now");
		expect(diff.toUpsert).toHaveLength(0);
		expect(diff.toAdd).toHaveLength(0);
		expect(diff.toRemoveIds).toHaveLength(0);
	});

	it("allow_mixed_single은 여성에게만 적용(남성은 singleWomanIds에 있어도 false)", () => {
		const diff = diffSessionPlayers([], [player("m", { gender: "M" })], ["m"], 1, "now");
		expect(diff.toAdd[0].allow_mixed_single).toBe(false);
	});
});
