import { describe, expect, it } from "vitest";
import { diffSessionSettings, type SessionSettingsSnapshot } from "./conflict";

const settings: SessionSettingsSnapshot = {
	courtCount: 2,
	playerIds: ["a", "b", "c", "d"],
	singleWomanIds: [],
	cockCheckEnabled: true,
};

describe("세션 설정 충돌", () => {
	it.each([true, false])("서버와 콕 체크 설정만 달라도 충돌을 표시한다 (local=%s)", (enabled) => {
		const diff = diffSessionSettings(
			{ ...settings, cockCheckEnabled: enabled },
			{ ...settings, cockCheckEnabled: !enabled },
		);
		expect(diff).toEqual({
			courtChanged: false,
			playersChanged: false,
			singleChanged: false,
			cockCheckChanged: true,
			any: true,
		});
	});

	it("같은 설정은 참가자 순서가 바뀌어도 충돌하지 않는다", () => {
		expect(diffSessionSettings(settings, { ...settings, playerIds: [...settings.playerIds].reverse() }).any).toBe(false);
	});
});
