import { describe, expect, it } from "vitest";
import {
	applySplit,
	boardPartner,
	canEditTeams,
	isBoardSplit,
	pickAnchor,
	type Slot,
	splitWithPartner,
	teamAIds,
} from "./teamSplit";

const SLOTS: Slot[] = [0, 1, 2, 3];
const players = ["a1", "a2", "b1", "b2"].map((id) => ({ spId: `sp-${id}`, memberId: `m-${id}`, name: id }));

describe("splitWithPartner — 기준 선수 + 고른 짝 → 실제 편", () => {
	it("보드 짝을 고르면 보드 나눔 그대로", () => {
		expect(splitWithPartner(0, 1)).toEqual({ a: [0, 1], b: [2, 3] });
		expect(splitWithPartner(3, 2)).toEqual({ a: [0, 1], b: [2, 3] });
		expect(splitWithPartner(2, boardPartner(2))).toEqual({ a: [0, 1], b: [2, 3] });
	});

	it("모든 기준·짝 조합: 둘은 한 편, 기준 선수는 보드에서 있던 쪽(A/B)에 남고, 각 편은 보드 순서", () => {
		for (const anchor of SLOTS) {
			for (const partner of SLOTS.filter((s) => s !== anchor)) {
				const { a, b } = splitWithPartner(anchor, partner);
				const mine = anchor < 2 ? a : b;
				expect(mine, `${anchor}+${partner}`).toEqual([anchor, partner].sort());
				expect([...a, ...b].sort()).toEqual([0, 1, 2, 3]);
				expect(a[0] < a[1] && b[0] < b[1]).toBe(true);
			}
		}
	});

	it("나(B1)가 B2 대신 A1 과 쳤다 → A편 = A2·B2, B편(내 패널) = A1·B1", () => {
		const s = splitWithPartner(2, 0);
		expect(s).toEqual({ a: [1, 3], b: [0, 2] });
		const shown = applySplit(players, s);
		expect(shown.teamA.map((p) => p.name)).toEqual(["a2", "b2"]);
		expect(shown.teamB.map((p) => p.name)).toEqual(["a1", "b1"]);
		expect(teamAIds(players, s)).toEqual(["sp-a2", "sp-b2"]);
	});

	it("세 가지 짝은 서로 다른 세 나눔을 만든다(4명 복식의 경우의 수 전부)", () => {
		for (const anchor of SLOTS) {
			const keys = SLOTS.filter((s) => s !== anchor).map((p) => {
				const { a, b } = splitWithPartner(anchor, p);
				return [a.join(""), b.join("")].sort().join("|");
			});
			expect(new Set(keys).size).toBe(3);
		}
	});
});

describe("pickAnchor · teamAIds · canEditTeams", () => {
	it("내가 뛰었으면 나, 아니면 보드 A편 첫 사람", () => {
		expect(pickAnchor(players, "m-b2")).toBe(3);
		expect(pickAnchor(players, "m-zz")).toBe(0);
		expect(pickAnchor(players, null)).toBe(0);
	});

	it("spId 가 모자라거나 겹치면 편을 고칠 수 없다(teamA = null)", () => {
		expect(canEditTeams(players)).toBe(true);
		const missing = players.map((p, i) => (i === 2 ? { ...p, spId: null } : p));
		expect(canEditTeams(missing)).toBe(false);
		expect(teamAIds(missing, splitWithPartner(0, 2))).toBeNull();
	});

	it("짝을 안 바꿨으면(보드 나눔) teamA = null — 열 때 찍은 spId 가 낡아도 서버가 현재 로스터로 나눈다", () => {
		for (const anchor of SLOTS) {
			expect(isBoardSplit(splitWithPartner(anchor, boardPartner(anchor)))).toBe(true);
			expect(teamAIds(players, splitWithPartner(anchor, boardPartner(anchor))), `${anchor}`).toBeNull();
			for (const p of SLOTS.filter((s) => s !== anchor && s !== boardPartner(anchor)))
				expect(teamAIds(players, splitWithPartner(anchor, p)), `${anchor}+${p}`).not.toBeNull();
		}
		expect(canEditTeams([...players.slice(0, 3), { ...players[3], spId: "sp-a1" }])).toBe(false);
		expect(canEditTeams(players.slice(0, 3))).toBe(false);
	});
});
