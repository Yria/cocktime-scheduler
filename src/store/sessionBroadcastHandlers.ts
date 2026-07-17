import { recordTeam } from "../lib/pairHistory";
import type { GameType, SessionPlayer } from "../types";
import type { BoardDraftsPayload } from "../types/board";
import { useAppStore } from "./appStore";
import type { BroadcastPayloadData, GetFn, SetFn } from "./sessionStoreState";

export function upsertPlayers(map: Map<string, SessionPlayer>, players: SessionPlayer[]): Map<string, SessionPlayer> {
	const next = new Map(map);
	for (const p of players) next.set(p.id, p);
	return next;
}

/** board_drafts 단조 적용 — 내가 아는 버전보다 새(>=) 것만 반영. broadcast/catch-up/저장성공이 공유. */
export function applyDraftsIfNewerImpl(
	get: GetFn,
	set: SetFn,
	drafts: BoardDraftsPayload,
	version: number,
) {
	// 멱등: 이미 아는 버전 이하(자기 echo·broadcast/catch-up 중복)는 무시 — 새 객체참조 set로 인한
	// SessionBoard 재적용/깜빡임 방지. CAS라 version이 내용을 유일 식별(같은 버전=같은 멤버십).
	if (version <= get().boardDraftsVersion) return;
	set({ boardDrafts: drafts, boardDraftsVersion: version });
}

/** sessionPlayers Map에서 waitingIds/restingIds 파생 상태를 동기 재계산 */
export function rebuildDerivedIds(
	sessionPlayers: Map<string, SessionPlayer>,
): { waitingIds: string[]; restingIds: string[] } {
	const waitingIds: string[] = [];
	const restingIds: string[] = [];
	for (const [id, p] of sessionPlayers) {
		if (p.status === "waiting") waitingIds.push(id);
		else if (p.status === "resting") restingIds.push(id);
	}
	return { waitingIds, restingIds };
}

export function handleMatchStarted(payload: BroadcastPayloadData, set: SetFn) {
	const { matchId, courtId, gameType, teamA, teamB } = payload;
	// teamA/B는 여전히 SessionPlayer 객체로 수신 (브로드캐스트 형식 유지)
	const teamAPlayers = teamA as [SessionPlayer, SessionPlayer];
	const teamBPlayers = teamB as [SessionPlayer, SessionPlayer];
	const teamAIds: [string, string] = [teamAPlayers[0].id, teamAPlayers[1].id];
	const teamBIds: [string, string] = [teamBPlayers[0].id, teamBPlayers[1].id];
	const safeMatchId = matchId as string;
	const safeCourtId = courtId as number;
	const safeGameType = gameType as GameType;

	set((state) => {
		// Map에 먼저 upsert (status='playing'으로 수신됨), courts에는 ID 참조 저장 (단일 배치)
		const newMap = upsertPlayers(state.sessionPlayers, [...teamAPlayers, ...teamBPlayers]);
		const { waitingIds, restingIds } = rebuildDerivedIds(newMap);

		return {
			sessionPlayers: newMap,
			courts: state.courts.map((c) =>
				c.id === safeCourtId
					? {
						...c,
						match: {
							id: safeMatchId,
							courtId: safeCourtId,
							gameType: safeGameType,
							teamA: teamAIds,
							teamB: teamBIds,
							startedAt: new Date().toISOString(),
						},
					}
					: c,
			),
			waitingIds,
			restingIds,
			// 동반 이력(pairHistory)은 경기 완료 시(handleMatchCompleted)에만 1회 누적한다.
			// 경기 시작 시 4명의 직전 게임 타입을 이번 경기 타입으로 기록(완료 후 자유로 돌아와도 유지)
			lastGameType: { ...state.lastGameType, ...Object.fromEntries([...teamAIds, ...teamBIds].map((id) => [id, safeGameType])) },
		};
	});
}

export function handleMatchCompleted(payload: BroadcastPayloadData, set: SetFn) {
	const { courtId, gameType, teamA, teamB, updatedPlayers } = payload;
	const teamAPlayers = teamA as [SessionPlayer, SessionPlayer];
	const teamBPlayers = teamB as [SessionPlayer, SessionPlayer];
	const allPlayers = [...teamAPlayers, ...teamBPlayers];

	set((state) => {
		// 같은 경기 4명(teamA+teamB) 그룹 전체의 모든 쌍을 동반 +1. 완료 시점에만 1회 누적(DB와 정합).
		const newPairHistory = recordTeam(state.pairHistory, {
			teamA: [teamAPlayers[0].id, teamAPlayers[1].id],
			teamB: [teamBPlayers[0].id, teamBPlayers[1].id],
			gameType: gameType as GameType,
		});

		// Map 업데이트 후 rebuildDerivedIds로 파생 상태 재계산
		const newMap = upsertPlayers(state.sessionPlayers, updatedPlayers as SessionPlayer[]);
		const { waitingIds, restingIds } = rebuildDerivedIds(newMap);

		return {
			sessionPlayers: newMap,
			courts: state.courts.map((c) => (c.id !== courtId ? c : { ...c, match: null })),
			waitingIds,
			restingIds,
			pairHistory: newPairHistory,
			// 직전 게임 타입 갱신(시작 시 누락된 클라이언트도 완료 시점에 보정)
			lastGameType: { ...state.lastGameType, ...Object.fromEntries(allPlayers.map((p: SessionPlayer) => [p.id, gameType as GameType])) },
		};
	});
}

export function handleMatchRosterUpdated(payload: BroadcastPayloadData, set: SetFn) {
	// 경기 로스터 수정의 즉시성 반영(best-effort) — 코트의 teamA/B 참조 갱신 + 상태 바뀐 선수 upsert.
	// 권위 수렴은 match_state_version 갭 → refetchMatches 가 별도로 보장(broadcast 유실/역전 무관).
	const { courtId, teamA, teamB, updatedPlayers } = payload;
	const tA = teamA as [string, string];
	const tB = teamB as [string, string];
	const safeCourtId = courtId as number;
	set((state) => {
		const newMap = upsertPlayers(state.sessionPlayers, (updatedPlayers as SessionPlayer[]) ?? []);
		const { waitingIds, restingIds } = rebuildDerivedIds(newMap);
		return {
			sessionPlayers: newMap,
			waitingIds,
			restingIds,
			courts: state.courts.map((c) =>
				c.id === safeCourtId && c.match ? { ...c, match: { ...c.match, teamA: tA, teamB: tB } } : c,
			),
		};
	});
}

export function handlePlayerUpdated(payload: BroadcastPayloadData, set: SetFn) {
	const { player } = payload as { player: SessionPlayer };
	set((state) => {
		// status가 바뀔 수 있으므로(휴식 토글) waitingIds/restingIds 파생도 재계산한다.
		const newMap = upsertPlayers(state.sessionPlayers, [player]);
		const { waitingIds, restingIds } = rebuildDerivedIds(newMap);
		return { sessionPlayers: newMap, waitingIds, restingIds };
	});
}

export function handleSessionRefreshRequired(_payload: BroadcastPayloadData, _set: SetFn, get: GetFn) {
	const sessionMeta = useAppStore.getState().sessionMeta;
	if (sessionMeta) {
		import("../lib/supabase")
			.then(({ fetchSessionSnapshot, snapshotToClientState }) =>
				fetchSessionSnapshot(sessionMeta.sessionId).then((snapshot) => {
					if (snapshot) {
						get().initialize(snapshotToClientState(snapshot));
					}
				}),
			)
			.catch((err) => console.error("Failed to refresh session:", err));
	}
}
