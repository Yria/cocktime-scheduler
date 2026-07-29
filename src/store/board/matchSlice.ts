import type { StateCreator } from "zustand";
import type { SessionPlayer } from "../../types";
import type { StagePoint } from "../../types/board";
import { DEFAULT_VIEWPORT } from "../../lib/board/geometry";
import { MAGNET_SIZE } from "../../lib/board/constants";
import { canonicalizeDrafts, reconcileMembership } from "../../lib/board/remoteDrafts";
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
import { useSessionStore } from "../sessionStore";
import { useAppStore } from "../appStore";
import { toast } from "../toastStore";
import type { BoardState } from "./types";
import { claimEdit, pushDraftsToRemote, serializeBoardDrafts, syncState } from "./draftsSync";

/** 경기 슬라이스 — 원격 멤버십 적용/자가치유·경기 시작/완료/로스터 수정. */
export type MatchSlice = Pick<
	BoardState,
	"applyRemoteDrafts" | "healPlayingAnchors" | "startMatch" | "completeMatch" | "setMatchRoster"
>;

export const createMatchSlice: StateCreator<
	BoardState,
	[["zustand/devtools", never], ["zustand/immer", never]],
	[],
	MatchSlice
> = (set, get) => ({
	applyRemoteDrafts: (payload) => {
		// 멤버십이 실제로 안 바뀐 재수신/스냅샷(applyDraftsIfNewer는 동일 멤버십도 매번 새 객체 set)이면
		// 자석 위치를 전혀 만지지 않는다 — 자유 자석 위치는 로컬 전용이므로 보존되어야 한다.
		if (canonicalizeDrafts(payload) === canonicalizeDrafts(serializeBoardDrafts(get()))) return;
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
				// 잔여 겹침 정리 — 새로 들어온 자석만 대상(기존 사용자 배치 자석은 보존), 화면 경계로만
				settleFreeMagnets(s.magnets, s.drafts, vw, vh, settleExclude, 0);
			});
			// 방금 적용한 멤버십을 기준선으로 — 이후 위치만 바뀌면 재브로드캐스트 안 함
			syncState.lastSyncedDraftsJson = JSON.stringify(serializeBoardDrafts(get()));
		} finally {
			syncState.applyingRemoteDrafts = false;
		}
		// 편집자: reconcile이 불변식 위반(경기중 anchor·중복)을 정제해 로컬이 수신 payload와 달라졌다면
		// 그 정제 결과를 서버로 영속화한다 — 동시편집 레이스로 유실된 dissolve가 서버 board_drafts에 남아 있어도
		// (화면은 위에서 이미 정제됨) 서버까지 수렴시켜 새로고침/재구독 시 "유령 팀" 부활을 막는다. 뷰어는 화면만 정제.
		const ss = useSessionStore.getState();
		if (ss.isEditor) {
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
		const playingIds = playingIdsFromCourts(useSessionStore.getState().courts);
		if (playingIds.size === 0) return;
		set((s) => {
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
				// 제거 후 인원이 부족하면 팀 해체 — 렌더 게이팅(TeamBackground)과 동일한 공용 규칙으로 판정.
				if (wouldDissolveByPlaying(team, s.reservations, playingIds)) {
					dissolveDraft(s, teamId);
				} else {
					clearConfirmIfBelowFull(s, teamId); // 살아남았지만 4명 미만이면 매칭확정 해제
				}
			}
		});
	},

	startMatch: async (teamId) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		const { drafts, reservations, magnets, assigningTeamIds } = get();
		if (assigningTeamIds.has(teamId)) return;

		const session = useSessionStore.getState();
		const playingIds = playingIdsFromCourts(session.courts);
		if (!isTeamStartable(teamId, drafts, reservations, magnets, playingIds)) {
			toast("아직 경기를 시작할 수 없어요", { variant: "error" });
			return;
		}
		const empty = session.courts.find((c) => !c.match);
		if (!empty) {
			toast("빈 코트가 없어요", { variant: "error" });
			return;
		}
		const members = teamMembers(teamId, drafts, reservations);
		const four = members
			.map((m) => session.sessionPlayers.get(m.playerId))
			.filter((p): p is SessionPlayer => Boolean(p));
		if (four.length !== 4) return;

		// 경기시작 시 새 코트 카드가 좌상단 기본 위치로 튀지 않도록, 만들어진 그룹의 자리를 그대로 물려준다.
		const ta = drafts.get(teamId)?.anchor;
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
			await session.handleAssign(gen, empty.id);
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
			set((s) => {
				s.assigningTeamIds.delete(teamId);
			});
		}
	},

	completeMatch: async (courtId) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		// 완료 처리 전에 끝난 4명 id를 확보(이후 court.match는 null이 됨)
		const court = useSessionStore.getState().courts.find((c) => c.id === courtId);
		const endedIds = matchPlayerIdsFromCourt(court);
		await useSessionStore.getState().handleComplete(courtId);
		// 경기 끝나 자유가 된 선수가 다른 팀에 예약(ghost)으로 잡혀 있었으면 → 그 팀의 정식 멤버(anchor)로 승격.
		// (예: 경기중인 4번을 abc 팀에 끌어 abc4 예약·고정 → 4번 경기 끝나면 abc4가 4명 정식 팀이 되어 매칭확정 가능.)
		set((s) => resolveFreedReservations(s, endedIds));
		// 완료 후 '정렬' 버튼과 동일하게 보드 전체 재정렬(끝난 선수만 흩뜨리지 않고 자유 풀 전체를 그리드로 정돈).
		// store.stageW/stageH 는 이미 view 좌표(setStageSize(viewW,viewH))라 rearrangeAll 인자로 그대로 쓴다.
		// markManual=false: 1회 정렬만 하고 수동 모드로 고정하지 않는다(뷰어는 courtSig 변화로 자동 정렬도 병행).
		get().rearrangeAll(get().stageW, get().stageH);
	},

	setMatchRoster: async (courtId, teamA, teamB) => {
		if (!claimEdit()) return; // 보기 전용 차단(자유면 자동 점유)
		const court = useSessionStore.getState().courts.find((c) => c.id === courtId);
		const oldIds = matchPlayerIdsFromCourt(court);
		const newIds = matchPlayerIds({ teamA, teamB });
		const removed = oldIds.filter((id) => !newIds.includes(id));
		await useSessionStore.getState().handleSetMatchRoster(courtId, teamA, teamB);
		// 빠진 선수가 다른 팀 예약(ghost)이었으면 그 팀 정식 멤버로 승격(completeMatch와 동일 처리), 그 외엔 흩어뜨림.
		if (removed.length > 0) {
			set((s) => resolveFreedReservations(s, removed));
			get().scatterMagnets(removed);
		}
	},
});
