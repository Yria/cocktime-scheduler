import type { BoardState } from "../../../store/board/types";
import type { useSessionStore } from "../../../store/sessionStore";
import type { StagePoint } from "../../../types/board";
import { coverageQueue, leavesNoAdmin } from "../adminCoverage";
import { visibleMatchProposals, type ProposalComposerSnapshot } from "../matchProposals";
import { currentMatchEdit, rosterSaveKey } from "../matchRosterEdit";
import {
	CTA_DISABLED_COLOR, CTA_FINISH_COLOR, CTA_PLAY_COLOR, CTA_START_COLOR,
	COURT_READY_BG, COURT_READY_STROKE,
	TEAM_BOX_ABOVE,
	TEAM_FORMING_BG, TEAM_FORMING_STROKE, TEAM_PLAYING_BG, TEAM_PLAYING_STROKE,
	TEAM_READY_BG, TEAM_READY_STROKE, TEAM_RESERVED_BG, TEAM_RESERVED_STROKE,
	TEAM_W, TEXT_SECONDARY, PROPOSAL_BG, PROPOSAL_STROKE, PROPOSAL_CTA,
	WAITING_SLOT_STROKE,
} from "../constants";
import { computeSlotOffset, emptySlotIndices } from "../geometry";
import {
	findReservation, isTeamStartable, matchPlayerIds,
	playingIdsFromCourts, teamMembers, wouldDissolveByPlaying,
} from "../membership";
import { sourceKey, type BoardEntity, type BoardSnapshot, type BoardSource, type CardAppearance, type CardView, type MagnetView } from "./types";

type SessionSnapshot = ReturnType<typeof useSessionStore.getState>;
interface CoverageSnapshot { memberIds: ReadonlySet<string>; loaded: boolean; starting: ReadonlyMap<string, readonly string[]> }

