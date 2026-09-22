import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { devtools } from "zustand/middleware";
import { enableMapSet } from "immer";

import type { BoardState } from "./board/types";
import { createViewSlice } from "./board/viewSlice";
import { createMembershipSlice } from "./board/membershipSlice";
import { createMatchSlice } from "./board/matchSlice";
import { pushDraftsToRemote, serializeBoardDrafts, syncState } from "./board/draftsSync";

// 원본 경로 공개 API 유지 — importer(SessionBoard 등)는 계속 이 모듈에서 가져온다.
export { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from "./board/zoom";
export type { BoardState } from "./board/types";

enableMapSet();

// ── store ────────────────────────────────────────────────
// 슬라이스 합성: view(뷰/레이아웃) + membership(팀/예약 멤버십 편집) + match(경기·원격 동기화).
// get()이 전체 BoardState를 반환하므로 크로스 슬라이스 호출(completeMatch→scatterMagnets 등)이 그대로 동작한다.

export const useBoardStore = create<BoardState>()(
	devtools(
		immer((...a) => ({
			...createViewSlice(...a),
			...createMembershipSlice(...a),
			...createMatchSlice(...a),
		})),
		{ name: "boardStore", enabled: import.meta.env.DEV },
	),
);

// 드롭·정렬로 확정한 좌표도 명단과 함께 저장한다. 드래그 중 프레임은 Pixi 로컬이므로 저장하지 않는다.
// 원격 복원·reset은 저장을 억제해 초기 배치로 서버를 덮지 않는다.
useBoardStore.subscribe((state, prev) => {
	if (syncState.applyingRemoteDrafts) return;
	if (state.drafts === prev.drafts && state.reservations === prev.reservations) {
		// 첫 선수 풀 로딩/자동 배치는 서버 명단을 빈 값으로 덮어쓰면 안 된다.
		if (!state.manualLayout || (state.magnets === prev.magnets && state.courtAnchors === prev.courtAnchors)) return;
	}
	const payload = serializeBoardDrafts(state);
	const json = JSON.stringify(payload);
	if (json === syncState.lastSyncedDraftsJson) return;
	syncState.lastSyncedDraftsJson = json;
	pushDraftsToRemote(payload);
});
