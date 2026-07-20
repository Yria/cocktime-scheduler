import type { StateCreator } from "zustand";
import type { MagnetPosition } from "../../types/board";
import { DEFAULT_VIEWPORT } from "../../lib/board/geometry";
import { MAGNET_SIZE, TEAM_BOX_BELOW } from "../../lib/board/constants";
import { arrangeBoard } from "../../lib/board/arrange";
import { scatterFromSource } from "../../lib/board/scatter";
import { settleFreeMagnets } from "../../lib/board/settle";
import { cockPendingIds, playingIdsFromCourts } from "../../lib/board/membership";
import { detachAnchor } from "../../lib/board/draftMutations";
import { useSessionStore } from "../sessionStore";
import type { BoardState } from "./types";
import { clampScale, loadScale, SCALE_KEY } from "./zoom";
import { clampToStage, gridPos, runSettle } from "./layoutHelpers";

/** 뷰/레이아웃 슬라이스 — 줌·스테이지 크기·드래그 하이라이트·정렬/흩어짐·풀 초기화·리셋. */
export type ViewSlice = Pick<
	BoardState,
	| "manualLayout"
	| "stageW"
	| "stageH"
	| "scale"
	| "restZoneOpen"
	| "restFieldHot"
	| "presenceModalOpen"
	| "dragInfo"
	| "hoverTarget"
	| "detachHot"
	| "initializeFromPool"
	| "setTeamAnchor"
	| "setCourtAnchor"
	| "setStageSize"
	| "setScale"
	| "settleBoard"
	| "cancelEditActions"
	| "scatterMagnets"
	| "rearrangeAll"
	| "toggleRestZone"
	| "closeRestZone"
	| "setRestFieldHot"
	| "setDragInfo"
	| "setHoverTarget"
	| "setDetachHot"
	| "clearDrag"
	| "setPresenceModalOpen"
	| "reset"
>;

export const createViewSlice: StateCreator<
	BoardState,
	[["zustand/devtools", never], ["zustand/immer", never]],
	[],
	ViewSlice
