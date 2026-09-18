import type { BoardState } from "../../../store/board/types";
import type { useSessionStore } from "../../../store/sessionStore";
import type { StagePoint } from "../../../types/board";
import { visibleMatchProposals, type ProposalComposerSnapshot } from "../matchProposals";
import {
	CTA_DISABLED_COLOR, CTA_FINISH_COLOR, CTA_PLAY_COLOR, CTA_START_COLOR,
	TEAM_BOX_ABOVE,
	TEAM_FORMING_BG, TEAM_FORMING_STROKE, TEAM_PLAYING_BG, TEAM_PLAYING_STROKE,
	TEAM_READY_BG, TEAM_READY_STROKE, TEAM_RESERVED_BG, TEAM_RESERVED_STROKE,
	TEAM_W, TEXT_SECONDARY, PROPOSAL_BG, PROPOSAL_STROKE, PROPOSAL_CTA,
} from "../constants";
import { computeSlotOffset, emptySlotIndices } from "../geometry";
import {
	findReservation, isTeamStartable, matchPlayerIds,
	playingIdsFromCourts, teamMembers, wouldDissolveByPlaying,
} from "../membership";
import { sourceKey, type BoardEntity, type BoardSnapshot, type BoardSource, type CardAppearance, type CardView, type MagnetView } from "./types";

