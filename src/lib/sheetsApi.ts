import type { Gender, Player, PlayerSkills, SkillLevel } from "../types";

import { SKILLS } from "./constants";
import { supabase } from "./supabase/client";

function parseSkillLevel(val: string): SkillLevel {
	const v = val?.trim().toUpperCase();
	if (v === "O") return "O";
	if (v === "V") return "V";
	return "X";
}

function parseGender(val: string): Gender {
	const v = val?.trim();
	if (v === "F" || v === "여" || v === "여자") return "F";
	return "M";
}

export async function fetchPlayers(): Promise<Player[]> {
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
			skills: {
				클리어: parseSkillLevel(row[2]),
				스매시: parseSkillLevel(row[3]),
				로테이션: parseSkillLevel(row[4]),
				드랍: parseSkillLevel(row[5]),
				헤어핀: parseSkillLevel(row[6]),
				드라이브: parseSkillLevel(row[7]),
				백핸드: parseSkillLevel(row[8]),
			} satisfies PlayerSkills,
		}));
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
}

// OAuth Bearer 토큰으로 Sheets API 직접 write (Edge Function 프록시)
export async function updatePlayerWithToken(
	accessToken: string,
	playerName: string,
	gender: Gender,
	skills: PlayerSkills,
): Promise<void> {
	const values = [
		playerName,
		gender,
		skills.클리어,
		skills.스매시,
		skills.로테이션,
		skills.드랍,
		skills.헤어핀,
		skills.드라이브,
		skills.백핸드,
	];
	const { error } = await supabase.functions.invoke("sheets", {
		method: "PUT",
		headers: { "X-Google-Token": accessToken },
		body: { playerName, values },
	});
	if (error) throw new Error(`수정 실패: ${error.message}`);
}
