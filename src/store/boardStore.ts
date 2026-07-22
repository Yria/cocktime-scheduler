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

// 로컬 멤버십(drafts/reservations) 변경 시 DB 저장 + 브로드캐스트로 공유.
// 위치(자석/anchor) 변경은 무시(로컬). 원격 적용 중에는 생략(피드백 루프 방지).
useBoardStore.subscribe((state, prev) => {
	if (syncState.applyingRemoteDrafts) return;
	if (state.drafts === prev.drafts && state.reservations === prev.reservations) return;
	const payload = serializeBoardDrafts(state);
	const json = JSON.stringify(payload);
	if (json === syncState.lastSyncedDraftsJson) return; // 멤버십 동일(위치만 변경) → 생략
	syncState.lastSyncedDraftsJson = json;
	pushDraftsToRemote(payload);
});