type SessionSnapshot = ReturnType<typeof useSessionStore.getState>;

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
export function createBoardProjection(): (bs: BoardState, ss: SessionSnapshot, proposals?: ProposalComposerSnapshot) => BoardSnapshot {
	let previous: BoardSnapshot = { entities: [], isEditor: false };
	let previousInputs: readonly unknown[] = [];
	let cache = new Map<string, BoardEntity>();

	return (bs, ss, proposals) => {
		const draggedPlayerId = bs.dragInfo?.playerId ?? null;
		const inputs = [bs.magnets, bs.drafts, bs.reservations, bs.courtAnchors, draggedPlayerId,
			ss.sessionPlayers, ss.courts, ss.restingIds, ss.cockCheckEnabled, ss.isEditor, bs.assigningTeamIds,
			proposals?.enabled, proposals?.groups, proposals?.sendingIds, proposals?.proposals,
			proposals?.anchors, proposals?.resolvingIds, proposals?.viewerId, proposals?.isAdmin];
		if (sameArray(previousInputs, inputs)) return previous;
		previousInputs = inputs;

		const nextCache = new Map<string, BoardEntity>();
		const entities: BoardEntity[] = [];
		const playingIds = playingIdsFromCourts(ss.courts);
		const composing = proposals?.enabled === true;
		const groups = composing ? proposals.groups : [];
		const visibleProposals = visibleMatchProposals(proposals);
		const selected = new Set([...groups.flatMap((group) => group.playerIds), ...visibleProposals.flatMap((proposal) => proposal.player_ids)]);
		const restingIds = new Set(ss.restingIds);
		const hasEmptyCourt = ss.courts.some((court) => !court.match);

		const magnet = (source: BoardSource & { playerId: string }, point: StagePoint, resting = false): MagnetView | null => {
			const player = ss.sessionPlayers.get(source.playerId);
			const position = bs.magnets.get(source.playerId);
			if (!player || !position) return null;
			const ghost = source.kind === "ghost";
			const key = sourceKey(source);
			const next: MagnetView = {
				kind: "magnet", key, source, point, player, ghost, resting,
				cockPending: ss.cockCheckEnabled && !ghost && source.kind !== "playing" && !resting && !player.cockChecked,
				draggable: ss.isEditor || composing || (!ghost && position.teamId == null),
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
				if (sameAppearance(old.appearance, next.appearance)) next.appearance = old.appearance;
				if (samePoint(old.point, next.point) && old.draggable === next.draggable && old.confirmed === next.confirmed
					&& old.members === next.members && old.emptySlots === next.emptySlots && old.appearance === next.appearance) {
					nextCache.set(next.key, old);
					entities.push(old);
					return;
				}
			}
			nextCache.set(next.key, next);
			entities.push(next);
		};

		// Map 순서는 기존 화면의 기본 시각 순서다. 드롭 판정의 후보 순서를 바꾸지 않는다.
		for (const team of bs.drafts.values()) {
			if (wouldDissolveByPlaying(team, bs.reservations, playingIds)) continue;
			const membership = teamMembers(team.id, bs.drafts, bs.reservations);
			const count = membership.length;
			const full = count === 4;
			const startable = isTeamStartable(team.id, bs.drafts, bs.reservations, bs.magnets, playingIds);
			const canStart = full && startable;
			const busy = bs.assigningTeamIds?.has(team.id) === true;
			const ctaEnabled = ss.isEditor && !busy && (!full || (canStart && hasEmptyCourt));
			const labelColor = startable ? TEAM_READY_STROKE
				: full ? TEAM_RESERVED_STROKE : TEXT_SECONDARY;
			const baseLabel = !full ? `팀 구성 중 · ${count}/4`
				: canStart ? "팀 완성 · 4/4" : "4/4 · 예약 포함(경기중)";
			const members: MagnetView[] = [];
			for (const member of membership) {
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
				appearance: {
					fill: startable ? TEAM_READY_BG : full ? TEAM_RESERVED_BG : TEAM_FORMING_BG,
					stroke: startable ? TEAM_READY_STROKE : full ? TEAM_RESERVED_STROKE : TEAM_FORMING_STROKE,
					label: team.createdBy ? `${baseLabel} · by ${team.createdBy}` : baseLabel,
					labelColor, labelBold: full, showVs: full,
					ctaLabel: busy ? "시작 중…" : canStart ? hasEmptyCourt ? "경기시작" : "코트 대기" : full ? "예약 대기" : "자동매칭",
					ctaColor: !ctaEnabled ? CTA_DISABLED_COLOR : canStart ? CTA_PLAY_COLOR : CTA_START_COLOR,
					ctaEnabled, showUnconfirm: ss.isEditor, showEdit: false, blink: false,
				},
			});
		}

		for (const position of bs.magnets.values()) {
			if (position.teamId !== null || playingIds.has(position.playerId) || selected.has(position.playerId)) continue;
			const view = magnet({ kind: "free", playerId: position.playerId }, { x: position.x, y: position.y }, restingIds.has(position.playerId));
			if (view) entities.push(view);
		}

		let occupiedIndex = 0;
		for (const court of ss.courts) {
			const match = court.match;
			if (!match) continue;
			const point = bs.courtAnchors.get(court.id) ?? { x: TEAM_W / 2 + 12 + occupiedIndex * (TEAM_W + 20), y: TEAM_BOX_ABOVE + 8 };
			occupiedIndex++;
			const members: MagnetView[] = [];
			matchPlayerIds(match).forEach((playerId, index) => {
				const view = magnet({ kind: "playing", playerId, courtId: court.id, matchId: match.id }, computeSlotOffset(index));
				if (view) members.push(view);
			});
			const source: CardView["source"] = { kind: "court", courtId: court.id, matchId: match.id };
			card({
				kind: "card", key: sourceKey(source), source, point, draggable: ss.isEditor, members, emptySlots: [], confirmed: false,
				appearance: {
					fill: TEAM_PLAYING_BG, stroke: TEAM_PLAYING_STROKE,
					label: `${court.id}번 코트 · 경기중`, labelColor: TEAM_PLAYING_STROKE, labelBold: true, showVs: true,
					ctaLabel: ss.isEditor ? "경기완료" : composing ? "경기 진행 중" : "보기 전용", ctaColor: ss.isEditor ? CTA_FINISH_COLOR : CTA_DISABLED_COLOR,
					ctaEnabled: ss.isEditor, showUnconfirm: false, showEdit: ss.isEditor, blink: false,
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
					fill: PROPOSAL_BG, stroke: PROPOSAL_STROKE, label: `나만 보는 묶음 · ${group.playerIds.length}/4`,
					labelColor: PROPOSAL_STROKE, labelBold: true, showVs: false,
					ctaLabel: sending ? "보내는 중…" : "매칭 제안", ctaColor: sending ? CTA_DISABLED_COLOR : PROPOSAL_CTA,
					ctaEnabled: !sending && members.length === group.playerIds.length, showUnconfirm: false, showEdit: false, blink: false,
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
			const ready = proposal.player_ids.every((id) => {
				const player = ss.sessionPlayers.get(id);
				return player && !playingIds.has(id) && player.status === "waiting"
					&& (!ss.cockCheckEnabled || player.cockChecked) && !bs.magnets.get(id)?.teamId
					&& ![...bs.reservations.values()].some((reservation) => reservation.playerId === id);
			});
			const canWithdraw = proposal.created_by === proposals.viewerId;
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
			card({ kind: "card", key: sourceKey(source), source, point, draggable: true, members,
				emptySlots: emptySlotIndices(new Set(proposal.player_ids.map((_, index) => index))), confirmed: false,
				appearance: {
					fill: PROPOSAL_BG, stroke: PROPOSAL_STROKE, dashed: true,
					label: `매칭 제안 · ${proposal.creator_name}`,
					labelColor: PROPOSAL_STROKE, labelBold: true, showVs: false,
					ctaLabel: busy ? "처리 중…" : proposals.isAdmin ? full ? "경기시작" : "자동매칭" : "제안 취소",
					ctaColor: !busy && (proposals.isAdmin ? editable && (!full || (ready && hasEmptyCourt)) : canWithdraw)
						? proposals.isAdmin && full ? CTA_PLAY_COLOR : PROPOSAL_CTA : CTA_DISABLED_COLOR,
					ctaEnabled: !busy && (proposals.isAdmin ? editable && (!full || (ready && hasEmptyCourt)) : canWithdraw),
					showUnconfirm: proposals.isAdmin, showEdit: false, blink: false,
				},
			});
		}

		cache = nextCache;
		if (sameArray(previous.entities, entities) && previous.isEditor === ss.isEditor) return previous;
		previous = { entities, isEditor: ss.isEditor };
		return previous;
	};
}
