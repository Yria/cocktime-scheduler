import { supabase } from "./client";

export interface MatchProposal {
	id: string;
	session_id: number;
	created_by: string;
	creator_name: string;
	player_ids: string[];
	player_names: string[];
	status: "pending" | "reviewed" | "withdrawn";
	created_at: string;
}

export async function fetchMatchProposals(sessionId: number): Promise<MatchProposal[]> {
	// RLS filters at the server: the author and administrators only.
	const { data, error } = await supabase.from("match_proposals")
		.select("id, session_id, created_by, creator_name, player_ids, player_names, status, created_at")
		.eq("session_id", sessionId).neq("status", "withdrawn").order("created_at", { ascending: false });
	if (error) throw error;
	return (data ?? []) as MatchProposal[];
}

export async function sendMatchProposal(sessionId: number, id: string, playerIds: string[]): Promise<MatchProposal> {
	const { data, error } = await supabase.rpc("create_match_proposal", {
		p_session_id: sessionId, p_id: id, p_player_ids: playerIds,
	});
	if (error) throw error;
	return data as MatchProposal;
}

export async function updateMatchProposal(id: string, status: "reviewed" | "withdrawn"): Promise<void> {
	const { error } = await supabase.rpc("resolve_match_proposal", { p_id: id, p_status: status });
	if (error) throw error;
}