> = (set, get) => ({
	manualLayout: false,
	stageW: 0,
	stageH: 0,
	scale: loadScale(),
	restZoneOpen: false,
	restFieldHot: false,
	presenceModalOpen: false,
	dragInfo: null,
	hoverTarget: null,
	detachHot: false,

	initializeFromPool: (players) => {
		const current = get().magnets;
		const ids = new Set(players.map((p) => p.id));
		if (current.size === ids.size && [...ids].every((id) => current.has(id))) return;

		set((s) => {
			let idx = s.magnets.size;
			for (const p of players) {
				if (s.magnets.has(p.id)) continue;
				const pos = gridPos(idx++);
				s.magnets.set(p.id, { playerId: p.id, x: pos.x, y: pos.y, teamId: null });
			}
			const toRemove: string[] = [];
			for (const id of s.magnets.keys()) {
				if (!ids.has(id)) toRemove.push(id);
			}
			for (const id of toRemove) {
				detachAnchor(s, id);
				// 이 선수를 가리키던 예약도 정리
				for (const [rid, r] of [...s.reservations]) {
					if (r.playerId === id) s.reservations.delete(rid);
				}
				s.magnets.delete(id);
			}
		});
	},

	setTeamAnchor: (teamId, x, y) => {
		const editing = useSessionStore.getState().isEditor;
		set((s) => {
			if (editing) s.manualLayout = true; // 편집자가 팀을 직접 옮기면 자동 정렬 중단(뷰어 로컬 이동은 자동 유지)
			const t = s.drafts.get(teamId);
			if (t) t.anchor = clampToStage(s, { x, y }); // 화면 안 어디든(코트 레인 제한 없음), 화면 밖만 방지
		});
	},

	setCourtAnchor: (courtId, x, y) => {
		const editing = useSessionStore.getState().isEditor;
		set((s) => {
			if (editing) s.manualLayout = true; // 편집자가 코트 카드를 직접 옮기면 자동 정렬 중단
			s.courtAnchors.set(courtId, clampToStage(s, { x, y })); // 코트 카드도 화면 안 어디든
		});
	},

	setStageSize: (w, h) => {
		set((s) => {
			s.stageW = w;
			s.stageH = h;
		});
	},

	setScale: (v) => {
		const next = clampScale(typeof v === "function" ? v(get().scale) : v);
		if (next === get().scale) return;
		set((s) => {
			s.scale = next;
		});
		try {
			localStorage.setItem(SCALE_KEY, String(next));
		} catch {
			// localStorage 불가(시크릿 등) — 영속 생략
		}
	},

	settleBoard: (source) => {
		set((s) => {
			runSettle(s, source);
		});
	},

	cancelEditActions: () => {
		set((s) => {
			s.dragInfo = null;
			s.hoverTarget = null;
			s.detachHot = false;
			s.restFieldHot = false;
			s.assigningTeamIds = new Set();
		});
	},

	scatterMagnets: (ids) => {
		set((s) => {
			const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
			const restingIds = new Set(useSessionStore.getState().restingIds);
			const vw = s.stageW || DEFAULT_VIEWPORT.vw;
			const vh = s.stageH || DEFAULT_VIEWPORT.vh;
			const r = MAGNET_SIZE / 2;

			// 흩어뜨릴 대상: 자유(teamId null)·비경기중·비휴식 자석만
			const targets: MagnetPosition[] = [];
			for (const id of ids) {
				const m = s.magnets.get(id);
				if (m && m.teamId === null && !playingIds.has(id) && !restingIds.has(id)) targets.push(m);
			}
			if (targets.length === 0) return;

			// 경기 완료된 자석은 "경기 시작 때 그룹이 있던 자리"에 그대로 남아 그룹과 겹쳐 가려진다.
			// → 그룹(팀) 영역의 최하단 아래(항상 보이는 곳)로 옮긴 뒤 흩어짐을 시작한다. 그룹이 없으면 상단부터.
			let groupBottom = 0;
			for (const t of s.drafts.values()) {
				groupBottom = Math.max(groupBottom, t.anchor.y + TEAM_BOX_BELOW);
			}
			const startY = Math.max(r + 4, Math.min(vh - r - 4, groupBottom + r + 8));

			targets.forEach((m, i) => {
				m.x = Math.max(r + 4, Math.min(vw - r - 4, r + 8 + i * (MAGNET_SIZE + 10)));
				m.y = startY;
				scatterFromSource(
					{ kind: "magnet", id: m.playerId, x: m.x, y: m.y },
					s.magnets,
					s.drafts,
					vw,
					vh,
					playingIds,
					0,
				);
			});
			// 잔여 겹침/팀 박스 침범 정리 (완료 자석 + 기존 자유 자석 모두 겹침 해소), 화면 경계로만
			settleFreeMagnets(s.magnets, s.drafts, vw, vh, playingIds, 0);
		});
	},

	rearrangeAll: (viewW, viewH, markManual = false) => {
		const ss = useSessionStore.getState();
		const sessionCourts = ss.courts;
		const sessionPlayers = ss.sessionPlayers;
		const playingIds = playingIdsFromCourts(sessionCourts);
		const restingIds = new Set(ss.restingIds);
		const cockPending = cockPendingIds(sessionPlayers.values(), ss.cockCheckEnabled);
		const editing = ss.isEditor;
		set((s) => {
			// 정렬 버튼(markManual)로 편집자가 명시 배치하면 자동 fit 중단 — 축소해 둔 비율·정렬 결과를 이후 멤버십/코트 변화가 덮어쓰지 않게.
			if (markManual && editing) s.manualLayout = true;
			arrangeBoard({
				magnets: s.magnets,
				drafts: s.drafts,
				reservations: s.reservations,
				courtAnchors: s.courtAnchors,
				courts: sessionCourts,
				sessionPlayers,
				playingIds,
				restingIds,
				cockPendingIds: cockPending,
				viewW,
				viewH,
			});
		});
	},

	toggleRestZone: () => {
		set((s) => {
			s.restZoneOpen = !s.restZoneOpen;
		});
	},

	closeRestZone: () => {
		set((s) => {
			if (s.restZoneOpen) s.restZoneOpen = false;
		});
	},

	setRestFieldHot: (hot) => {
		// 값이 같으면 immer가 동일 상태를 반환해 리렌더 없음(드래그 프레임마다 호출돼도 안전).
		set((s) => {
			s.restFieldHot = hot;
		});
	},

	setDragInfo: (info) => {
		set((s) => {
			s.dragInfo = info;
		});
	},

	setHoverTarget: (t) => {
		// 객체는 immer가 내용 동일해도 새 참조면 리렌더하므로, 내용 비교로 무변경 시 스킵(드래그 프레임 다발 호출).
		const cur = get().hoverTarget;
		if (cur === t) return;
		if (cur && t && cur.kind === t.kind) {
			if (cur.kind === "magnet" && t.kind === "magnet" && cur.id === t.id) return;
			if (cur.kind === "slot" && t.kind === "slot" && cur.teamId === t.teamId && cur.slotIndex === t.slotIndex) return;
		}
		set((s) => {
			s.hoverTarget = t;
		});
	},

	setDetachHot: (hot) => {
		// boolean은 immer가 동일값이면 리렌더 없음.
		set((s) => {
			s.detachHot = hot;
		});
	},

	clearDrag: () => {
		set((s) => {
			s.dragInfo = null;
			s.hoverTarget = null;
			s.detachHot = false;
		});
	},

	setPresenceModalOpen: (open) => {
		set((s) => {
			s.presenceModalOpen = open;
		});
	},

	reset: () => {
		set((s) => {
			s.magnets = new Map();
			s.drafts = new Map();
			s.reservations = new Map();
			s.assigningTeamIds = new Set();
			s.courtAnchors = new Map();
			s.manualLayout = false;
			s.stageW = 0;
			s.stageH = 0;
			s.restZoneOpen = false;
			s.restFieldHot = false;
			s.presenceModalOpen = false;
			s.dragInfo = null;
			s.hoverTarget = null;
			s.detachHot = false;
		});
	},
});
