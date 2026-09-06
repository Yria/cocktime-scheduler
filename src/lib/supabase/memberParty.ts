import { supabase } from "./client";

export type MemberPartyReason =
	| "session_closed"
	| "no_admin"
	| "admin_available"
	| "not_participant"
	| "editor"
	| "playing"
	| "resting"
	| "cock_unchecked"
	| "assigned";

export interface MemberPartyResult {
	roundId: string;
	status: "created" | "cancelled";
	teamId?: string;
	/** session_players.id values, matching board_drafts memberIds. */
	memberIds?: string[];
}

export interface MemberPartyState {
	/** Absent on older servers: keep the legacy poll interval until the broadcast migration is applied. */
	realtimeEnabled?: boolean;
	/** The session is active and every participating administrator is playing. */
	available: boolean;
	/** The signed-in member is also a free, waiting, cock-checked participant. */
	eligible: boolean;
	reason: MemberPartyReason | null;
	roundId: string | null;
	endsAt: string | null;
	participants: string[];
	myPlayerId: string | null;
	serverNow: string;
	lastResult: MemberPartyResult | null;
}

export interface MemberPartyFinishResult {
	status: "created" | "cancelled" | "stale" | "pending";
	teamId?: string;
	memberIds?: string[];
}

export async function fetchMemberPartyState(sessionId: number): Promise<MemberPartyState> {
	const { data, error } = await supabase.rpc("member_party_state", {
		p_session_id: sessionId,
	});
	if (error) throw error;
	return data as MemberPartyState;
}

/** Only a fresh press may omit roundId; heartbeats must identify their round. */
export async function setMemberPartyHold(
	sessionId: number,
	clientId: string,
	holding: boolean,
	roundId: string | null = null,
	boardClientId: string | null = null,
): Promise<MemberPartyState> {
	const { data, error } = await supabase.rpc("member_party_hold", {
		p_session_id: sessionId,
		p_client_id: clientId,
		p_holding: holding,
		p_round_id: roundId,
		p_board_client_id: boardClientId,
	});
	if (error) throw error;
	return data as MemberPartyState;
}

/** Propose the existing matcher's four choices; the server rechecks membership and CAS. */
export async function finishMemberParty(
	sessionId: number,
	roundId: string,
	playerIds: string[],
	boardVersion: number,
	boardClientId: string | null = null,
): Promise<MemberPartyFinishResult> {
	const { data, error } = await supabase.rpc("member_party_finish", {
		p_session_id: sessionId,
		p_round_id: roundId,
		p_player_ids: playerIds,
		p_board_version: boardVersion,
		p_board_client_id: boardClientId,
	});
	if (error) throw error;
	return data as MemberPartyFinishResult;
}
