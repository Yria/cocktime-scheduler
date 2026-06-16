import type { Gender, Player, PlayerSkills, SkillLevel } from "../types";

import { SKILLS } from "./constants";
import { supabase } from "./supabase/client";

function parseSkillLevel(val: string): SkillLevel {
	const v = val?.trim().toUpperCase();
	if (v === "O" || v === "상") return "O";
	if (v === "V" || v === "중") return "V";
	return "X"; // X · 하 · 빈값 등
}

function parseGender(val: string): Gender {
	const v = val?.trim();
	if (v === "F" || v === "여" || v === "여자") return "F";
	return "M";
}

let _fetchPromise: Promise<Player[]> | null = null;
let _cachedPlayers: Player[] | null = null;
let _cacheTime = 0;
const CACHE_TTL = 5_000;

export async function fetchPlayers(): Promise<Player[]> {
	const now = Date.now();
	if (_cachedPlayers && now - _cacheTime < CACHE_TTL) {
		return _cachedPlayers;
	}
	if (_fetchPromise) {
		return _fetchPromise;
	}

	_fetchPromise = (async () => {
		const { data, error } = await supabase.functions.invoke("sheets", {
			method: "GET",
		});
		if (error) throw new Error(`시트 읽기 실패: ${error.message}`);
		const rows: string[][] = data.values ?? [];
		if (rows.length < 2) return [];

		return rows
			.slice(1)
			.filter((row) => row[0]?.trim())
			.map((row, idx) => ({
				id: `player-${idx}`,
				name: row[0].trim(),
				gender: parseGender(row[1]),
				// 시트 컬럼: A 멤버 · B 성별 · C 사진 · D~I 스킬 6종.
				// 사진(C)은 storage 기반 getPlayerPhotoUrl이 담당하므로 여기선 파싱하지 않음.
				skills: {
					클리어: parseSkillLevel(row[3]),
					스매시: parseSkillLevel(row[4]),
					로테이션: parseSkillLevel(row[5]),
					드랍: parseSkillLevel(row[6]),
					헤어핀: parseSkillLevel(row[7]),
					푸시: parseSkillLevel(row[8]),
				} satisfies PlayerSkills,
			}));
	})();

	try {
		const result = await _fetchPromise;
		_cachedPlayers = result;
		_cacheTime = Date.now();
		return result;
	} catch (e) {
		console.error(`[fetchPlayers] FETCH ERROR`, e);
		throw e;
	} finally {
		_fetchPromise = null;
	}
}

// Apps Script 경유 write (Edge Function 프록시)
export async function updatePlayer(
	playerName: string,
	gender: Gender,
	skills: PlayerSkills,
): Promise<void> {
	const columns: Record<string, string> = { 성별: gender };
	for (const skill of SKILLS) {
		columns[skill] = skills[skill];
	}
	const { error } = await supabase.functions.invoke("sheets", {
		method: "POST",
		body: { name: playerName, skills: columns },
	});
	if (error) throw new Error(`수정 실패: ${error.message}`);
	_cachedPlayers = null; // invalidate cache
}

// OAuth Bearer 토큰으로 Sheets API 직접 write (Edge Function 프록시)
export async function updatePlayerWithToken(
	accessToken: string,
	playerName: string,
	gender: Gender,
	skills: PlayerSkills,
): Promise<void> {
	// 시트 컬럼: B 성별 · D~I 스킬(SKILLS 순서). A(멤버)·C(사진)는 건드리지 않는다.
	const skillValues = SKILLS.map((s) => skills[s]);
	const { error } = await supabase.functions.invoke("sheets", {
		method: "PUT",
		headers: { "X-Google-Token": accessToken },
		body: { playerName, gender, skills: skillValues },
	});
	if (error) throw new Error(`수정 실패: ${error.message}`);
	_cachedPlayers = null; // invalidate cache
}
