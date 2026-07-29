import { describe, it, expect } from "vitest";
import { resolveDropTarget } from "./dropResolver";
import type { DraftTeam, MagnetPosition, Reservation } from "../../types/board";

function mag(playerId: string, x: number, y: number, teamId: string | null = null): MagnetPosition {
	return { playerId, x, y, teamId };
}
function draft(id: string, anchorMemberIds: string[], x: number, y: number): DraftTeam {
	return { id, anchorMemberIds, anchor: { x, y }, createdAt: 0 };
}
function magnets(...ms: MagnetPosition[]): Map<string, MagnetPosition> {
	return new Map(ms.map((m) => [m.playerId, m]));
}
function drafts(...ds: DraftTeam[]): Map<string, DraftTeam> {
	return new Map(ds.map((d) => [d.id, d]));
}
const noRes = new Map<string, Reservation>();

// 팀 anchor (300,300), 1명일 때 빈 슬롯 오프셋 = (+35,-35)/(-35,+35)/(+35,+35) → 슬롯 좌표 예: (335,335)
describe("resolveDropTarget — 자유 자석", () => {
	it("다른 자유 자석 근접 → createPair", () => {
		const m = magnets(mag("a", 100, 100), mag("b", 500, 500));
		const t = resolveDropTarget("b", { x: 120, y: 100 }, m, new Map(), noRes);
		expect(t).toEqual({ kind: "createPair", partnerId: "a", anchor: { x: 110, y: 100 } });
	});

	it("팀 박스 빈 슬롯(구멍) 위 → attach(그 슬롯)", () => {
		const m = magnets(mag("a", 300, 300, "T"), mag("b", 500, 500));
		// a는 슬롯0, (335,335)=anchor+(35,35)=슬롯3(빈칸)
		const t = resolveDropTarget("b", { x: 335, y: 335 }, m, drafts(draft("T", ["a"], 300, 300)), noRes);
		expect(t).toEqual({ kind: "attach", teamId: "T", slot: 3 });
	});

	it("팀 박스 안이지만 슬롯이 아닌 가운데 → none(스냅백)", () => {
		const m = magnets(mag("a", 300, 300, "T"), mag("b", 500, 500));
		const t = resolveDropTarget("b", { x: 300, y: 300 }, m, drafts(draft("T", ["a"], 300, 300)), noRes);
		expect(t).toEqual({ kind: "none" });
	});

	it("정원 4인 팀의 점유 슬롯 위 → replace(그 자리 교체, R4)", () => {
		const m = magnets(
			mag("a", 300, 300, "T"),
			mag("b", 300, 300, "T"),
			mag("c", 300, 300, "T"),
			mag("d", 300, 300, "T"),
			mag("e", 5000, 5000),
		);
		// 4명 모두 점유(a@0,b@1,c@2,d@3). (335,335)=슬롯3(d 점유) → 교체
		const t = resolveDropTarget("e", { x: 335, y: 335 }, m, drafts(draft("T", ["a", "b", "c", "d"], 300, 300)), noRes);
		expect(t).toEqual({ kind: "replace", teamId: "T", slot: 3 });
	});

	it("팀 박스 밖 + 자유 파트너 없음 → move", () => {
		const m = magnets(mag("a", 300, 300, "T"), mag("e", 5000, 5000));
		const t = resolveDropTarget("e", { x: 4000, y: 4000 }, m, drafts(draft("T", ["a"], 300, 300)), noRes);
		expect(t).toEqual({ kind: "move", to: { x: 4000, y: 4000 } });
	});

	it("경기중 선수는 페어 대상에서 제외 → move", () => {
		const m = magnets(mag("p", 100, 100), mag("b", 500, 500));
		const t = resolveDropTarget("b", { x: 110, y: 100 }, m, new Map(), noRes, new Set(["p"]));
		expect(t).toEqual({ kind: "move", to: { x: 110, y: 100 } });
	});

	it("겹친 두 팀 — 안쪽 팀의 빈 슬롯에 놓으면 그 팀에 attach(첫 박스에서 멈추지 않음)", () => {
		// A(300,300)·B(265,265) bounds 겹침. (300,300)은 A 슬롯 아님(중앙)이지만 B의 빈 슬롯(GRID3=anchor+35,+35).
		const m = magnets(mag("a", 300, 300, "A"), mag("b", 265, 265, "B"), mag("c", 900, 900));
		const ds = drafts(draft("A", ["a"], 300, 300), draft("B", ["b"], 265, 265));
		const t = resolveDropTarget("c", { x: 300, y: 300 }, m, ds, noRes);
		expect(t).toEqual({ kind: "attach", teamId: "B", slot: 3 });
	});
});

