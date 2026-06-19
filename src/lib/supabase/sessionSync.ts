/**
 * sessionSync.ts
 *
 * 세션 참가자 동기화 diff 계산(순수). DB I/O는 api.updateSession이 담당.
 */
import type { Player } from "../../types";
import type { SessionPlayerRow } from "./types";

/** session_players insert 행(서버가 채우는 id/game_count/mixed_count/joined_at/cock_checked 제외). */
export type SessionPlayerInsert = Omit<
	SessionPlayerRow,
	"id" | "game_count" | "mixed_count" | "joined_at" | "cock_checked"
>;

export interface SessionPlayerDiff {
	toAdd: SessionPlayerInsert[];
	toUpsert: SessionPlayerRow[];
	toRemoveIds: string[];
}

/**
 * 기존 session_players 행과 새 참가자 목록을 비교해 추가/변경/삭제 대상을 산출(순수).
 * - allow_mixed_single = 여성 && singleWomanIds 포함
 * - 변경 감지: allow_mixed_single·name·gender·skills(JSON 비교)
 * - 삭제 대상: 새 목록에 없고 status가 playing이 아닌 행(경기중 선수는 보존)
 */
export function diffSessionPlayers(
	existingRows: SessionPlayerRow[],
	players: Player[],
	singleWomanIds: string[],
	sessionId: number,
	nowIso: string,
): SessionPlayerDiff {
	const existingMap = new Map(existingRows.map((p) => [p.player_id, p]));
	const newPlayerMap = new Map(players.map((p) => [p.id, p]));
	const singleWomanIdSet = new Set(singleWomanIds);

	const toAdd: SessionPlayerInsert[] = players
		.filter((p) => !existingMap.has(p.id))
		.map((p) => ({
			session_id: sessionId,
			player_id: p.id,
			name: p.name,
			gender: p.gender,
			skills: p.skills,
			allow_mixed_single: p.gender === "F" && singleWomanIdSet.has(p.id),
			status: "waiting",
			wait_since: nowIso,
			joined_at_match: 0,
		}));

	const toUpsert: SessionPlayerRow[] = [];
	const toRemoveIds: string[] = [];

	for (const ep of existingRows) {
		const newP = newPlayerMap.get(ep.player_id);
		if (!newP) {
			// 새 목록에 없는 행 → 삭제 대상(단, 경기중이면 보존)
			if (ep.status !== "playing") toRemoveIds.push(ep.id);
			continue;
		}
		const allowedMixedSingle =
			newP.gender === "F" && singleWomanIdSet.has(newP.id);
		const changed =
			ep.allow_mixed_single !== allowedMixedSingle ||
			ep.name !== newP.name ||
			ep.gender !== newP.gender ||
			JSON.stringify(ep.skills) !== JSON.stringify(newP.skills);
		if (changed) {
			toUpsert.push({
				...ep,
				name: newP.name,
				gender: newP.gender,
				skills: newP.skills,
				allow_mixed_single: allowedMixedSingle,
			});
		}
	}

	return { toAdd, toUpsert, toRemoveIds };
}
