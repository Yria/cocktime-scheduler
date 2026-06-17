import { describe, it, expect } from "vitest";
import {
	distance,
	computeSlotOffset,
	computeEmptySlots,
	isInsideTeamBounds,
	isOnEmptySlot,
	isInDetachZone,
} from "./geometry";
import { SLOT_SIZE, SLOT_GAP, DETACH_ZONE_H } from "./constants";

describe("distance", () => {
	it("같은 좌표는 0", () => {
		expect(distance({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(0);
	});
	it("3-4-5 피타고라스", () => {
		expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
	});
});

describe("computeSlotOffset", () => {
	it("항상 2x2 그리드 위치 사용", () => {
		const h = (SLOT_SIZE + SLOT_GAP) / 2;
		const v = h;
		// 1명: top-left
		expect(computeSlotOffset(0, 1)).toEqual({ x: -h, y: -v });
		// 2명: top-left, top-right
		expect(computeSlotOffset(0, 2)).toEqual({ x: -h, y: -v });
		expect(computeSlotOffset(1, 2)).toEqual({ x: +h, y: -v });
		// 3명: slots 0,1,2
		expect(computeSlotOffset(0, 3)).toEqual({ x: -h, y: -v });
		expect(computeSlotOffset(1, 3)).toEqual({ x: +h, y: -v });
		expect(computeSlotOffset(2, 3)).toEqual({ x: -h, y: +v });
	});

	it("4명 팀: 2x2 grid 꽉 채움", () => {
		const h = (SLOT_SIZE + SLOT_GAP) / 2;
		const v = h;
		expect(computeSlotOffset(3, 4)).toEqual({ x: +h, y: +v });
	});

	it("index 범위 밖은 (0,0) fallback", () => {
		expect(computeSlotOffset(5, 4)).toEqual({ x: 0, y: 0 });
		expect(computeSlotOffset(-1, 4)).toEqual({ x: 0, y: 0 });
	});
});

describe("computeEmptySlots", () => {
	it("1명은 빈 슬롯 3개", () => {
		expect(computeEmptySlots(1)).toHaveLength(3);
	});
	it("2명은 빈 슬롯 2개", () => {
		expect(computeEmptySlots(2)).toHaveLength(2);
	});
	it("3명은 빈 슬롯 1개", () => {
		expect(computeEmptySlots(3)).toHaveLength(1);
	});
	it("4명은 빈 슬롯 없음", () => {
		expect(computeEmptySlots(4)).toEqual([]);
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

describe("isOnEmptySlot", () => {
	const anchor = { x: 100, y: 100 };
	const h = (SLOT_SIZE + SLOT_GAP) / 2; // 35

	it("빈 슬롯 중심에 정확히 놓으면 true", () => {
		// 2명 팀의 빈 슬롯 = idx2(-h,+h), idx3(+h,+h)
		expect(isOnEmptySlot({ x: anchor.x + h, y: anchor.y + h }, anchor, 2)).toBe(true);
	});

	it("박스 가운데(슬롯 아님)는 false", () => {
		expect(isOnEmptySlot(anchor, anchor, 2)).toBe(false);
	});

	it("이미 찬 슬롯 위는 false(빈 슬롯만 타겟)", () => {
		// 2명이면 idx0(-h,-h)은 찬 슬롯 → 타겟 아님
		expect(isOnEmptySlot({ x: anchor.x - h, y: anchor.y - h }, anchor, 2)).toBe(false);
	});

	it("정원 4명이면 빈 슬롯 없음 → 항상 false", () => {
		expect(isOnEmptySlot({ x: anchor.x + h, y: anchor.y + h }, anchor, 4)).toBe(false);
	});
});

describe("isInDetachZone", () => {
	it("상단 밴드 안(y ≤ DETACH_ZONE_H)이면 true", () => {
		expect(isInDetachZone({ x: 100, y: 0 })).toBe(true);
		expect(isInDetachZone({ x: 100, y: DETACH_ZONE_H })).toBe(true);
	});
	it("밴드 아래면 false", () => {
		expect(isInDetachZone({ x: 100, y: DETACH_ZONE_H + 1 })).toBe(false);
	});
});
