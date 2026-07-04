import type { StateCreator } from "zustand";
import type { DraftTeam, MagnetPosition, Reservation, StagePoint } from "../../types/board";
import { isInsideTeamBounds, slotIndexAt } from "../../lib/board/geometry";
import { resolveDropTarget, nearestFreePartner } from "../../lib/board/dropResolver";
import {
	cockPendingIds,
	isMemberOf,
	playingIdsFromCourts,
	teamMemberCount,
	teamMembers,
} from "../../lib/board/membership";
import { buildRecommendData } from "../../lib/board/recommendPool";
import { addReservation, attachAnchor, detachAnchor, newId, nowMs } from "../../lib/board/draftMutations";
import { autoFillTeammates } from "../../lib/teamSelection";
import { useSessionStore } from "../sessionStore";
import { toast } from "../toastStore";
import type { BoardState, DragSource } from "./types";
import { clampToStage, placeArranged, replaceAtSlot, runSettle } from "./layoutHelpers";
import { claimEdit } from "./draftsSync";

/** 멤버십 슬라이스 — 자석/예비팀/예약(ghost)/고정배치 등 공유 멤버십의 편집 액션. */
export type MembershipSlice = Pick<
	BoardState,
	| "magnets"
	| "drafts"
	| "reservations"
	| "forcedPairs"
	| "assigningTeamIds"
	| "courtAnchors"
	| "handleDrop"
	| "handleGhostDrop"
	| "handlePlayingMagnetDrop"
	| "commitTeammates"
	| "toggleForced"
	| "autoFillTeam"
	| "autoFillTarget"
	| "detachMember"
	| "cancelReservation"
	| "removeMemberFromBoard"
	| "restPlayer"
	| "unrestPlayer"
>;

export const createMembershipSlice: StateCreator<
	BoardState,
	[["zustand/devtools", never], ["zustand/immer", never]],
	[],
	MembershipSlice
