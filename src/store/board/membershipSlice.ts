import type { StateCreator } from "zustand";
import type { DraftTeam, MagnetPosition, Reservation, StagePoint } from "../../types/board";
import { isInsideTeamBounds, slotIndexAt } from "../../lib/board/geometry";
import { resolveDropTarget, nearestFreePartner } from "../../lib/board/dropResolver";
import {
	cockPendingIds,
	isMemberOf,
	isTeamStartable,
	playingIdsFromCourts,
	teamMemberCount,
	teamMembers,
} from "../../lib/board/membership";
import { buildRecommendData } from "../../lib/board/recommendPool";
import {
	addReservation,
	attachAnchor,
	clearConfirmIfBelowFull,
	detachAnchor,
	newId,
	nowMs,
} from "../../lib/board/draftMutations";
import { autoFillTeammates } from "../../lib/teamSelection";
import { useSessionStore } from "../sessionStore";
import { toast } from "../toastStore";
import type { BoardState, DragSource } from "./types";
import { clampToStage, placeArranged, replaceAtSlot, runSettle } from "./layoutHelpers";
import { claimEdit, currentEditorName } from "./draftsSync";

/** 멤버십 슬라이스 — 자석/예비팀/예약(ghost) 등 공유 멤버십의 편집 액션. */
export type MembershipSlice = Pick<
	BoardState,
	| "magnets"
	| "drafts"
	| "reservations"
	| "assigningTeamIds"
	| "courtAnchors"
	| "handleDrop"
	| "handleGhostDrop"
	| "handlePlayingMagnetDrop"
	| "commitTeammates"
	| "confirmTeam"
	| "unconfirmTeam"
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
		const restingIds = new Set(ss.restingIds); // 휴식 자석은 페어 대상에서 제외(빈 자리 유령 그룹 방지)
		set((s) => {
			s.manualLayout = true; // 편집자가 직접 드래그로 배치/편성 → 이후 자동 정렬 중단(수동이 진실)
			const target = resolveDropTarget(playerId, drop, s.magnets, s.drafts, s.reservations, playingIds, notReadyIds, restingIds);
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
					attachAnchor(s, playerId, target.teamId, target.slot, currentEditorName());
					source = { teamId: target.teamId };
					break;
				case "replace":
					replaceAtSlot(s, playerId, target.teamId, target.slot, currentEditorName());
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
						createdBy: currentEditorName(),
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
			const fromTeamId = r.teamId;
			// 다른 예비팀 위 → 예약 대상 변경(reReserve). 옮길 수 없으면 no-op(스냅백, 예약 유지).
			let done = false;
			for (const d of s.drafts.values()) {
				if (d.id === fromTeamId) continue;
				if (!isInsideTeamBounds(drop, d.anchor)) continue;
				if (
					!isMemberOf(r.playerId, d.id, s.drafts, s.reservations) &&
					teamMemberCount(d.id, s.drafts, s.reservations) < 4
				) {
					r.teamId = d.id;
					d.createdBy = currentEditorName(); // 새 인원(ghost)을 넣은 편집자로 갱신
					clearConfirmIfBelowFull(s, fromTeamId); // ghost가 빠진 원 팀은 4명 미만이면 확정 해제
				}
				done = true;
				break;
			}
			if (!done) {
				// 원래 팀 위 → 스냅백(no-op), 빈 공간 → 예약 취소
				const own = s.drafts.get(fromTeamId);
				if (!(own && isInsideTeamBounds(drop, own.anchor))) {
					s.reservations.delete(resId);
					clearConfirmIfBelowFull(s, fromTeamId);
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
		const restingIds = new Set(ss.restingIds); // 휴식 자석은 페어 대상에서 제외(빈 자리 유령 예비팀 방지)
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
					addReservation(s, playerId, d.id, currentEditorName());
					d.slots = d.slots ?? {};
					d.slots[playerId] = slotIdx;
					source = { teamId: d.id };
				}
				break; // 슬롯 판정 끝 → 종료(겹친 다른 팀 탐색 안 함: bounds 안이면 done)
			}
			// 2) 자유 자석 위 → 새 예비팀(파트너 anchor + 이 선수 ghost)
			if (!done) {
				const partner = nearestFreePartner(playerId, drop, s.magnets, playingIds, notReadyIds, restingIds);
				if (partner) {
					const pm = s.magnets.get(partner.id);
					if (pm && pm.teamId === null) {
						const id = newId();
						s.drafts.set(id, {
							id,
							anchorMemberIds: [partner.id],
							anchor: clampToStage(s, { x: (drop.x + partner.pos.x) / 2, y: (drop.y + partner.pos.y) / 2 }),
							createdAt: nowMs(),
							createdBy: currentEditorName(),
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
					createdBy: currentEditorName(),
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
					createdBy: currentEditorName(),
				});
				am.teamId = teamId;
			}
			if (!teamId || !s.drafts.get(teamId)) return;
			for (const pid of playerIds) {
				if (isMemberOf(pid, teamId, s.drafts, s.reservations)) continue;
				if (teamMemberCount(teamId, s.drafts, s.reservations) >= 4) break;
				// 경기중 선수는 예약(ghost), 그 외는 정식 멤버(anchor)
				if (playingIds.has(pid)) addReservation(s, pid, teamId, currentEditorName());
				else attachAnchor(s, pid, teamId, undefined, currentEditorName());
			}
			// 그룹 생성/채움 후 겹친 자유 자석 흩어짐
			runSettle(s, { teamId });
		});
	},

	confirmTeam: (teamId) => {
		if (!claimEdit()) return; // 보기 전용 차단
		const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
		set((s) => {
			const team = s.drafts.get(teamId);
			if (!team || team.confirmedMs != null) return; // 없음/이미 확정 → no-op
			// 확정은 "지금 시작 가능한 4명"만 — 예약(ghost)의 원본이 아직 경기중이면 불가(그 팀은 '예약 대기' 안내).
			if (!isTeamStartable(teamId, s.drafts, s.reservations, s.magnets, playingIds)) return;
			team.confirmedMs = nowMs(); // 확정 순서의 기준(오름차순 = 대기열)
		});
	},

	unconfirmTeam: (teamId) => {
		if (!claimEdit()) return; // 보기 전용 차단
		set((s) => {
			const team = s.drafts.get(teamId);
			if (!team || team.confirmedMs == null) return;
			delete team.confirmedMs;
		});
	},

	autoFillTeam: (teamId) => get().autoFillTarget({ teamId }, []),

	// 추천 모달의 "자동편성" 버튼 공용 — 팀/시드/새팀 어디서나 나머지 슬롯을 추천순으로 채워 commit.
	// extraIds = 모달에서 사용자가 직접 고른 선수(먼저 포함하고 나머지를 자동 채움).
	// 경기중 선수도 팀당 1명까지 ghost 예약으로 뽑을 수 있다(2026-07 개편) — W_PLAYING(30) 페널티를
	// 안고도 상위인 경우(대기 후보들이 재결성 벌점 등으로 밀릴 때)만 뽑히며, commitTeammates가
	// 경기중 pick을 자동으로 예약(ghost) 처리한다. 다른 팀에 이미 예약된 선수는 풀에서 제외.
	autoFillTarget: (target, extraIds = []) => {
		if (!claimEdit()) return; // 보기 전용 차단
		const { drafts, reservations, magnets } = get();
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
				groupHistory: ss.groupHistory,
				lastGameType: ss.lastGameType,
				cockCheckEnabled: ss.cockCheckEnabled,
			},
			{ excludeReserved: true }, // 이중 ghost 예약 방지(경기중 포함은 maxPlaying으로 상한)
		);
		if (!data) return;
		const slotsToFill = 4 - data.confirmed.length; // confirmed = 기존 멤버 + extraIds
		// ghost 상한은 "팀 단위" 1명 — 기존 ghost 예약·다이얼로그에서 직접 고른 경기중 선수(extraIds)를
		// 차감해서, 자동편성 재실행/조합으로 한 팀에 ghost 2명이 생기지 않게 한다.
		const playingInTeam = data.confirmed.filter((p) => data.playingIds.has(p.id)).length;
		const picks =
			slotsToFill > 0
				? autoFillTeammates(data.confirmed, data.pool, data.ctx, slotsToFill, undefined, {
						maxPlaying: Math.max(0, 1 - playingInTeam),
					})
				: [];
		const ids = [...extraIds, ...picks.map((p) => p.id)];
		if (ids.length === 0) {
			toast("자동편성할 선수가 없어요", { variant: "error" });
			return;
		}
		// 새 팀 모드는 anchor(비경기중 1명)가 필수 — 전원 경기중이면 commitTeammates가 조용히
		// no-op하므로 거짓 부분성공 토스트 대신 정직하게 실패를 알린다.
		if (target.newTeam && ids.every((id) => data.playingIds.has(id))) {
			toast("경기중이 아닌 선수가 1명은 필요해요", { variant: "error" });
			return;
		}
		get().commitTeammates(target, ids);
		if (picks.length < slotsToFill) {
			toast(`선수가 부족해 ${picks.length + extraIds.length}명만 채웠어요`);
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
			clearConfirmIfBelowFull(s, teamId); // 인원이 줄면 매칭확정 해제
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
					clearConfirmIfBelowFull(s, teamId); // 인원이 줄면 매칭확정 해제
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
			const ghostLostTeamIds = new Set<string>();
			for (const [rid, r] of [...s.reservations]) {
				if (r.playerId !== playerId) continue;
				s.reservations.delete(rid);
				ghostLostTeamIds.add(r.teamId);
			}
			// ghost가 빠진 팀은 4명 미만이면 매칭확정 해제
			for (const tid of ghostLostTeamIds) clearConfirmIfBelowFull(s, tid);
			// 휴식자도 "휴식" 딱지를 달고 보드에 남는다(2026-07 휴식 패널 폐지) → 드롭 지점(하단 바 =
			// 칠판 밖)이 아니라 자유 자석 격자의 정렬 위치로 보낸다. 보드에서 사라지면 운영진이 "버그로
			// 없어졌다"고 오인해 게스트를 중복 추가하는 사고가 있었다.
			placeArranged(s, playerId, true);
		});
		// status='resting' (휴식 진입). 다른 클라이언트에 player_updated 전파.
		void useSessionStore.getState().setResting(playerId, true);
	},

	unrestPlayer: (playerId) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		// status='waiting' 복귀(평균 판수 보정). 복귀 자석은 정렬되는 위치로 배치 — 해제 드롭 지점은
		// 항상 칠판 밖(하단 휴식 바)이라 쓸 수 없다.
		void useSessionStore.getState().setResting(playerId, false);
		set((s) => {
			const m = s.magnets.get(playerId);
			if (!m) return;
			m.teamId = null;
			placeArranged(s, playerId);
		});
	},
});
