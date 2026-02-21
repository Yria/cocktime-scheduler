import type { Gender, Player, PlayerSkills, SkillLevel } from "../types";

const SKILLS: (keyof PlayerSkills)[] = [
	"클리어",
	"스매시",
	"로테이션",
	"드랍",
	"헤어핀",
	"드라이브",
	"백핸드",
];

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

// fetchPlayers 호출 시 spreadsheetId를 캐싱해 OAuth write 함수에서 재사용
let _spreadsheetId = "";

export async function fetchPlayers(
	spreadsheetId: string,
	apiKey: string,
): Promise<Player[]> {
	_spreadsheetId = spreadsheetId;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:I?key=${apiKey}`;

	const res = await fetch(url);
	if (!res.ok) throw new Error(`시트 읽기 실패: ${res.status}`);

	const data = await res.json();
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

// Apps Script 경유 write (scriptUrl 사용)
export async function updatePlayer(
	scriptUrl: string,
	playerName: string,
	gender: Gender,
	skills: PlayerSkills,
): Promise<void> {
	const columns: Record<string, string> = { 성별: gender };
	for (const skill of SKILLS) {
		columns[skill] = skills[skill];
	}
	const res = await fetch(scriptUrl, {
		method: "POST",
		redirect: "follow",
		body: JSON.stringify({ name: playerName, skills: columns }),
	});
	if (!res.ok) throw new Error(`수정 실패: ${res.status}`);
}

// OAuth Bearer 토큰으로 Sheets API 직접 write
export async function updatePlayerWithToken(
	accessToken: string,
	playerName: string,
	gender: Gender,
	skills: PlayerSkills,
): Promise<void> {
	if (!_spreadsheetId) throw new Error("시트가 연결되지 않았습니다");

	// 이름으로 행 번호 탐색 (A열만 읽기)
	const findRes = await fetch(
		`https://sheets.googleapis.com/v4/spreadsheets/${_spreadsheetId}/values/A:A`,
		{ headers: { Authorization: `Bearer ${accessToken}` } },
	);
	if (!findRes.ok) throw new Error(`행 탐색 실패: ${findRes.status}`);
	const findData = await findRes.json();
	const nameCol: string[][] = findData.values ?? [];
	const rowIndex = nameCol.findIndex(
		(row, i) => i > 0 && row[0]?.trim() === playerName,
	);
	if (rowIndex === -1)
		throw new Error(`선수를 찾을 수 없습니다: ${playerName}`);

	const sheetRow = rowIndex + 1; // 1-based
	const values = [
		playerName,
		gender,
		skills["클리어"],
		skills["스매시"],
		skills["로테이션"],
		skills["드랍"],
		skills["헤어핀"],
		skills["드라이브"],
		skills["백핸드"],
	];

	const updateRes = await fetch(
		`https://sheets.googleapis.com/v4/spreadsheets/${_spreadsheetId}/values/A${sheetRow}:I${sheetRow}?valueInputOption=USER_ENTERED`,
		{
			method: "PUT",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ values: [values] }),
		},
	);
	if (!updateRes.ok) throw new Error(`수정 실패: ${updateRes.status}`);
}
