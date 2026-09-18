import type { SessionPlayer } from "../../types";
import { matchesQuery } from "../playerSearch";
import type { BoardSnapshot, MagnetView } from "./pixi/types";

export interface BoardPlayerResult { player: SessionPlayer; locations: string[] }

/** Search exactly what this device can see, including private proposal cards. */
export function findBoardPlayers(scene: BoardSnapshot, query: string): BoardPlayerResult[] {
	if (!query.trim()) return [];
	const found = new Map<string, BoardPlayerResult>();
	const add = (view: MagnetView, location: string) => {
		if (!matchesQuery(view.player.name, query)) return;
		const result = found.get(view.player.id) ?? { player: view.player, locations: [] };
		if (!result.locations.includes(location)) result.locations.push(location);
		found.set(view.player.id, result);
	};
	for (const entity of scene.entities) {
		if (entity.kind === "magnet") add(entity, entity.resting ? "휴식 중" : entity.cockPending ? "콕 확인 대기" : "대기 중");
		else {
			const location = entity.source.kind === "court" ? `${entity.source.courtId}번 코트 · 경기 중`
				: entity.source.kind === "proposal" ? entity.appearance.dashed ? "매칭 제안" : "작성 중인 제안" : "대기 그룹";
			for (const member of entity.members) add(member, location);
		}
	}
	return [...found.values()].sort((a, b) => a.player.name.localeCompare(b.player.name, "ko"));
}