describe("resolveDropTarget — anchor 멤버", () => {
	it("빈 공간 → detach", () => {
		const m = magnets(mag("a", 300, 300, "T"));
		const t = resolveDropTarget("a", { x: 1500, y: 1500 }, m, drafts(draft("T", ["a"], 300, 300)), noRes);
		expect(t).toEqual({ kind: "detach", to: { x: 1500, y: 1500 } });
	});

	it("다른 팀 빈 슬롯(구멍) 위 → attach(이동, 예약 아님)", () => {
		const m = magnets(mag("a", 300, 300, "T1"), mag("x", 700, 300, "T2"));
		const ds = drafts(draft("T1", ["a"], 300, 300), draft("T2", ["x"], 700, 300));
		// T2 anchor(700,300) x는 슬롯0 → (735,265)=anchor+(35,-35)=슬롯1(빈칸)
		const t = resolveDropTarget("a", { x: 735, y: 265 }, m, ds, noRes);
		expect(t).toEqual({ kind: "attach", teamId: "T2", slot: 1 });
	});

	it("다른 팀 박스 안이지만 슬롯이 아님 → none(스냅백)", () => {
		const m = magnets(mag("a", 300, 300, "T1"), mag("x", 700, 300, "T2"));
		const ds = drafts(draft("T1", ["a"], 300, 300), draft("T2", ["x"], 700, 300));
		const t = resolveDropTarget("a", { x: 700, y: 300 }, m, ds, noRes);
		expect(t).toEqual({ kind: "none" });
	});

	it("자기 팀 박스 안 슬롯 아닌 가운데 → none(스냅백)", () => {
		const m = magnets(mag("a", 300, 300, "T"));
		const t = resolveDropTarget("a", { x: 310, y: 305 }, m, drafts(draft("T", ["a"], 300, 300)), noRes);
		expect(t).toEqual({ kind: "none" });
	});

	it("자기 팀의 자기 슬롯 위 → attach(유지, 하이라이트)", () => {
		const m = magnets(mag("a", 300, 300, "T"));
		// a는 슬롯0=(265,265). 그 위로 끌면 유지(같은 슬롯 재설정)
		const t = resolveDropTarget("a", { x: 265, y: 265 }, m, drafts(draft("T", ["a"], 300, 300)), noRes);
		expect(t).toEqual({ kind: "attach", teamId: "T", slot: 0 });
	});

	it("자기 팀의 빈 슬롯 위 → attach(그 칸으로 재배치, 하이라이트)", () => {
		const m = magnets(mag("a", 300, 300, "T"));
		// a는 슬롯0, (335,335)=슬롯3(빈칸) → 그 칸으로 재배치
		const t = resolveDropTarget("a", { x: 335, y: 335 }, m, drafts(draft("T", ["a"], 300, 300)), noRes);
		expect(t).toEqual({ kind: "attach", teamId: "T", slot: 3 });
	});

	it("자기 팀의 다른 멤버 슬롯 위 → replace(드롭 시 스왑)", () => {
		const m = magnets(mag("a", 300, 300, "T"), mag("b", 300, 300, "T"));
		// a@0, b@1. a를 b의 슬롯1=(335,265) 위로 → replace(같은 팀이라 핸들러에서 스왑)
		const t = resolveDropTarget("a", { x: 335, y: 265 }, m, drafts(draft("T", ["a", "b"], 300, 300)), noRes);
		expect(t).toEqual({ kind: "replace", teamId: "T", slot: 1 });
	});

	it("자유 자석 근접 → createPair(원본 팀에서 빠져 이동)", () => {
		const m = magnets(mag("a", 300, 300, "T1"), mag("c", 900, 900));
		const t = resolveDropTarget("a", { x: 900, y: 900 }, m, drafts(draft("T1", ["a"], 300, 300)), noRes);
		expect(t).toEqual({ kind: "createPair", partnerId: "c", anchor: { x: 900, y: 900 } });
	});
});

// 휴식 선수 — 딱지를 달고 보드에 남되(2026-07 휴식 패널 폐지) 편성은 불가.
// 해제는 "하단 휴식존에 다시 드롭"이 유일한 경로라, 팀에 끌어다 놓아도 위치만 움직여야 한다.
describe("resolveDropTarget — 휴식 선수", () => {
	const resting = new Set(["r"]);

	it("팀 빈 슬롯 위에 놓아도 합류하지 않고 move", () => {
		const m = magnets(mag("a", 300, 300, "T"), mag("r", 500, 500));
		const t = resolveDropTarget(
			"r",
			{ x: 335, y: 335 },
			m,
			drafts(draft("T", ["a"], 300, 300)),
			noRes,
			new Set(),
			new Set(),
			resting,
		);
		expect(t).toEqual({ kind: "move", to: { x: 335, y: 335 } });
	});

	it("다른 자유 자석에 겹쳐도 페어가 만들어지지 않고 move", () => {
		const m = magnets(mag("a", 100, 100), mag("r", 500, 500));
		const t = resolveDropTarget("r", { x: 110, y: 100 }, m, new Map(), noRes, new Set(), new Set(), resting);
		expect(t).toEqual({ kind: "move", to: { x: 110, y: 100 } });
	});

	it("휴식자가 페어 상대로도 안 잡힌다(대기 자석을 휴식자에 겹쳐도 move)", () => {
		const m = magnets(mag("r", 100, 100), mag("b", 500, 500));
		const t = resolveDropTarget("b", { x: 110, y: 100 }, m, new Map(), noRes, new Set(), new Set(), resting);
		expect(t).toEqual({ kind: "move", to: { x: 110, y: 100 } });
	});
});
