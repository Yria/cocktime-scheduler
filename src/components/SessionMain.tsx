import { useMemo, useState } from "react";
import { useSessionState } from "../hooks/useSessionState";
import { useTeamCandidates } from "../hooks/useTeamCandidates";
import { useAppStore } from "../store/appStore";
import type { TeamStrategy } from "../types";
import CompactCourtBar from "./session/CompactCourtBar";
import EndSessionModal from "./session/EndSessionModal";
import MatchQueue from "./session/MatchQueue";
import RestingList from "./session/RestingList";
import SessionHeader from "./session/SessionHeader";
import TeamCandidatesList from "./session/TeamCandidatesList";
import WaitingList from "./session/WaitingList";

interface Props {
	onBack: () => void;
	onEnd: () => void;
}

const EMPTY_SINGLE_WOMAN_IDS: string[] = [];

export default function SessionMain({ onBack, onEnd }: Props) {
	const sessionId = useAppStore((s) => s.sessionMeta?.sessionId) ?? 0;
	const singleWomanIds =
		useAppStore((s) => s.sessionMeta?.singleWomanIds) ?? EMPTY_SINGLE_WOMAN_IDS;
	const [strategyFilter, setStrategyFilter] = useState<TeamStrategy | null>(null);

	const {
		courts,
		waiting,
		resting,
		matchQueue,
		candidateTeams,
		setCandidateTeams,
		updateCandidateTeam,
		showEndConfirm,
		setShowEndConfirm,
		toggleResting,
		handleAssign,
		handleComplete,
		handleAddToQueue,
		handleRemoveFromQueue,
		handleAssignFromQueue,
		handleEndSession,
		playingCount,
		queuedCount,
		totalCount,
		pairHistory,
		lastMixedPlayerIds,
		lastCoPlayers,
	} = useSessionState({ onEnd });

	const playingPlayers = useMemo(
		() => courts.flatMap((c) => (c.match ? [...c.match.teamA, ...c.match.teamB] : [])),
		[courts],
	);

	const {
		visibleCandidates,
		unavailableIds,
		handleRefreshCandidates,
		handleCandidatePlayerReplace,
		handleAssignCandidate,
		handleQueueCandidate,
	} = useTeamCandidates({
		sessionId,
		waiting,
		courts,
		matchQueue,
		singleWomanIds,
		lastMixedPlayerIds,
		lastCoPlayers,
		pairHistory,
		candidateTeams,
		setCandidateTeams,
		updateCandidateTeam,
		handleAssign,
		handleAddToQueue,
		strategyFilter,
	});

	return (
		<div
			className="md:max-w-sm md:mx-auto bg-[#fafbff] dark:bg-[#0f172a]"
			style={{ minHeight: "100dvh", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
		>
			{/* ── Sticky area: Header + Compact Court Bar ── */}
			<div
				style={{ position: "sticky", top: 0, zIndex: 50 }}
			>
				<SessionHeader
					onBack={onBack}
					onEndClick={() => setShowEndConfirm(true)}
				/>

				<CompactCourtBar
					courts={courts}
					onComplete={handleComplete}
				/>
			</div>

			{/* ── Scroll area ── */}
			<div>
				<MatchQueue
					queue={matchQueue}
					courts={courts}
					onAssignFromQueue={handleAssignFromQueue}
					onRemoveFromQueue={handleRemoveFromQueue}
				/>

				<TeamCandidatesList
					candidates={visibleCandidates}
					courts={courts}
					waiting={waiting}
					waitingCount={waiting.length}
					unavailableIds={unavailableIds}
					pairHistory={pairHistory}
					playingPlayers={playingPlayers}
					singleWomanIds={singleWomanIds}
					strategyFilter={strategyFilter}
					onStrategyChange={setStrategyFilter}
					onAssign={handleAssignCandidate}
					onQueue={handleQueueCandidate}
					onAddManualToQueue={handleAddToQueue}
					onPlayerReplace={handleCandidatePlayerReplace}
					onRefresh={handleRefreshCandidates}
				/>

				<WaitingList
					waiting={waiting}
					singleWomanIds={singleWomanIds}
					onToggleResting={toggleResting}
				/>

				<RestingList resting={resting} onToggleResting={toggleResting} />
			</div>

			{showEndConfirm && (
				<EndSessionModal
					onConfirm={handleEndSession}
					onCancel={() => setShowEndConfirm(false)}
				/>
			)}
		</div>
	);
}
