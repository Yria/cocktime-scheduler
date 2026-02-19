import { createClient } from "@supabase/supabase-js";
import type {
	Court,
	GameCountHistory,
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

const SESSION_ID = 1;

export async function fetchSession(): Promise<SessionRow | null> {
	const { data, error } = await supabase
		.from("sessions")
		.select("*")
		.eq("id", SESSION_ID)
		.single();
	if (error) {
		console.error("fetchSession:", error);
		return null;
	}
	return data as SessionRow;
}

export async function startSession(
	initData: SessionInitData,
	clientId: string,
): Promise<void> {
	const { error } = await supabase
		.from("sessions")
		.update({
			is_active: true,
			init_data: initData,
			state_data: null,
			last_client_id: clientId,
			updated_at: new Date().toISOString(),
		})
		.eq("id", SESSION_ID);
	if (error) console.error("startSession:", error);
}

export async function updateSessionState(
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
		.eq("id", SESSION_ID);
	if (error) console.error("updateSessionState:", error);
}

export async function endSession(clientId: string): Promise<void> {
	const { error } = await supabase
		.from("sessions")
		.update({
			is_active: false,
			init_data: null,
			state_data: null,
			last_client_id: clientId,
			updated_at: new Date().toISOString(),
		})
		.eq("id", SESSION_ID);
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
