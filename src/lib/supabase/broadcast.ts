import type { RealtimeChannel } from "@supabase/supabase-js";
import type { GameType, SessionPlayer } from "../../types";
import { supabase } from "./client";

export type BroadcastPayload =
	| {
			event: "match_started";
			payload: {
				matchId: string;
				courtId: number;
				gameType: GameType;
				teamA: [SessionPlayer, SessionPlayer];
				teamB: [SessionPlayer, SessionPlayer];
			};
	  }
	| {
			event: "match_completed";
			payload: {
				matchId: string;
				courtId: number;
				gameType: GameType;
				teamA: [SessionPlayer, SessionPlayer];
				teamB: [SessionPlayer, SessionPlayer];
				updatedPlayers: SessionPlayer[];
			};
	  }
	| {
			event: "match_roster_updated";
			// 경기 로스터 수정의 즉시성 전파(best-effort). 권위 수렴은 match_state_version 갭 → refetch.
			// teamA/B는 session_players.id 참조, updatedPlayers는 상태가 바뀐 선수(waiting/playing).
			payload: {
				matchId: string;
				courtId: number;
				teamA: [string, string];
				teamB: [string, string];
				updatedPlayers: SessionPlayer[];
			};
	  }
	| {
			event: "player_updated";
			payload: { player: SessionPlayer };
	  }
	| {
			event: "session_refresh_required";
			payload: Record<string, never>;
	  }
	| {
			event: "board_drafts_updated";
			// version: 낙관적 단조 가드 — 수신측이 자신의 버전보다 새 것만 적용(broadcast/catch-up 역전 방지).
			payload: { drafts: import("../../types/board").BoardDraftsPayload; version: number };
	  };

export function createBroadcastChannel(
	sessionId: number,
	clientId: string,
): RealtimeChannel {
	// presence.key = clientId → "현재 접속자 중 최초 입장자"를 편집자로 산정(편집 락)
	return supabase.channel(`session-bc:${sessionId}`, {
		config: { broadcast: { self: false }, presence: { key: clientId } },
	});
}

export function sendBroadcast(
	channel: RealtimeChannel,
	ev: BroadcastPayload,
): void {
	channel.send({
		type: "broadcast",
		event: ev.event,
		payload: (ev as { payload?: unknown }).payload,
	});
}
