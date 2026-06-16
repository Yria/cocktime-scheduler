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
			event: "player_updated";
			payload: { player: SessionPlayer };
	  }
	| {
			event: "session_refresh_required";
			payload: Record<string, never>;
	  }
	| {
			event: "board_drafts_updated";
			payload: import("../../types/board").BoardDraftsPayload;
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