> = (set, get) => ({
	magnets: new Map<string, MagnetPosition>(),
	drafts: new Map<string, DraftTeam>(),
	reservations: new Map<string, Reservation>(),
	forcedPairs: [],
	assigningTeamIds: new Set<string>(),
	courtAnchors: new Map<number, StagePoint>(),

	handleDrop: (playerId, drop) => {
		// 보기 전용(읽기 모드): 공유 멤버십(팀/예약)은 못 바꾸지만, 자유 자석의 로컬 위치 이동은 허용(위치는 로컬 상태·미동기화).
		// 멤버(anchor)는 슬롯 고정이라 스냅백, 팀 합류/페어 등 공유 변경은 일어나지 않는다.
		// (혼자뿐이면 자동 점유로 isEditor=true가 되고, 첫 편집 액션에서도 자유면 자동 점유한다 → 여기 분기는 '남이 편집 중인' 읽기 모드 사용자만 탄다.)
		if (!useSessionStore.getState().isEditor) {
			set((s) => {
				const m = s.magnets.get(playerId);
				if (!m || m.teamId !== null) return;
				const p = clampToStage(s, drop);
				m.x = p.x;
				m.y = p.y;
				runSettle(s, { magnetId: playerId });
			});
			return;
		}
		const ss = useSessionStore.getState();
		const playingIds = playingIdsFromCourts(ss.courts);
		const notReadyIds = cockPendingIds(ss.sessionPlayers.values(), ss.cockCheckEnabled);
		set((s) => {
			s.manualLayout = true; // 편집자가 직접 드래그로 배치/편성 → 이후 자동 정렬 중단(수동이 진실)
			const target = resolveDropTarget(playerId, drop, s.magnets, s.drafts, s.reservations, playingIds, notReadyIds);
			let source: DragSource | null = null;
			switch (target.kind) {
				case "none":
					return; // 변화 없음 → 흩어짐 불필요
				case "move": {
					const m = s.magnets.get(playerId);
					if (m && m.teamId === null) {
						m.x = target.to.x;
						m.y = target.to.y;
					}
					source = { magnetId: playerId };
					break;
				}
				case "attach":
					attachAnchor(s, playerId, target.teamId, target.slot);
					source = { teamId: target.teamId };
					break;
				case "replace":
					replaceAtSlot(s, playerId, target.teamId, target.slot);
					source = { teamId: target.teamId };
					break;
				case "detach": {
					detachAnchor(s, playerId);
					const m = s.magnets.get(playerId);
					if (m) {
						m.x = target.to.x;
						m.y = target.to.y;
					}
					source = { magnetId: playerId };
					break;
				}
				case "createPair": {
					const a = s.magnets.get(playerId);
					const b = s.magnets.get(target.partnerId);
					// 파트너(b)는 자유 자석이어야 한다. 끌어낸 a는 자유이거나 팀구성중(이동)일 수 있다.
					if (!a || !b || b.teamId !== null) return;
					if (a.teamId !== null) detachAnchor(s, playerId); // 팀구성중 멤버 → 원본 팀에서 빠져 새 페어로 이동
					const id = newId();
					s.drafts.set(id, {
						id,
						anchorMemberIds: [playerId, target.partnerId],
						anchor: clampToStage(s, target.anchor),
						createdAt: nowMs(),
					});
					a.teamId = id;
					b.teamId = id;
					source = { teamId: id };
					break;
				}
			}
			// 드래그-엔드: 소스(놓은 자석/그룹)에서 겹친 자유 자석 흩어짐
			if (source) runSettle(s, source);
		});
	},

	handleGhostDrop: (resId, drop) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		set((s) => {
			const r = s.reservations.get(resId);
			if (!r) return;
			// 다른 예비팀 위 → 예약 대상 변경(reReserve). 옮길 수 없으면 no-op(스냅백, 예약 유지).
			let done = false;
			for (const d of s.drafts.values()) {
				if (d.id === r.teamId) continue;
				if (!isInsideTeamBounds(drop, d.anchor)) continue;
				if (
					!isMemberOf(r.playerId, d.id, s.drafts, s.reservations) &&
					teamMemberCount(d.id, s.drafts, s.reservations) < 4
				) {
					r.teamId = d.id;
				}
				done = true;
				break;
			}
			if (!done) {
				// 원래 팀 위 → 스냅백(no-op), 빈 공간 → 예약 취소
				const own = s.drafts.get(r.teamId);
				if (!(own && isInsideTeamBounds(drop, own.anchor))) {
					s.reservations.delete(resId);
				}
			}
			// ghost가 속한(또는 속했던) 팀에서 흩어짐
			if (s.drafts.get(r.teamId)) runSettle(s, { teamId: r.teamId });
		});
	},

	// 경기중(코트 배치) 선수를 끌어내 다른 팀/선수에 겹치면 예약(ghost) 생성.
	// 원본은 코트에 그대로(자석은 슬롯 복귀), 빈 공간 드롭은 no-op.
	handlePlayingMagnetDrop: (playerId, drop) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		const ss = useSessionStore.getState();
		const playingIds = playingIdsFromCourts(ss.courts);
		const notReadyIds = cockPendingIds(ss.sessionPlayers.values(), ss.cockCheckEnabled);
		set((s) => {
			let source: DragSource | null = null;
			// 1) forming/ready 팀의 빈 슬롯(구멍) 위 → 예약 추가. 박스 안 다른 곳이면 슬롯 복귀(no-op).
			//    박스가 겹칠 수 있으므로 bounds 안 모든 팀을 보고 슬롯이 맞는 팀에 예약(첫 박스에서 멈추지 않음).
			let done = false;
			for (const d of s.drafts.values()) {
				if (!isInsideTeamBounds(drop, d.anchor)) continue;
				done = true; // 박스 안이면 새 팀 생성(2단계)으로 넘어가지 않음
				if (isMemberOf(playerId, d.id, s.drafts, s.reservations)) break;
				const slotIdx = slotIndexAt(drop, d.anchor);
				if (slotIdx < 0) break; // 박스 안이지만 슬롯 아님 → 복귀(no-op)
				// 빈 슬롯에만 예약(점유 칸엔 경기중 선수 끼워넣기 안 함 — 복귀). 슬롯 위치 기록.
				const occupied = teamMembers(d.id, s.drafts, s.reservations).some((m) => m.slot === slotIdx);
				if (!occupied && teamMemberCount(d.id, s.drafts, s.reservations) < 4) {
					addReservation(s, playerId, d.id);
					d.slots = d.slots ?? {};
					d.slots[playerId] = slotIdx;
					source = { teamId: d.id };
				}
				break; // 슬롯 판정 끝 → 종료(겹친 다른 팀 탐색 안 함: bounds 안이면 done)
			}
			// 2) 자유 자석 위 → 새 예비팀(파트너 anchor + 이 선수 ghost)
			if (!done) {
				const partner = nearestFreePartner(playerId, drop, s.magnets, playingIds, notReadyIds);
				if (partner) {
					const pm = s.magnets.get(partner.id);
					if (pm && pm.teamId === null) {
						const id = newId();
						s.drafts.set(id, {
							id,
							anchorMemberIds: [partner.id],
							anchor: clampToStage(s, { x: (drop.x + partner.pos.x) / 2, y: (drop.y + partner.pos.y) / 2 }),
							createdAt: nowMs(),
						});
						pm.teamId = id;
						const rid = newId();
						s.reservations.set(rid, { id: rid, playerId, teamId: id, createdAt: nowMs() });
						source = { teamId: id };
					}
				}
				// 3) else no-op (슬롯 복귀)
			}
			if (source) runSettle(s, source);
		});
	},

	commitTeammates: (target, playerIds) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		if (playerIds.length === 0) return;
		const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
		set((s) => {
			let teamId = target.teamId ?? null;
			// 시드 모드: 자유 자석을 첫 멤버로 새 팀 생성
			if (!teamId && target.seedId) {
				const seed = s.magnets.get(target.seedId);
				if (!seed || seed.teamId !== null || playingIds.has(target.seedId)) return;
				teamId = newId();
				s.drafts.set(teamId, {
					id: teamId,
					anchorMemberIds: [target.seedId],
					anchor: clampToStage(s, { x: seed.x, y: seed.y }),
					createdAt: nowMs(),
				});
				seed.teamId = teamId;
			}
			// 새 팀 모드(+ 버튼): 선택분 중 첫 비경기중·자유 선수를 anchor로 새 팀 생성
			if (!teamId && target.newTeam) {
				const anchorId = playerIds.find((id) => {
					const m = s.magnets.get(id);
					return m && m.teamId === null && !playingIds.has(id);
				});
				if (!anchorId) return; // anchor 가능한 선수 없음
				const am = s.magnets.get(anchorId)!;
				teamId = newId();
				s.drafts.set(teamId, {
					id: teamId,
					anchorMemberIds: [anchorId],
					anchor: clampToStage(s, { x: am.x, y: am.y }),
					createdAt: nowMs(),
				});
				am.teamId = teamId;
			}
			if (!teamId || !s.drafts.get(teamId)) return;
			for (const pid of playerIds) {
				if (isMemberOf(pid, teamId, s.drafts, s.reservations)) continue;
				if (teamMemberCount(teamId, s.drafts, s.reservations) >= 4) break;
				// 경기중 선수는 예약(ghost), 그 외는 정식 멤버(anchor)
				if (playingIds.has(pid)) addReservation(s, pid, teamId);
				else attachAnchor(s, pid, teamId);
			}
			// 그룹 생성/채움 후 겹친 자유 자석 흩어짐
			runSettle(s, { teamId });
		});
	},

	toggleForced: (teamId) => {
		if (!claimEdit()) return; // 보기 전용 차단
		set((s) => {
			const team = s.drafts.get(teamId);
			if (!team) return;
			// 현재 멤버(anchor + ghost) 전체 — 4명+예약 잠금 시 예약(ghost)도 함께 락한다("4명 다 락").
			const memberIds = teamMembers(teamId, s.drafts, s.reservations).map((m) => m.playerId);
			const effective = (team.forcedIds ?? []).filter((id) => memberIds.includes(id));
			// 이미 잠금(유효 2+)이면 해제, 아니면 "지금 그룹에 포함된 멤버" 전체를 잠금(이후 추가/제거는 효과 ∩ 또는 재토글).
			team.forcedIds = effective.length >= 2 ? [] : memberIds;
		});
	},

	autoFillTeam: (teamId) => get().autoFillTarget({ teamId }, []),

	// 추천 모달의 "자동편성" 버튼 공용 — 팀/시드/새팀 어디서나 대기 선수로 나머지를 채워 commit.
	// extraIds = 모달에서 사용자가 직접 고른 선수(고정으로 먼저 포함하고 나머지를 자동 채움).
	autoFillTarget: (target, extraIds = []) => {
		if (!claimEdit()) return; // 보기 전용 차단
		const { drafts, reservations, magnets, forcedPairs } = get();
		const ss = useSessionStore.getState();
		const data = buildRecommendData(
			target,
			extraIds,
			{
				drafts,
				reservations,
				magnets,
				sessionPlayers: ss.sessionPlayers,
				courts: ss.courts,
				pairHistory: ss.pairHistory,
				lastGameType: ss.lastGameType,
				matchAssignCount: ss.matchAssignCount,
				forcedPairs,
				cockCheckEnabled: ss.cockCheckEnabled,
			},
			{ excludePlaying: true }, // 자동편성은 대기 선수만으로 채운다(경기중 제외)
		);
		if (!data) return;
		const slotsToFill = 4 - data.confirmed.length; // confirmed = 기존 멤버 + extraIds
		const picks = slotsToFill > 0 ? autoFillTeammates(data.confirmed, data.pool, data.ctx, slotsToFill) : [];
		const ids = [...extraIds, ...picks.map((p) => p.id)];
		if (ids.length === 0) {
			toast("자동편성할 대기 선수가 없어요", { variant: "error" });
			return;
		}
		get().commitTeammates(target, ids);
		if (picks.length < slotsToFill) {
			toast(`대기 선수가 부족해 ${picks.length + extraIds.length}명만 채웠어요`);
		}
	},

	detachMember: (playerId) => {
		if (!claimEdit()) return; // 보기 전용 차단
		set((s) => {
			const mag = s.magnets.get(playerId);
			if (!mag || mag.teamId === null) return;
			detachAnchor(s, playerId); // 팀에서 제거(+남은 인원 부족 시 팀 해체)
			placeArranged(s, playerId); // 복귀 자석은 정렬되는 위치로(드롭 지점 무시)
		});
	},

	cancelReservation: (resId) => {
		if (!claimEdit()) return; // 보기 전용 차단
		set((s) => {
			const r = s.reservations.get(resId);
			if (!r) return;
			const teamId = r.teamId;
			s.reservations.delete(resId);
			if (s.drafts.get(teamId)) runSettle(s, { teamId });
		});
	},

	removeMemberFromBoard: (playerId) => {
		if (!claimEdit()) return; // 보기 전용 차단
		set((s) => {
			// ghost(예약)면 예약 취소
			for (const [rid, r] of [...s.reservations]) {
				if (r.playerId === playerId) {
					const teamId = r.teamId;
					s.reservations.delete(rid);
					if (s.drafts.get(teamId)) runSettle(s, { teamId });
					return;
				}
			}
			// anchor면 팀에서 빼 자유 자석으로 → 정렬되는 위치로 복귀
			const mag = s.magnets.get(playerId);
			if (mag && mag.teamId !== null) {
				detachAnchor(s, playerId);
				placeArranged(s, playerId);
			}
		});
	},

	restPlayer: (playerId) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		set((s) => {
			// 보드 멤버십에서 제거: 팀 anchor 해제 + 이 선수를 가리키는 예약(ghost) 삭제.
			detachAnchor(s, playerId);
			for (const [rid, r] of [...s.reservations]) {
				if (r.playerId === playerId) s.reservations.delete(rid);
			}
		});
		// status='resting' (휴식 진입). 다른 클라이언트에 player_updated 전파.
		void useSessionStore.getState().setResting(playerId, true);
	},

	unrestPlayer: (playerId) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		// status='waiting' 복귀(평균 판수 보정). 복귀 자석은 정렬되는 위치로 배치(드롭 지점 무시).
		void useSessionStore.getState().setResting(playerId, false);
		set((s) => {
			const m = s.magnets.get(playerId);
			if (!m) return;
			m.teamId = null;
			placeArranged(s, playerId);
		});
	},
});
