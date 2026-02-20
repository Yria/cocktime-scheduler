import { createClient } from "@supabase/supabase-js";
import type {
	Court,
	GameCountHistory,
	MatchRecord,
	MixedHistory,
	PairHistory,
	Player,
	ReservedGroup,
	SessionSettings,
} from "../types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── 타입 ─────────────────────────────────────────────────────

export interface SessionInitData {
	allPlayers: Player[];
	scriptUrl: string;
	selected: Player[];
	settings: SessionSettings;
}

export interface SessionStateData {
	courts: Court[];
	waiting: Player[];
	history: Record<string, string[]>; // PairHistory (Set → 배열로 직렬화)
	mixedHistory: MixedHistory;
	gameCountHistory: GameCountHistory;
	reservedGroups: ReservedGroup[];
	resting: Player[];
	matchLog: MatchRecord[];
}

export interface SessionRow {
	id: number;
	is_active: boolean;
	init_data: SessionInitData | null;
	state_data: SessionStateData | null;
	last_client_id: string | null;
	updated_at: string;
}

// ── DB 헬퍼 ──────────────────────────────────────────────────

export async function fetchSession(): Promise<SessionRow | null> {
	const { data, error } = await supabase
		.from("sessions")
		.select("*")
		.eq("is_active", true)
		.order("updated_at", { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) {
		console.error("fetchSession:", error);
		return null;
	}
	return data as SessionRow;
}

export async function startSession(
	initData: SessionInitData,
	clientId: string,
): Promise<SessionRow | null> {
	// 기존 활성 세션이 있다면 종료 처리
	const { data: activeSessions } = await supabase
		.from("sessions")
		.select("id")
		.eq("is_active", true);

	if (activeSessions && activeSessions.length > 0) {
		for (const session of activeSessions) {
			await supabase
				.from("sessions")
				.update({ is_active: false })
				.eq("id", session.id);
		}
	}

	const { data: maxIdRecord } = await supabase
		.from("sessions")
		.select("id")
		.order("id", { ascending: false })
		.limit(1)
		.maybeSingle();

	const nextId = (maxIdRecord?.id || 0) + 1;

	const { data, error } = await supabase
		.from("sessions")
		.insert({
			id: nextId,
			is_active: true,
			init_data: initData,
			state_data: null,
			last_client_id: clientId,
			updated_at: new Date().toISOString(),
		})
		.select()
		.single();

	if (error) {
		console.error("startSession:", error);
		return null;
	}
	return data as SessionRow;
}

export async function updateSessionInitData(
	sessionId: number,
	initData: SessionInitData,
	clientId: string,
): Promise<void> {
	const { error } = await supabase
		.from("sessions")
		.update({
			init_data: initData,
			last_client_id: clientId,
			updated_at: new Date().toISOString(),
		})
		.eq("id", sessionId);
	if (error) console.error("updateSessionInitData:", error);
}

export async function updateSessionState(
	sessionId: number,
	stateData: SessionStateData,
	clientId: string,
): Promise<void> {
	const { error } = await supabase
		.from("sessions")
		.update({
			state_data: stateData,
			last_client_id: clientId,
			updated_at: new Date().toISOString(),
		})
		.eq("id", sessionId);
	if (error) console.error("updateSessionState:", error);
}

export async function endSession(
	sessionId: number,
	clientId: string,
): Promise<void> {
	// 먼저 세션 상태를 가져와서 정규화된 테이블에 저장
	const { data: session } = await supabase
		.from("sessions")
		.select("*")
		.eq("id", sessionId)
		.single();

	if (session?.state_data) {
		const state = session.state_data as SessionStateData;

		// 1. 참석자 (Session Participants) 저장
		const allPlayersMap = new Map<string, Player>();
		if (session.init_data?.selected) {
			for (const p of session.init_data.selected) {
				allPlayersMap.set(p.id, p);
			}
		}
		const participants = [];
		for (const [pId, count] of Object.entries(state.gameCountHistory)) {
			const p = allPlayersMap.get(pId);
			if (p) {
				participants.push({
					session_id: sessionId,
					player_id: p.id,
					player_name: p.name,
					gender: p.gender,
					game_count: count,
				});
			}
		}
		if (participants.length > 0) {
			await supabase.from("session_participants").insert(participants);
		}

		// 2. 매치 기록 (Match Records) 저장
		if (state.matchLog && state.matchLog.length > 0) {
			const matchRecords = state.matchLog.map((m) => ({
				id: m.id,
				session_id: sessionId,
				court_id: m.courtId,
				game_type: m.team.gameType,
				team_a_1_id: m.team.teamA[0].id,
				team_a_1_name: m.team.teamA[0].name,
				team_a_2_id: m.team.teamA[1].id,
				team_a_2_name: m.team.teamA[1].name,
				team_b_1_id: m.team.teamB[0].id,
				team_b_1_name: m.team.teamB[0].name,
				team_b_2_id: m.team.teamB[1].id,
				team_b_2_name: m.team.teamB[1].name,
				start_time: m.startTime,
				end_time: m.endTime || new Date().toISOString(),
				status: m.status,
			}));
			await supabase.from("match_records").insert(matchRecords);
		}
	}

	const { error } = await supabase
		.from("sessions")
		.update({
			is_active: false,
			last_client_id: clientId,
			updated_at: new Date().toISOString(),
		})
		.eq("id", sessionId);
	if (error) console.error("endSession:", error);
}

// ── PairHistory 직렬화 ────────────────────────────────────────

export function serializePairHistory(
	history: PairHistory,
): Record<string, string[]> {
	return Object.fromEntries(
		Object.entries(history).map(([k, v]) => [k, [...v]]),
	);
}

export function deserializePairHistory(
	raw: Record<string, string[]>,
): PairHistory {
	return Object.fromEntries(
		Object.entries(raw).map(([k, v]) => [k, new Set(v)]),
	);
}
