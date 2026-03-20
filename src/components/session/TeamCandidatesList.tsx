import { memo, useState } from "react";
import type { GeneratedTeam, TeamStrategy } from "../../types";
import { useAppStore } from "../../store/appStore";
import { useSessionStore } from "../../store/sessionStore";
import { useTeamCandidates } from "../../hooks/useTeamCandidates";
import { usePlayerReplace } from "../../hooks/usePlayerReplace";
import PlayerReplaceDialog from "../PlayerReplaceDialog";
import FilterChip from "../shared/FilterChip";
import SectionHeader from "../shared/SectionHeader";
import ManualMatchDialog from "./ManualMatchDialog";
import TeamCandidateCard from "./TeamCandidateCard";

const STRATEGY_OPTIONS: { value: TeamStrategy | null; label: string }[] = [
	{ value: null, label: "전체" },
	{ value: "gameCountBalanced", label: "경기수 균등" },
	{ value: "coPlayerAvoidance", label: "동반자 회피" },
	{ value: "newCombination", label: "새 조합" },
	{ value: "mixedCountBalanced", label: "혼복 우선" },
	{ value: "skillBalanced", label: "실력 균형" },
	{ value: "randomShuffle", label: "랜덤" },
];

const EMPTY_SINGLE_WOMAN_IDS: string[] = [];

interface TeamCandidatesListProps {
	strategyFilter: TeamStrategy | null;
	onStrategyChange: (strategy: TeamStrategy | null) => void;
}

const TeamCandidatesList = memo(function TeamCandidatesList({
	strategyFilter,
	onStrategyChange,
}: TeamCandidatesListProps) {
	const singleWomanIds = useAppStore((s) => s.sessionMeta?.singleWomanIds) ?? EMPTY_SINGLE_WOMAN_IDS;

	const sessionPlayers = useSessionStore((s) => s.sessionPlayers);

	const {
		visibleCandidates: candidates,
		unavailableIds,
		playingPlayers,
		waiting,
		pairHistory,
		handleAddToQueue,
		handleRefreshCandidates: onRefresh,
		handleCandidatePlayerReplace: onPlayerReplace,
		handleAssignCandidate: onAssign,
		handleQueueCandidate: onQueue,
	} = useTeamCandidates({ strategyFilter });

	const waitingCount = waiting.length;

	const [showManualMatch, setShowManualMatch] = useState(false);

	const { handlePlayerClick, replaceDialogProps } = usePlayerReplace({
		teams: candidates,
		sessionPlayers,
		waiting,
		playingPlayers,
		pairHistory,
		unavailableIds,
		onReplace: onPlayerReplace,
	});

	const emptyCourtId = useSessionStore(
		(s) => s.courts.find((c) => !c.match)?.id ?? null,
	);

	const handleManualConfirm = (team: GeneratedTeam) => {
		handleAddToQueue(team);
		setShowManualMatch(false);
	};

	return (
		<>
			<div>
				<SectionHeader
					icon={
						<svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
							<path d="M10 2.5L12 7.5H17L13 10.5L14.5 16L10 13L5.5 16L7 10.5L3 7.5H8L10 2.5Z" stroke="#0b84ff" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
						</svg>
					}
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
								<svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
									<path d="M3.5 10a6.5 6.5 0 0 1 11.25-4.5M16.5 10a6.5 6.5 0 0 1-11.25 4.5" stroke="#0b84ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
									<path d="M14.5 2v3.5H11M5.5 18v-3.5H9" stroke="#0b84ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
								</svg>
							</button>
						</>
					}
				/>

				{/* Strategy filter chips */}
				<div
					style={{
						padding: "0 16px 10px",
						display: "flex",
						gap: 5,
						overflowX: "auto",
						overflowY: "hidden",
						WebkitOverflowScrolling: "touch",
						flexWrap: "nowrap",
						touchAction: "pan-x",
					}}
					className="no-sb"
				>
					{STRATEGY_OPTIONS.map(({ value, label }) => (
						<FilterChip
							key={label}
							label={label}
							active={strategyFilter === value}
							onClick={() => onStrategyChange(value)}
							flexShrink={0}
						/>
					))}
				</div>

				{candidates.length > 0 ? (
					<div
						style={{
							padding: "0 16px",
							display: "flex",
							flexDirection: "column",
							gap: 6,
						}}
					>
						{candidates.map((team, index) => (
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
					waiting={waiting}
					playingPlayers={playingPlayers}
					unavailableIds={unavailableIds}
					pairHistory={pairHistory}
					singleWomanIds={singleWomanIds}
					onConfirm={handleManualConfirm}
					onCancel={() => setShowManualMatch(false)}
				/>
			)}
		</>
	);
});

export default TeamCandidatesList;
