import type { RealtimeChannel } from "@supabase/supabase-js";
import type { GameType, GeneratedTeam, SessionPlayer } from "../../types";
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
			event: "player_status_changed";
			payload: { player: SessionPlayer };
	  }
	| {
			event: "player_force_mixed_changed";
			payload: { player: SessionPlayer };
	  }
	| {
			event: "player_force_hard_game_changed";
			payload: { player: SessionPlayer };
	  }
	| {
			event: "player_updated";
			payload: { player: SessionPlayer };
	  }
	| { event: "session_ended" }
	| {
			event: "session_refresh_required";
			payload: Record<string, never>;
	  }
	| {
			event: "candidates_updated";
			payload: { candidates: GeneratedTeam[] };
	  }
	| {
			event: "queue_updated";
			payload: { queue: GeneratedTeam[]; restoredPlayers?: SessionPlayer[] };
	  };

export function createBroadcastChannel(sessionId: number): RealtimeChannel {
	return supabase.channel(`session-bc:${sessionId}`, {
		config: { broadcast: { self: false } },
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
