import { useSessionState } from "../hooks/useSessionState";
import { useTeamCandidates } from "../hooks/useTeamCandidates";
import { useAppStore } from "../store/appStore";
import CourtList from "./session/CourtList";
import CourtsHeader from "./session/CourtsHeader";
import EndSessionModal from "./session/EndSessionModal";
import MatchQueue from "./session/MatchQueue";
import RestingList from "./session/RestingList";
import SessionHeader from "./session/SessionHeader";
import StatsSummary from "./session/StatsSummary";
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
		toggleForceMixed,
		toggleForceHardGame,
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
	});

	return (
		<div
			className="md:max-w-sm md:mx-auto bg-[#fafbff] dark:bg-[#0f172a]"
			style={{ minHeight: "100dvh", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
		>
			<SessionHeader
				onBack={onBack}
				onEndClick={() => setShowEndConfirm(true)}
			/>

			<StatsSummary
				totalCount={totalCount}
				waitingCount={waiting.length}
				playingCount={playingCount}
				queuedCount={queuedCount}
				restingCount={resting.length}
			/>

			<div>
				<CourtsHeader courtsCount={courts.length} />

				<div
					style={{
						padding: "0 16px",
						display: "flex",
						flexDirection: "column",
						gap: 16,
					}}
				>
					<CourtList
						courts={courts}
						onComplete={handleComplete}
					/>
				</div>

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
					onAssign={handleAssignCandidate}
					onQueue={handleQueueCandidate}
					onPlayerReplace={handleCandidatePlayerReplace}
					onRefresh={handleRefreshCandidates}
				/>

				<WaitingList
					waiting={waiting}
					singleWomanIds={singleWomanIds}
					onToggleResting={toggleResting}
					onToggleForceMixed={toggleForceMixed}
					onToggleForceHardGame={toggleForceHardGame}
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
