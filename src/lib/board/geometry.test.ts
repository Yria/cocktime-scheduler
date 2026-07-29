import { describe, it, expect } from "vitest";
import {
	distance,
	computeSlotOffset,
	emptySlotIndices,
	isInsideTeamBounds,
	slotIndexAt,
	isInDetachZone,
} from "./geometry";
import { SLOT_SIZE, SLOT_GAP } from "./constants";

describe("distance", () => {
	it("같은 좌표는 0", () => {
		expect(distance({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(0);
	});
	it("3-4-5 피타고라스", () => {
		expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
	});
});

describe("computeSlotOffset", () => {
	const h = (SLOT_SIZE + SLOT_GAP) / 2;
	it("슬롯 인덱스 → 2x2 그리드 위치(인원수 무관)", () => {
		expect(computeSlotOffset(0)).toEqual({ x: -h, y: -h }); // top-left
		expect(computeSlotOffset(1)).toEqual({ x: +h, y: -h }); // top-right
		expect(computeSlotOffset(2)).toEqual({ x: -h, y: +h }); // bottom-left
		expect(computeSlotOffset(3)).toEqual({ x: +h, y: +h }); // bottom-right
	});

	it("index 범위 밖은 (0,0) fallback", () => {
		expect(computeSlotOffset(5)).toEqual({ x: 0, y: 0 });
		expect(computeSlotOffset(-1)).toEqual({ x: 0, y: 0 });
	});
});

describe("emptySlotIndices", () => {
	it("점유 슬롯을 뺀 빈 슬롯 인덱스 — 가운데 빈칸도 그대로", () => {
		expect(emptySlotIndices(new Set())).toEqual([0, 1, 2, 3]);
		expect(emptySlotIndices(new Set([0]))).toEqual([1, 2, 3]);
		expect(emptySlotIndices(new Set([0, 2]))).toEqual([1, 3]); // 가운데(1) 빈칸 유지
		expect(emptySlotIndices(new Set([0, 1, 2, 3]))).toEqual([]);
	});
});

describe("slotIndexAt", () => {
	const anchor = { x: 100, y: 100 };
	const h = (SLOT_SIZE + SLOT_GAP) / 2; // 35

	it("슬롯 중심에 정확히 놓으면 그 인덱스(빈/점유 무관)", () => {
		expect(slotIndexAt({ x: anchor.x - h, y: anchor.y - h }, anchor)).toBe(0);
		expect(slotIndexAt({ x: anchor.x + h, y: anchor.y - h }, anchor)).toBe(1);
		expect(slotIndexAt({ x: anchor.x - h, y: anchor.y + h }, anchor)).toBe(2);
		expect(slotIndexAt({ x: anchor.x + h, y: anchor.y + h }, anchor)).toBe(3);
	});

	it("박스 가운데(어느 슬롯도 아님)는 -1", () => {
		expect(slotIndexAt(anchor, anchor)).toBe(-1);
	});
});

describe("isInsideTeamBounds", () => {
	const anchor = { x: 100, y: 100 };

	it("anchor 자기 자신은 true", () => {
		expect(isInsideTeamBounds(anchor, anchor)).toBe(true);
	});

	it("대각선으로 크게 벗어나면 false", () => {
		expect(isInsideTeamBounds({ x: 9999, y: 9999 }, anchor)).toBe(false);
	});
});


describe("isInDetachZone", () => {
	it("칠판 상단 경계를 넘어 네비 영역(y ≤ 0)이면 true", () => {
		expect(isInDetachZone({ x: 100, y: 0 })).toBe(true);
		expect(isInDetachZone({ x: 100, y: -40 })).toBe(true);
	});
	it("칠판 안(y > 0)이면 false — 예전 상단 strip(y≤72)은 더 이상 빼기존이 아님", () => {
		expect(isInDetachZone({ x: 100, y: 1 })).toBe(false);
		expect(isInDetachZone({ x: 100, y: 72 })).toBe(false);
	});
});
