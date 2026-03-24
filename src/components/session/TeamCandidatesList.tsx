import { memo, useMemo, useState } from "react";
import type { GeneratedTeam, SessionPlayer } from "../../types";
import { Star, RefreshCw, Equal, Sparkles, Shuffle, Scale, Users, Clock } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useSessionStore } from "../../store/sessionStore";
import { useTeamCandidates } from "../../hooks/useTeamCandidates";
import { usePlayerReplace } from "../../hooks/usePlayerReplace";
import { dbLogManualMatch } from "../../lib/supabase/api";
import { rankCandidates, skillScore, WEIGHT_PROFILES } from "../../lib/teamSelection";
import type { PlayerSnapshot, CandidateSnapshot, ContextSnapshot, ManualMatchSnapshot } from "../../lib/supabase/types";
import PlayerReplaceDialog from "../PlayerReplaceDialog";
import SectionHeader from "../shared/SectionHeader";
import ManualMatchDialog from "./ManualMatchDialog";
import TeamCandidateCard from "./TeamCandidateCard";

function toPlayerSnapshot(p: SessionPlayer): PlayerSnapshot {
	return {
		id: p.id,
		player_id: p.playerId,
		name: p.name,
		gender: p.gender,
		skills: p.skills,
		skill_score: skillScore(p),
		game_count: p.gameCount,
		mixed_count: p.mixedCount,
		status: p.status,
		is_resting: p.status === "resting",
		force_mixed: p.forceMixed,
		force_hard_game: p.forceHardGame,
		allow_mixed_single: p.allowMixedSingle,
		wait_since: p.waitSince,
	};
}

