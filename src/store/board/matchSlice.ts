import type { StateCreator } from "zustand";
import type { SessionPlayer } from "../../types";
import type { BoardDraftsPayload, StagePoint } from "../../types/board";
import { DEFAULT_VIEWPORT } from "../../lib/board/geometry";
import { MAGNET_SIZE, TEAM_BOX_BELOW } from "../../lib/board/constants";
import { canonicalizeDrafts, reconcileMembership } from "../../lib/board/remoteDrafts";
import { applyBoardLayout, readBoardLayout, serializeBoardLayout } from "../../lib/board/savedLayout";
import { scatterFromSource } from "../../lib/board/scatter";
import { settleFreeMagnets } from "../../lib/board/settle";
import {
	isTeamStartable,
	matchPlayerIds,
	matchPlayerIdsFromCourt,
	playingIdsFromCourts,
	teamMembers,
	wouldDissolveByPlaying,
} from "../../lib/board/membership";
import {
	clearConfirmIfBelowFull,
	dissolveDraft,
	dissolveDraftAfterAssign,
	resolveFreedReservations,
} from "../../lib/board/draftMutations";
import { pairPlayers } from "../../lib/teamSelection";
import { acquireAdminCoverage, releaseAdminCoverage } from "../../lib/board/adminCoverageGate";
import { useSessionStore } from "../sessionStore";
import { useAppStore } from "../appStore";
import { useAuthStore } from "../authStore";
import { applyMemberCompletion } from "../sessionStore";
import { toast } from "../toastStore";
import { memberCompleteMatch as rpcMemberCompleteMatch } from "../../lib/supabase/matchResults";
import { isViewerInMatch } from "../../lib/board/pixi/projection";
import { commitMemberArrangement } from "./memberCompletion";
import { rosterSaveKey } from "../../lib/board/matchRosterEdit";
import type { BoardState } from "./types";
import { claimEdit, pushDraftsToRemote, refineLocally, serializeBoardDrafts, setDraftsBase, syncState } from "./draftsSync";

/**
 * 서버 payload 를 이 기기에 적용했을 때의 로컬 투영(부수효과 없음) — 동시 편집 rebase 의 머지 기준.
 * reconcileMembership(자석 보유·I1/I2/I3 정제)을 자석 사본에 돌려 serialize 한다. 좌표는 payload 원본을 쓴다
 * (적용하면 applyBoardLayout 이 그 좌표를 그대로 복원한다).
 */
export function projectRemoteDrafts(state: BoardState, payload: BoardDraftsPayload): BoardDraftsPayload {
	const magnets = new Map([...state.magnets].map(([id, m]) => [id, { ...m }]));
	const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
	const vw = state.stageW || DEFAULT_VIEWPORT.vw;
	const vh = state.stageH || DEFAULT_VIEWPORT.vh;
	const { drafts, reservations } = reconcileMembership(payload, magnets, new Map(), vw, vh, playingIds);
	const projected = serializeBoardDrafts({ drafts, reservations, magnets, courtAnchors: state.courtAnchors, manualLayout: false });
	const layout = readBoardLayout(payload.layout);
	return layout ? { ...projected, layout } : projected;
}

/** 경기 슬라이스 — 원격 멤버십 적용/자가치유·경기 시작/완료/로스터 수정. */
export type MatchSlice = Pick<
	BoardState,
	| "applyRemoteDrafts" | "healPlayingAnchors" | "startMatch" | "completeMatch" | "setMatchRoster" | "dismissTeam"
	| "completeRequest" | "requestCompleteMatch" | "closeCompleteRequest" | "completeMatchAsMember"
>;

// 회원 완료 RPC 왕복 중인 matchId — 창 두 번 열기·연타가 member_complete_match 를 두 번 쏘지 않게(assigningTeamIds 와 별개로
// 세션 전환·cancelEditActions 로 지워지지 않는 모듈 가드).
const memberCompleting = new Set<string>();

