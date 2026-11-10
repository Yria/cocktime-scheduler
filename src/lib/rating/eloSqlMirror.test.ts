import { existsSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ELO, kFactor, seedRating } from "./elo";

// SQL 상수 미러 일치 — 서버(마이그레이션)가 권위다. 숫자를 grep 하는 것만으로는 "1000 이 다른 문맥에
// 우연히 있는" 경우를 못 거르므로, elo_seed/elo_k 는 함수 본문을 떼어 PGlite 에서 **실제로 실행**해
// TS 미러와 값을 비교한다. 가중치(0.6/0.4)·스케일(400)은 별도 함수가 아닐 수 있어 텍스트로 확인한다.

const FILE = "20261109000000_match_results_elo.sql";
const url = new URL(`../../../supabase/migrations/${FILE}`, import.meta.url);

describe("ELO SQL 미러", () => {
	it("마이그레이션 파일이 있다", () => {
		expect(existsSync(url), `${FILE} 없음`).toBe(true);
	});
	if (!existsSync(url)) return;

	const source = readFileSync(url, "utf8");
	// 주석은 빼고 본다 — 주석 속 숫자로 통과하면 미러 검사가 아니다.
	const code = source.replace(/--[^\n]*/g, "");

	/** create … 부터 본문 닫는 달러 인용($$ 또는 $tag$) 뒤 첫 세미콜론까지. `$$ language sql;` 형태도 받는다. */
	function extract(name: string) {
		const re = new RegExp(
			`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`,
			"i",
		);
		const m = re.exec(code);
		if (!m) throw Error(`function public.${name} not found in ${FILE}`);
		const open = /\$[A-Za-z_]*\$/g;
		open.lastIndex = m.index;
		const tag = open.exec(code);
		if (!tag) throw Error(`no body for ${name}`);
		const close = code.indexOf(tag[0], tag.index + tag[0].length);
		const semi = code.indexOf(";", close + tag[0].length);
		return code.slice(m.index, semi + 1);
	}

	let db: PGlite;
	beforeAll(async () => {
		db = new PGlite();
		await db.exec(extract("elo_seed"));
		await db.exec(extract("elo_k"));
	});
	afterAll(async () => {
		await db?.close();
	});

	async function call(sql: string, params: unknown[]) {
		const row = (await db.query<Record<string, unknown>>(sql, params)).rows[0];
		return Number(Object.values(row)[0]);
	}

	it("elo_seed(grade) = seedRating(grade)", async () => {
		for (const g of [-1, 1, 2, 5, 7, 10, 11]) {
			expect(await call("select public.elo_seed($1::int)", [g])).toBe(
				seedRating(g),
			);
		}
		expect(await call("select public.elo_seed(0)", [])).toBe(ELO.DEFAULT);
		expect(await call("select public.elo_seed(null)", [])).toBe(ELO.DEFAULT);
	});

	it("elo_k(games) = kFactor(games)", async () => {
		for (const n of [0, 1, 9, 10, 11, 100]) {
			expect(await call("select public.elo_k($1::int)", [n])).toBe(kFactor(n));
		}
	});

	it("팀 전력 가중치 0.6/0.4 와 스케일 400 이 SQL 에 있다", () => {
		expect(code).toMatch(/\b0\.6\b/);
		expect(code).toMatch(/\b0\.4\b/);
		expect(code).toMatch(/\b400(\.0+)?\b/);
		expect(ELO.WEAK_W).toBe(0.6);
		expect(ELO.STRONG_W).toBe(0.4);
		expect(ELO.SCALE).toBe(400);
	});
});