const TeamCandidatesList = memo(function TeamCandidatesList() {
	const sessionId = useAppStore((s) => s.sessionMeta?.sessionId) ?? 0;
	const singleWomanIds = useAppStore((s) => s.sessionMeta?.singleWomanIds) ?? [];
	const sessionPlayers = useSessionStore((s) => s.sessionPlayers);
	const pairHistory = useSessionStore((s) => s.pairHistory);
	const lastCoPlayers = useSessionStore((s) => s.lastCoPlayers);

	const {
		visibleCandidates: candidates,
		unavailableIds,
		waiting,
		playingPlayers,
		handleAddToQueue,
		handleRefreshCandidates: onRefresh,
		handleCandidatePlayerReplace: onPlayerReplace,
		handleAssignCandidate: onAssign,
		handleQueueCandidate: onQueue,
	} = useTeamCandidates();

	const waitingCount = waiting.length;

	const [showManualMatch, setShowManualMatch] = useState(false);
	const [reasonFilter, setReasonFilter] = useState<string | null>(null);

	// reason → icon 매핑
	const REASON_ICONS: Record<string, React.ReactNode> = {
		"게임수 균등": <Equal size={14} />,
		"새 조합 우선": <Sparkles size={14} />,
		"직전 동반 회피": <Shuffle size={14} />,
		"실력 균형": <Scale size={14} />,
		"혼복 참여 균등": <Users size={14} />,
		"대기 시간 우선": <Clock size={14} />,
	};

	// reason 목록 추출 + 필터링
	const reasonTabs = useMemo(() => {
		const reasons = new Set<string>();
		for (const c of candidates) {
			const r = c.reason?.split(" · ")[0];
			if (r) reasons.add(r);
		}
		return [...reasons];
	}, [candidates]);

	const filteredCandidates = useMemo(() => {
		if (!reasonFilter) return candidates;
		return candidates.filter((c) => c.reason?.startsWith(reasonFilter));
	}, [candidates, reasonFilter]);

	const { handlePlayerClick, replaceDialogProps } = usePlayerReplace({
		teams: candidates,
		sessionPlayers,
		onReplace: onPlayerReplace,
	});

	const emptyCourtId = useSessionStore(
		(s) => s.courts.find((c) => !c.match)?.id ?? null,
	);

	const handleManualConfirm = (team: GeneratedTeam) => {
		handleAddToQueue(team);
		setShowManualMatch(false);

		// 수동 매칭 로그 (비동기, UI 블로킹 없음)
		if (sessionId) {
			const chosenIds = [...team.teamA, ...team.teamB];
			const chosenPlayers = chosenIds
				.map((id) => sessionPlayers.get(id))
				.filter((p): p is SessionPlayer => p !== undefined);

			const chosenScore = chosenPlayers.length === 4
				? rankCandidates(
					chosenPlayers.slice(0, 3),
					[chosenPlayers[3]],
					{ pairHistory, lastCoPlayers },
				)[0]?.score ?? -1
				: -1;

			const candidateSnapshots: CandidateSnapshot[] = candidates.map((c) => ({
				team_a: c.teamA,
				team_b: c.teamB,
				game_type: c.gameType,
				reason: c.reason,
			}));

			const pairHistorySnapshot: Record<string, string[]> = {};
			for (const [key, partners] of Object.entries(pairHistory)) {
				pairHistorySnapshot[key] = [...partners];
			}

			const contextSnapshot: ContextSnapshot = {
				pair_history: pairHistorySnapshot,
				last_co_players: lastCoPlayers,
				single_woman_ids: singleWomanIds,
			};

			const snapshot: ManualMatchSnapshot = {
				chosen_players: chosenPlayers.map(toPlayerSnapshot),
				chosen_score: chosenScore,
				candidate_teams: candidateSnapshots,
				waiting_pool: waiting.map(toPlayerSnapshot),
				playing_pool: playingPlayers.map(toPlayerSnapshot),
				context: contextSnapshot,
			};

			dbLogManualMatch(sessionId, snapshot);
		}
	};

	return (
		<>
			<div>
				<SectionHeader
					icon={<Star size={14} color="#0b84ff" />}
					iconBg="rgba(11,132,255,0.1)"
					title="팀 매칭"
					rightContent={
						<>
							<button
								type="button"
								onClick={() => setShowManualMatch(true)}
								style={{
									fontSize: 11,
									fontWeight: 600,
									color: "#ff9500",
									background: "rgba(255,149,0,0.1)",
									borderRadius: 99,
									padding: "4px 10px",
									border: "none",
									cursor: "pointer",
								}}
							>
								수동매칭
							</button>
							<button
								type="button"
								onClick={onRefresh}
								style={{
									width: 24,
									height: 24,
									borderRadius: 6,
									background: "rgba(11,132,255,0.1)",
									border: "none",
									cursor: "pointer",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									padding: 0,
									flexShrink: 0,
								}}
								title="팀 매칭 새로고침"
							>
								<RefreshCw size={14} color="#0b84ff" />
							</button>
						</>
					}
				/>

				{candidates.length > 0 ? (
					<div
						style={{
							padding: "0 16px",
							display: "flex",
							flexDirection: "column",
							gap: 6,
						}}
					>
						{reasonTabs.length > 1 && (
							<div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 2 }}>
								<button
									type="button"
									onClick={() => setReasonFilter(null)}
									style={{
										fontSize: 10,
										fontWeight: 600,
										padding: "3px 8px",
										borderRadius: 99,
										border: "none",
										cursor: "pointer",
										background: !reasonFilter ? "#0b84ff" : "rgba(142,142,147,0.12)",
										color: !reasonFilter ? "#fff" : "#8e8e93",
									}}
								>
									전체
								</button>
								{reasonTabs.map((r) => (
									<button
										key={r}
										type="button"
										onClick={() => setReasonFilter(reasonFilter === r ? null : r)}
										title={r}
										style={{
											fontSize: 13,
											padding: "4px 8px",
											borderRadius: 99,
											border: "none",
											cursor: "pointer",
											background: reasonFilter === r ? "#0b84ff" : "rgba(142,142,147,0.12)",
											color: reasonFilter === r ? "#fff" : "inherit",
											lineHeight: 1,
											display: "inline-flex",
											alignItems: "center",
											justifyContent: "center",
										}}
									>
										{REASON_ICONS[r] ?? r}
									</button>
								))}
							</div>
						)}
						{filteredCandidates.map((team, index) => (
							<TeamCandidateCard
								key={index}
								team={team}
								index={index}
								emptyCourtId={emptyCourtId}
								unavailableIds={unavailableIds}
								sessionPlayers={sessionPlayers}
								onAssign={onAssign}
								onQueue={onQueue}
								onPlayerClick={handlePlayerClick}
							/>
						))}
					</div>
				) : waitingCount > 0 && waitingCount < 4 ? (
					<p
						style={{
							margin: "0 16px 12px",
							padding: "6px 11px",
							fontSize: 12,
							fontWeight: 600,
							color: "#ff3b30",
							background: "rgba(255,59,48,0.07)",
							borderRadius: 10,
						}}
					>
						{4 - waitingCount}명 더 필요
					</p>
				) : null}
			</div>

			{replaceDialogProps && (
				<PlayerReplaceDialog {...replaceDialogProps} />
			)}

			{showManualMatch && (
				<ManualMatchDialog
					onConfirm={handleManualConfirm}
					onCancel={() => setShowManualMatch(false)}
				/>
			)}
		</>
	);
});

export default TeamCandidatesList;