export const createMatchSlice: StateCreator<
	BoardState,
	[["zustand/devtools", never], ["zustand/immer", never]],
	[],
	MatchSlice
> = (set, get) => ({
	dismissTeam: (teamId) => {
		if (!claimEdit() || get().assigningTeamIds.has(teamId)) return;
		const ids = [...(get().drafts.get(teamId)?.anchorMemberIds ?? [])];
		set((state) => dissolveDraft(state, teamId));
		get().scatterMagnets(ids);
	},
	applyRemoteDrafts: (payload, version, base) => {
		// 동시 편집 머지 기준 — '서버 버전 version 을 이 기기에 적용한 직후의 로컬 투영'. 적용이 끝난 뒤(또는
		// 이미 같아 건너뛸 때) 한 곳에서 기록한다. rebase 는 머지 결과를 그리되 기준은 theirs(base)로 둔다.
		const recordBase = () => {
			const sessionId = useAppStore.getState().sessionMeta?.sessionId;
			if (!sessionId) return;
			if (base) setDraftsBase(sessionId, version, base.projection, base.raw);
			else setDraftsBase(sessionId, version, serializeBoardDrafts(get()), payload);
		};
		const layout = readBoardLayout(payload.layout);
		// 명단이 같아도 위치만 바뀐 서버 스냅샷은 적용한다. 좌표가 없는 구버전은 로컬 위치를 유지한다.
		if (canonicalizeDrafts(payload) === canonicalizeDrafts(serializeBoardDrafts(get()))
			&& (!layout || JSON.stringify(layout) === JSON.stringify(serializeBoardLayout(get())))) { recordBase(); return; }
		// 불변식 I2(경기중 anchor 제거)·I1(중복 제거) 강제를 위해 reconcile에 넘긴다.
		const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
		syncState.applyingRemoteDrafts = true;
		try {
			set((s) => {
				// 같은 id 팀은 기존 위치(anchor) 유지, 새 팀은 멤버 중심으로 배치(위치는 로컬)
				const oldAnchors = new Map<string, StagePoint>();
				for (const [id, t] of s.drafts) oldAnchors.set(id, { x: t.anchor.x, y: t.anchor.y });

				// 적용 전 "이미 필드에 있던" 자유 자석 — 원격 변경으로 새로 들어온 자석 판별용
				const prevFreeIds = new Set<string>();
				for (const [, m] of s.magnets) if (m.teamId === null) prevFreeIds.add(m.playerId);

				const vw = s.stageW || DEFAULT_VIEWPORT.vw;
				const vh = s.stageH || DEFAULT_VIEWPORT.vh;

				// 멤버십(drafts/reservations) 재구성 + 자석 teamId 재설정(위치는 아래에서 별도 처리)
				const { drafts, reservations } = reconcileMembership(payload, s.magnets, oldAnchors, vw, vh, playingIds);
				s.drafts = drafts;
				s.reservations = reservations;
				if (layout) {
					applyBoardLayout(s, layout);
					return; // 서버에서 확정된 좌표를 로컬 settle로 다시 옮기지 않는다.
				}

				// 원격 변경으로 "새로 필드에 들어온" 자석(팀/예약 → 자유): 내가 드래그하지 않았어도
				// 드롭과 동일하게 흩어짐을 적용 — 각 자석을 소스로 BFS 방사형으로 주변을 밀어낸다.
				const r = MAGNET_SIZE / 2;
				// 흩어짐/정리에서 "사용자가 직접 배치한(원래 필드에 있던) 자유 자석"은 제외해 위치를 보존한다.
				// 이게 빠지면 원격 멤버십 동기화가 내가 방금 드롭한 자석을 밀어내 "가끔 원래자리로" 되돌아오는 버그가 난다.
				// scatter 소스 제외(아래 continue)뿐 아니라 "밀리는 대상"·settle 대상에서도 빼야 하므로 excludeIds에 합친다.
				const settleExclude = new Set<string>([...playingIds, ...prevFreeIds]);
				for (const [, m] of s.magnets) {
					if (m.teamId !== null || playingIds.has(m.playerId)) continue;
					if (prevFreeIds.has(m.playerId)) continue; // 원래 필드에 있던 자석은 흩어짐 대상 아님
					// 들어온 자석을 화면 안으로만 클램프(레인 제한 없음) 후 그 자리를 소스로 흩어짐
					m.x = Math.max(r + 4, Math.min(vw - r - 4, m.x));
					m.y = Math.max(r + 4, Math.min(vh - r - 4, m.y));
					scatterFromSource(
						{ kind: "magnet", id: m.playerId, x: m.x, y: m.y },
						s.magnets,
						s.drafts,
						vw,
						vh,
						settleExclude,
						0,
					);
				}
				// 잔여 겹침 정리 — 움직이는 대상은 새로 들어온 자석만(기존 사용자 배치 자석은 보존)이지만,
				// 기존 자석은 fixedIds 로 넘겨 **충돌 대상으로는 반드시 고려**한다. 안 넘기면 새로 들어온
				// 자석이 기존 자석 위에 완전히 겹쳐 남아 가려진다(팀 해체로 keep-out 이 사라진 경우).
				// 단 경기중 자석은 제외한다 — 코트 카드로만 그려지고 x/y 는 옛 팀 슬롯에 남은 스테일 값이라
				// (dissolveDraftAfterAssign) 그대로 넘기면 화면에 없는 유령 좌표가 장애물로 작동한다.
				const fixedIds = new Set<string>();
				for (const id of prevFreeIds) if (!playingIds.has(id)) fixedIds.add(id);
				// 코트 레인 하단을 topMargin 으로 준다 — settle 은 코트 카드를 장애물로 모르는데(drafts 만 봄)
				// 0 을 주면 겹침을 피해 재배치된 자석이 **불투명 코트 카드 밑으로** 올라가 가려진다.
				// (자유 자석은 코트 카드보다 먼저 그려진다 — SessionBoard 렌더 순서.)
				let courtBottom = 0;
				for (const a of s.courtAnchors.values()) {
					courtBottom = Math.max(courtBottom, a.y + TEAM_BOX_BELOW);
				}
				settleFreeMagnets(s.magnets, s.drafts, vw, vh, settleExclude, courtBottom, fixedIds);
			});
			// 방금 복원한 명단·배치를 기준선으로 삼아 echo 저장을 막는다.
			syncState.lastSyncedDraftsJson = JSON.stringify(serializeBoardDrafts(get()));
		} finally {
			syncState.applyingRemoteDrafts = false;
		}
		recordBase();
		// 편집자: reconcile이 불변식 위반(경기중 anchor·중복)을 정제해 로컬이 수신 payload와 달라졌다면
		// 그 정제 결과를 서버로 영속화한다 — 동시편집 레이스로 유실된 dissolve가 서버 board_drafts에 남아 있어도
		// (화면은 위에서 이미 정제됨) 서버까지 수렴시켜 새로고침/재구독 시 "유령 팀" 부활을 막는다. 뷰어는 화면만 정제.
		// 동시 편집에서는 정제가 이 기기의 자석·코트 지식에 기대므로 저장하지 않는다(화면만 정제).
		const ss = useSessionStore.getState();
		if (ss.isEditor && !ss.multiEditor) {
			const healed = serializeBoardDrafts(get());
			if (canonicalizeDrafts(healed) !== canonicalizeDrafts(payload)) {
				pushDraftsToRemote(healed);
			}
		}
	},

	healPlayingAnchors: () => {
		// 코트 변화 시 경기중이 된 anchor를 로컬 drafts에서 즉시 제거해 화면을 정제한다(편집자·뷰어 모두).
		// 뷰어에게도 실행해야, 편집자의 '매칭 확정' 직후 match_started(코트) broadcast는 도착했지만 board_drafts
		// 해체(dissolve)가 아직 안 온 창에서 '코트+유령 팀'이 동시에 보이는 것을 막는다(그 창을 1프레임으로 축소).
		// 영속화(pushDraftsToRemote)는 편집자만(draftsSync의 !isEditor no-op) → 뷰어 실행은 순수 로컬·CAS 무관.
		// 동시 편집에서는 화면만 정제한다(refineLocally — 늦게 받은 코트 상태로 남의 배치를 지우지 않게).
		const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
		if (playingIds.size === 0) return;
		refineLocally(() => set((s) => {
			for (const [teamId, team] of [...s.drafts]) {
				if (s.assigningTeamIds.has(teamId)) continue; // 경기시작 진행중 팀은 startMatch가 직접 처리
				if (!team.anchorMemberIds.some((id) => playingIds.has(id))) continue; // 변경 없음 → 건드리지 않음(멱등)
				// 경기중이 된 anchor를 팀에서 제거(자석 teamId 해제). ghost(예약)는 유지.
				for (const id of team.anchorMemberIds) {
					if (!playingIds.has(id)) continue;
					const m = s.magnets.get(id);
					if (m && m.teamId === teamId) m.teamId = null;
					if (team.slots && id in team.slots) delete team.slots[id]; // 슬롯 매핑도 정리
				}
				team.anchorMemberIds = team.anchorMemberIds.filter((id) => !playingIds.has(id));
				// 제거 후 인원이 부족하면 팀 해체 — 보드 projection의 렌더 게이팅과 동일한 공용 규칙으로 판정.
				if (wouldDissolveByPlaying(team, s.reservations, playingIds)) {
					dissolveDraft(s, teamId);
				} else {
					clearConfirmIfBelowFull(s, teamId); // 살아남았지만 4명 미만이면 매칭확정 해제
				}
			}
		}));
	},

	startMatch: async (teamId, approvedAdminRoster) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		const { drafts, reservations, magnets, assigningTeamIds } = get();
		if (assigningTeamIds.has(teamId)) return;

		const session = useSessionStore.getState();
		const playingIds = playingIdsFromCourts(session.courts);
		if (!isTeamStartable(teamId, drafts, reservations, magnets, playingIds)) {
			toast("아직 경기를 시작할 수 없어요", { variant: "error" });
			return;
		}
		const linkedCourtId = drafts.get(teamId)?.courtId;
		const empty = session.courts.find(c => !c.match && (linkedCourtId != null ? c.id === linkedCourtId
			: ![...drafts.values()].some(team => team.courtId === c.id && teamMembers(team.id, drafts, reservations).length > 0)));
		if (!empty) {
			toast("빈 코트가 없어요", { variant: "error" });
			return;
		}
		const members = teamMembers(teamId, drafts, reservations);
		const four = members
			.map((m) => session.sessionPlayers.get(m.playerId))
			.filter((p): p is SessionPlayer => Boolean(p));
		if (four.length !== 4) return;
		const ids = four.map(p => p.id);
		const coverageKey = `team:${teamId}`;
		if (!acquireAdminCoverage(coverageKey, ids, async () => {
			if (useSessionStore.getState().isEditor) await get().startMatch(teamId, ids);
		}, approvedAdminRoster)) return;
		const allowAdminAbsence = approvedAdminRoster?.length === ids.length && ids.every(id => approvedAdminRoster.includes(id));

		// 경기시작 시 새 코트 카드가 좌상단 기본 위치로 튀지 않도록, 만들어진 그룹의 자리를 그대로 물려준다.
		const ta = [...drafts.values()].find(team => team.courtId === empty.id)?.anchor ?? drafts.get(teamId)?.anchor;
		const teamAnchor = ta ? { x: ta.x, y: ta.y } : null;

		const singleWomanIds = useAppStore.getState().sessionMeta?.singleWomanIds ?? [];
		const gen = pairPlayers(
			four as [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer],
			singleWomanIds,
			"보드 수동 편성",
		);

		set((s) => {
			s.assigningTeamIds.add(teamId);
		});
		try {
			await session.handleAssign(gen, empty.id, allowAdminAbsence);
			// 성공 판정: 해당 코트의 match가 "우리 4명"으로 채워졌는지 확인(낙관적 dissolve 금지 + race 오판 방지)
			const court = useSessionStore.getState().courts.find((c) => c.id === empty.id);
			const ourIds = new Set(members.map((m) => m.playerId));
			const placedIds = court?.match ? [...court.match.teamA, ...court.match.teamB] : [];
			const ok = placedIds.length === 4 && placedIds.every((id) => ourIds.has(id));
			if (ok) {
				set((s) => {
					dissolveDraftAfterAssign(s, teamId);
					// 코트 카드를 방금 그 그룹이 있던 자리에 그대로 표시(좌상단 점프 X)
					if (teamAnchor) s.courtAnchors.set(empty.id, teamAnchor);
				});
			} else {
				toast("코트 배치에 실패했어요. 다시 시도하세요", { variant: "error" });
			}
		} finally {
			releaseAdminCoverage(coverageKey);
			set((s) => {
				s.assigningTeamIds.delete(teamId);
			});
		}
	},

	completeMatch: async (courtId) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		const sessionId = get().sessionId;
		if (get().matchEdits.has(courtId) || get().assigningTeamIds.has(rosterSaveKey(courtId))) return;
		const court = useSessionStore.getState().courts.find((c) => c.id === courtId);
		const endedIds = matchPlayerIdsFromCourt(court);
		const endedMatchId = court?.match?.id;
		const groupId = [...get().drafts.values()].find(team => team.courtId === courtId)?.id ?? `complete:${courtId}`;
		if (!endedMatchId || get().assigningTeamIds.has(groupId)) return;
		set(s => { s.assigningTeamIds.add(groupId); });
		try {
			await useSessionStore.getState().handleComplete(courtId);
			if (get().sessionId !== sessionId) return;
			if (useSessionStore.getState().courts.find(c => c.id === courtId)?.match) return;
			set(s => {
				resolveFreedReservations(s, endedIds);
				s.assigningTeamIds.delete(groupId);
			});
			get().fillWaitingTeams();
			get().scatterMagnets(endedIds);
		} finally {
			if (get().sessionId === sessionId) set(s => { s.assigningTeamIds.delete(groupId); });
		}
	},

	completeRequest: null,

	requestCompleteMatch: (courtId) => {
		if (get().completeRequest) return; // 이미 창이 열려 있다(연타)
		const ss = useSessionStore.getState();
		const court = ss.courts.find((c) => c.id === courtId);
		const match = court?.match;
		if (!match) return;
		const groupId = [...get().drafts.values()].find(team => team.courtId === courtId)?.id ?? `complete:${courtId}`;
		if (get().matchEdits.has(courtId) || get().assigningTeamIds.has(rosterSaveKey(courtId)) || get().assigningTeamIds.has(groupId)
			|| memberCompleting.has(match.id)) return;
		// 편집자면 기존 경로. 편집자가 아닌 운영진도 자기 코트면 회원 경로(편집락을 뺏지 않는다).
		// 편집자인데 지금 막혀 있으면(exclusiveDraftEdit — 제안 적용 대기 등) 회원 경로로 새지 않는다: 그 기기의
		// 저장 구독이 회원 편성 후보를 board_save_drafts 로 밀어 넣을 수 있다. 막힘이 풀리면 편집자 경로로 누른다.
		const mode = claimEdit() ? "editor"
			: !ss.isEditor && isViewerInMatch(match, ss.sessionPlayers, useAuthStore.getState().memberId) ? "member" : null;
		if (!mode) return;
		set(s => { s.completeRequest = { courtId, matchId: match.id, mode }; });
	},

	closeCompleteRequest: () => set(s => { s.completeRequest = null; }),

	completeMatchAsMember: async (courtId, matchId, winner, teamA = null) => {
		const sessionId = useAppStore.getState().sessionMeta?.sessionId;
		const boardSessionId = get().sessionId;
		if (!sessionId) return { status: "error" };
		if (memberCompleting.has(matchId)) return { status: "busy" };
		const court = useSessionStore.getState().courts.find((c) => c.id === courtId);
		const match = court?.match;
		// 이 기기에서 이미 코트가 비었거나 다른 경기로 바뀌었다 = 누가 먼저 끝냈다.
		if (!match || match.id !== matchId) return { status: "already_completed" };
		const endedIds = matchPlayerIdsFromCourt(court);
		const groupId = [...get().drafts.values()].find(team => team.courtId === courtId)?.id ?? `complete:${courtId}`;
		memberCompleting.add(matchId);
		// 코트 카드 '완료 중…'(projection busy) — 편집자 completeMatch 와 같은 키.
		set(s => { s.assigningTeamIds.add(groupId); });
		try {
			const res = await rpcMemberCompleteMatch(matchId, sessionId, winner, teamA);
			if (!res.ok) {
				// 이미 완료 — 이 기기 코트가 아직 경기중으로 보이면 서버 상태로 수렴.
				if (res.reason === "already_completed") void useSessionStore.getState().resyncFromServer();
				return { status: res.reason, message: res.message };
			}
			if (get().sessionId !== boardSessionId || useAppStore.getState().sessionMeta?.sessionId !== sessionId) {
				return { status: "completed", result: res.result, arrange: "skipped" };
			}
			// 운영진 완료와 똑같이 match_completed 로컬 적용 + 브로드캐스트.
			applyMemberCompletion(match, courtId, res.updatedPlayers);
			// 편성 계획 전에 busy 키를 푼다 — autoFillEmptyCourts 는 assigningTeamIds 에 든 그룹을 건너뛴다.
			set(s => { s.assigningTeamIds.delete(groupId); });
			// 완료·결과는 이미 서버에 확정됐다. 편성 단계가 어떻게 실패해도 '완료됨'으로 돌려준다(편성은 운영진이 이어 한다).
			const arrange = await commitMemberArrangement(get, (fn) => set(fn), sessionId, matchId, courtId, endedIds)
				.catch((error: unknown) => {
					console.error("member arrangement failed:", error);
					void useSessionStore.getState().resyncFromServer({ force: true });
					return "error" as const;
				});
			return { status: "completed", result: res.result, arrange };
		} finally {
			memberCompleting.delete(matchId);
			if (get().sessionId === boardSessionId) set(s => { s.assigningTeamIds.delete(groupId); });
		}
	},

	setMatchRoster: async (courtId, teamA, teamB) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		const court = useSessionStore.getState().courts.find((c) => c.id === courtId);
		const oldIds = matchPlayerIdsFromCourt(court);
		const newIds = matchPlayerIds({ teamA, teamB });
		const removed = oldIds.filter((id) => !newIds.includes(id));
		await useSessionStore.getState().handleSetMatchRoster(courtId, teamA, teamB);
		const savedIds = matchPlayerIdsFromCourt(useSessionStore.getState().courts.find(c => c.id === courtId));
		if (savedIds.length !== newIds.length || savedIds.some(id => !newIds.includes(id))) return;
		// 빠진 선수가 다른 팀 예약(ghost)이었으면 그 팀 정식 멤버로 승격(completeMatch와 동일 처리), 그 외엔 흩어뜨림.
		if (removed.length > 0) {
			set((s) => resolveFreedReservations(s, removed));
			get().scatterMagnets(removed);
		}
	},
});
