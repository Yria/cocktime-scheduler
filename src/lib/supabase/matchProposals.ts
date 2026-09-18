import { supabase } from "./client";
import type { GeneratedTeam } from "../../types";

export interface MatchProposal {
	id: string;
	session_id: number;
	created_by: string;
	creator_name: string;
	player_ids: string[];
	player_names: string[];
	status: "pending" | "reviewed" | "withdrawn" | "rejected" | "started";
	created_at: string;
	updated_at: string;
	match_id?: string | null;
}

export async function fetchMatchProposals(sessionId: number): Promise<MatchProposal[]> {
	// RLS filters at the server: the author and administrators only.
	const { data, error } = await supabase.from("match_proposals")
		.select("id, session_id, created_by, creator_name, player_ids, player_names, status, created_at, updated_at, match_id")
		.eq("session_id", sessionId).in("status", ["pending", "reviewed"]).order("created_at", { ascending: false });
	if (error) throw error;
	return (data ?? []) as MatchProposal[];
}

export interface ProposalRosterUpdate { id: string; updated_at: string; player_ids: string[] }

export async function editMatchProposals(updates: ProposalRosterUpdate[], clientId: string, name: string): Promise<MatchProposal[]> {
	const { data, error } = await supabase.rpc("edit_match_proposals", { p_updates: updates, p_client_id: clientId, p_name: name });
	if (error) throw error;
	return data as MatchProposal[];
}

export async function startMatchProposal(proposal: MatchProposal, matchId: string, courtId: number,
	team: GeneratedTeam, clientId: string, name: string, allowAdminAbsence = false): Promise<MatchProposal> {
	const { data, error } = await supabase.rpc("start_match_proposal_with_admin_coverage", { p_id: proposal.id, p_updated_at: proposal.updated_at,
		p_match_id: matchId, p_court_id: courtId, p_game_type: team.gameType, p_team_a: team.teamA, p_team_b: team.teamB,
		p_client_id: clientId, p_name: name, p_allow_admin_absence: allowAdminAbsence });
	if (error) throw error;
	return data as MatchProposal;
}

export async function sendMatchProposal(sessionId: number, id: string, playerIds: string[]): Promise<MatchProposal> {
	const { data, error } = await supabase.rpc("create_match_proposal", {
		p_session_id: sessionId, p_id: id, p_player_ids: playerIds,
	});
	if (error) throw error;
	return data as MatchProposal;
}

export async function updateMatchProposal(id: string, status: "reviewed" | "withdrawn" | "rejected"): Promise<void> {
	const { error } = await supabase.rpc("resolve_match_proposal", { p_id: id, p_status: status });
	if (error) throw error;
}