function sameArray<T>(a: readonly T[], b: readonly T[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

function samePoint(a: StagePoint, b: StagePoint): boolean {
	return a.x === b.x && a.y === b.y;
}

function sameAppearance(a: CardAppearance, b: CardAppearance): boolean {
	return a.dashed === b.dashed && (Object.keys(a) as (keyof CardAppearance)[]).every((key) => a[key] === b[key]);
}

/**
 * 기존 보드의 표시 규칙만 투영한다. store/네트워크를 읽거나 정합 명령을 실행하지 않는다.
 * 캐시는 이 보드 인스턴스에만 속하고, 사라진 엔티티는 다음 snapshot에서 바로 해제된다.
 */
export function createBoardProjection(): (bs: BoardState, ss: SessionSnapshot, proposals?: ProposalComposerSnapshot, coverage?: CoverageSnapshot) => BoardSnapshot {
	let previous: BoardSnapshot = { entities: [], isEditor: false };
	let previousInputs: readonly unknown[] = [];
	let cache = new Map<string, BoardEntity>();

	return (bs, ss, proposals, coverage) => {
		const draggedPlayerId = bs.dragInfo?.playerId ?? null;
		const inputs = [bs.magnets, bs.drafts, bs.reservations, bs.courtAnchors, bs.matchEdits, draggedPlayerId,
			ss.sessionPlayers, ss.courts, ss.restingIds, ss.cockCheckEnabled, ss.isEditor, bs.assigningTeamIds,
			proposals?.enabled, proposals?.groups, proposals?.sendingIds, proposals?.proposals,
			proposals?.anchors, proposals?.resolvingIds, proposals?.viewerId, proposals?.isAdmin, coverage?.memberIds, coverage?.loaded, coverage?.starting];
		if (sameArray(previousInputs, inputs)) return previous;
		previousInputs = inputs;

		const nextCache = new Map<string, BoardEntity>();
		const entities: BoardEntity[] = [];
		const playingIds = playingIdsFromCourts(ss.courts);
		const composing = proposals?.enabled === true && !ss.isEditor;
		const groups = composing ? proposals.groups : [];
		const visibleProposals = visibleMatchProposals(proposals);
		const selected = new Set([...groups.flatMap((group) => group.playerIds), ...visibleProposals.flatMap((proposal) => proposal.player_ids)]);
		const restingIds = new Set(ss.restingIds);
		const edits = new Map(ss.isEditor ? [...(bs.matchEdits ?? [])].filter(([id, edit]) => currentMatchEdit(edit, ss.courts.find(c => c.id === id))) : []);
		const editingPlayers = new Set([...edits.values()].flatMap(edit => edit.roster));
		const hasEmptyCourt = ss.courts.some((court) => !court.match);
		const coverageInput = { ...bs, ...ss, adminMemberIds: coverage?.memberIds ?? new Set<string>(),
			startingIds: new Set([...(coverage?.starting.values() ?? [])].flat()), proposals: visibleProposals };
		const queue = coverage?.loaded ? coverageQueue(coverageInput) : [];
		const nextTeam = queue.find(team => !leavesNoAdmin(team.ids, coverageInput));

		const magnet = (source: BoardSource & { playerId: string }, point: StagePoint, resting = false): MagnetView | null => {
			const player = ss.sessionPlayers.get(source.playerId);
			const position = bs.magnets.get(source.playerId);
			if (!player || !position) return null;
			const ghost = source.kind === "ghost";
			const key = sourceKey(source);
			const next: MagnetView = {
				kind: "magnet", key, source, point, player, ghost, resting,
				cockPending: ss.cockCheckEnabled && !ghost && source.kind !== "playing" && !resting && !player.cockChecked,
				draggable: ss.isEditor || (composing
					? source.kind === "free" || source.kind === "proposal-member"
					: !ghost && position.teamId == null),
			};
			const old = cache.get(key);
			const value = old?.kind === "magnet" && old.player === player && samePoint(old.point, point)
				// 재예약은 reservation id를 유지하면서 부모 팀을 바꾼다.
				&& (source.kind !== "ghost" || (old.source.kind === "ghost" && old.source.teamId === source.teamId))
				&& old.ghost === ghost && old.resting === resting && old.cockPending === next.cockPending
				&& old.draggable === next.draggable ? old : next;
			nextCache.set(key, value);
			return value;
		};

		const card = (next: CardView) => {
			const old = cache.get(next.key);
			if (old?.kind === "card") {
				if (sameArray(old.members, next.members)) next.members = old.members;
				if (sameArray(old.emptySlots, next.emptySlots)) next.emptySlots = old.emptySlots;
				if (sameArray(old.waitingSlots ?? [], next.waitingSlots ?? [])) next.waitingSlots = old.waitingSlots;
				if (sameAppearance(old.appearance, next.appearance)) next.appearance = old.appearance;
				if (sourceKey(old.source) === sourceKey(next.source) && samePoint(old.point, next.point) && old.draggable === next.draggable && old.confirmed === next.confirmed
					&& old.members === next.members && old.emptySlots === next.emptySlots && old.waitingSlots === next.waitingSlots && old.appearance === next.appearance) {
					nextCache.set(next.key, old);
					entities.push(old);
					return;
				}
			}
			nextCache.set(next.key, next);
			entities.push(next);
		};

		const queued = [...bs.drafts.values()].filter(team => team.courtId == null)
			.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
		// Map 순서는 기존 화면의 기본 시각 순서다. 드롭 판정의 후보 순서를 바꾸지 않는다.
		for (const team of bs.drafts.values()) {
			if (team.courtId != null && ss.courts.some(court => court.id === team.courtId && court.match)) continue;
			if (wouldDissolveByPlaying(team, bs.reservations, playingIds)) continue;
			const membership = teamMembers(team.id, bs.drafts, bs.reservations);
			const count = membership.length;
			const full = count === 4;
			const waiting = team.waitForCompletion === true && team.courtId == null && count >= 2 && !full;
			const startable = isTeamStartable(team.id, bs.drafts, bs.reservations, bs.magnets, playingIds);
			const canStart = full && startable;
			const held = canStart && coverage?.loaded && leavesNoAdmin(membership.map(m => m.playerId), coverageInput);
			const next = coverage?.loaded && coverage.memberIds.size > 0 && nextTeam?.key === `team:${team.id}`;
			const editing = membership.some(member => editingPlayers.has(member.playerId));
			const busy = bs.assigningTeamIds?.has(team.id) === true || editing;
			const availableCourt = ss.courts.some(court => !court.match && (team.courtId != null ? court.id === team.courtId
				: ![...bs.drafts.values()].some(other => other.courtId === court.id && teamMembers(other.id, bs.drafts, bs.reservations).length > 0)));
			// 합류 대기팀은 경기 완료 때만 채운다 — 버튼은 상태 표시(비활성), 빈자리 탭은 추천 창을 연다.
			const ctaEnabled = ss.isEditor && !busy && !waiting && (!full || (canStart && availableCourt));
			const readyFill = team.courtId != null ? COURT_READY_BG : TEAM_READY_BG;
			const readyStroke = team.courtId != null ? COURT_READY_STROKE : TEAM_READY_STROKE;
			const labelColor = startable ? readyStroke
				: full ? TEAM_RESERVED_STROKE : waiting ? WAITING_SLOT_STROKE : TEXT_SECONDARY;
			const baseLabel = team.courtId != null
				? `${team.courtId}번 코트 · ${!full ? `편성 중 ${count}/4` : held ? "교대 대기" : canStart ? "시작 대기" : "예약 대기"}`
					: `다음 팀 ${queued.indexOf(team) + 1} · ${!full ? waiting ? `합류 대기 ${count}/4` : `${count}/4` : held ? "교대 대기" : canStart ? "배정 대기" : "예약 대기"}`;
			const members: MagnetView[] = [];
			for (const member of membership) {
				if (editingPlayers.has(member.playerId)) continue;
				let source: BoardSource & { playerId: string };
				if (member.kind === "ghost") {
					const reservation = findReservation(member.playerId, team.id, bs.reservations);
					if (!reservation) continue;
					source = { kind: "ghost", playerId: member.playerId, teamId: team.id, reservationId: reservation.id };
				} else {
					source = { kind: "anchor", playerId: member.playerId, teamId: team.id };
				}
				const view = magnet(source, computeSlotOffset(member.slot));
				if (view) members.push(view);
			}
			const source: CardView["source"] = { kind: "team", teamId: team.id };
			card({
				kind: "card", key: sourceKey(source), source, point: team.anchor, draggable: !busy, members, confirmed: false,
				emptySlots: emptySlotIndices(new Set(membership.filter((member) => member.playerId !== draggedPlayerId).map((member) => member.slot))),
				waitingSlots: waiting ? emptySlotIndices(new Set(membership.map(member => member.slot))) : undefined,
				appearance: {
					fill: startable ? readyFill : full ? TEAM_RESERVED_BG : TEAM_FORMING_BG,
					stroke: startable ? readyStroke : full ? TEAM_RESERVED_STROKE : TEAM_FORMING_STROKE,
					label: team.createdBy && team.courtId == null && !waiting ? `${baseLabel} · by ${team.createdBy}` : baseLabel,
					labelColor, labelBold: full, showVs: full,
					ctaLabel: editing ? "선수 변경 중" : busy ? "시작 중…" : canStart ? availableCourt ? held ? "교대 확인" : "경기시작" : "코트 대기" : full ? "예약 대기" : waiting ? "완료 후 채움" : "자동매칭",
					ctaColor: !ctaEnabled ? CTA_DISABLED_COLOR : canStart ? CTA_PLAY_COLOR : CTA_START_COLOR,
					ctaEnabled, showUnconfirm: ss.isEditor && count > 0 && !busy, blink: !!next && hasEmptyCourt,
				},
			});
		}

		for (const position of bs.magnets.values()) {
			if (position.teamId !== null || playingIds.has(position.playerId) || selected.has(position.playerId) || editingPlayers.has(position.playerId)) continue;
			const view = magnet({ kind: "free", playerId: position.playerId }, { x: position.x, y: position.y }, restingIds.has(position.playerId));
			if (view) entities.push(view);
		}

		let occupiedIndex = 0;
		for (const court of ss.courts) {
			const match = court.match;
			if (!match) continue;
			const linked = [...bs.drafts.values()].find(team => team.courtId === court.id);
			const edit = edits.get(court.id);
			const saving = bs.assigningTeamIds?.has(rosterSaveKey(court.id)) === true;
			const busy = saving || bs.assigningTeamIds?.has(linked?.id ?? `complete:${court.id}`) === true;
			const point = linked?.anchor ?? bs.courtAnchors.get(court.id) ?? { x: TEAM_W / 2 + 12 + occupiedIndex * (TEAM_W + 20), y: TEAM_BOX_ABOVE + 8 };
			occupiedIndex++;
			const members: MagnetView[] = [];
			(edit?.roster ?? matchPlayerIds(match)).forEach((playerId, index) => {
				const view = magnet({ kind: edit ? "roster" : "playing", playerId, courtId: court.id, matchId: match.id }, computeSlotOffset(index));
				if (view) members.push(busy ? { ...view, draggable: false } : view);
			});
			const source: CardView["source"] = { kind: "court", courtId: court.id, matchId: match.id };
			card({
				kind: "card", key: linked ? `team:${linked.id}` : sourceKey(source), source, point, draggable: ss.isEditor && !busy, members, emptySlots: [], confirmed: false,
				appearance: {
					fill: TEAM_PLAYING_BG, stroke: TEAM_PLAYING_STROKE,
					label: `${court.id}번 코트 · ${edit ? "선수 변경 중" : "경기중"}`, labelColor: TEAM_PLAYING_STROKE, labelBold: true, showVs: true,
					ctaLabel: saving ? "변경 중…" : busy ? "완료 중…" : ss.isEditor ? edit ? "선수변경" : "경기완료" : composing ? "경기 진행 중" : "보기 전용", ctaColor: ss.isEditor && !busy ? CTA_FINISH_COLOR : CTA_DISABLED_COLOR,
					ctaEnabled: ss.isEditor && !busy, showUnconfirm: !!edit && !busy, blink: false,
				},
			});
		}

		for (const group of groups) {
			const members: MagnetView[] = [];
			const sending = proposals?.sendingIds.has(group.id) === true;
			group.playerIds.forEach((playerId, index) => {
				const member = magnet({ kind: "proposal-member", playerId, groupId: group.id }, computeSlotOffset(index));
				if (member) members.push(sending ? { ...member, draggable: false } : member);
			});
			const source: CardView["source"] = { kind: "proposal", groupId: group.id };
			card({
				kind: "card", key: sourceKey(source), source, point: group.anchor, draggable: true,
				members, emptySlots: emptySlotIndices(new Set(group.playerIds.map((_, i) => i))), confirmed: false,
				appearance: {
					fill: PROPOSAL_BG, stroke: PROPOSAL_STROKE, label: `매칭 제안 · ${group.playerIds.length}/4`,
					labelColor: PROPOSAL_STROKE, labelBold: true, showVs: false,
					ctaLabel: sending ? "보내는 중…" : "매칭 제안", ctaColor: sending ? CTA_DISABLED_COLOR : PROPOSAL_CTA,
					ctaEnabled: !sending && members.length === group.playerIds.length, showUnconfirm: false, blink: false,
				},
			});
		}

		for (const proposal of visibleProposals) {
			if (!proposals) continue;
			const point = proposals.anchors.get(proposal.id);
			if (!point) continue;
			const source: CardView["source"] = { kind: "proposal", groupId: proposal.id };
			const busy = proposals.resolvingIds.has(proposal.id);
			const editable = proposals.isAdmin && ss.isEditor && !busy;
			const full = proposal.player_ids.length === 4;

			const canWithdraw = proposal.created_by === proposals.viewerId;
			const adminActions = proposals.isAdmin && (ss.isEditor || !canWithdraw);
			const members = proposal.player_ids.map((playerId, index): MagnetView => {
				const memberSource: BoardSource = { kind: "proposal-member", playerId, groupId: proposal.id };
				return { kind: "magnet", key: sourceKey(memberSource), source: memberSource,
					point: computeSlotOffset(index), draggable: editable, ghost: false, resting: false, cockPending: false,
					player: ss.sessionPlayers.get(playerId) ?? {
						id: playerId, playerId, memberId: null, name: proposal.player_names[index], gender: "M", skills: { grade: 0 },
						status: "waiting", gameCount: 0, mixedCount: 0, waitSince: null, joinedAtMatch: 0, allowMixedSingle: false, cockChecked: true,
					},
				};
			});
			card({ kind: "card", key: sourceKey(source), source, point, draggable: !busy, members,
				emptySlots: emptySlotIndices(new Set(proposal.player_ids.map((_, index) => index))), confirmed: false,
				appearance: {
					fill: PROPOSAL_BG, stroke: PROPOSAL_STROKE, dashed: true,
					label: `편성제안 · ${proposal.creator_name}`,
					labelColor: PROPOSAL_STROKE, labelBold: true, showVs: false,
					ctaLabel: busy ? "처리 중…" : adminActions ? full ? "코트 선택" : "자동매칭" : "제안 취소",
					ctaColor: !busy && (adminActions ? editable && (!full || hasEmptyCourt) : canWithdraw)
						? adminActions && full ? CTA_PLAY_COLOR : PROPOSAL_CTA : CTA_DISABLED_COLOR,
					ctaEnabled: !busy && (adminActions ? editable && (!full || hasEmptyCourt) : canWithdraw),
					showUnconfirm: adminActions, blink: false,
				},
			});
		}

		cache = nextCache;
		if (sameArray(previous.entities, entities) && previous.isEditor === ss.isEditor) return previous;
		previous = { entities, isEditor: ss.isEditor };
		return previous;
	};
}
