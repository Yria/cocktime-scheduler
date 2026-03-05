import type { RealtimeChannel } from "@supabase/supabase-js";
import type { GameType, ReservedMatch, SessionPlayer } from "../../types";
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
				removedGroupId: string | null;
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
				groupUpdates: Array<{ groupId: string; readyIds: string[] }>;
				promotedMatch?: ReservedMatch;
			};
	  }
	| {
			event: "team_reserved";
			payload: {
				matchId: string;
				courtId: number;
				gameType: GameType;
				teamA: [SessionPlayer, SessionPlayer];
				teamB: [SessionPlayer, SessionPlayer];
			};
	  }
	| {
			event: "reservation_cancelled";
			payload: {
				matchId: string;
				courtId: number;
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
			event: "session_updated";
			payload: {
				courtCount: number;
				singleWomanIds: string[];
				addedPlayers: SessionPlayer[];
				removedPlayerIds: string[];
			};
	  }
	| {
			event: "session_refresh_required";
			payload: Record<string, never>;
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
