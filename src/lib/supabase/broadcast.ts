import type { RealtimeChannel } from "@supabase/supabase-js";
import type { GameType, ReservedGroup, SessionPlayer } from "../../types";
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
			event: "group_reserved";
			payload: { group: ReservedGroup; reservedPlayerIds: string[] };
	  }
	| {
			event: "group_disbanded";
			payload: { groupId: string; readyPlayers: SessionPlayer[] };
	  }
	| { event: "session_ended" };

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
