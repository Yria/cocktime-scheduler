import { useSessionState } from "../hooks/useSessionState";
import type { ClientSessionState } from "../lib/supabaseClient";
import CourtList from "./session/CourtList";
import CourtsHeader from "./session/CourtsHeader";
import EndSessionModal from "./session/EndSessionModal";
import ReservationModal from "./session/ReservationModal";
import ReservedList from "./session/ReservedList";
import RestingList from "./session/RestingList";
import SessionControls from "./session/SessionControls";
import SessionHeader from "./session/SessionHeader";
import StatsSummary from "./session/StatsSummary";
import WaitingList from "./session/WaitingList";
import TeamDialog from "./TeamDialog";

interface Props {
	sessionId: number;
	courtCount: number;
	singleWomanIds: string[];
	initialState: ClientSessionState;
	clientId: string;
	onBack: () => void;
	onEnd: () => void;
}

export default function SessionMain({
	sessionId,
	courtCount,
	singleWomanIds,
	initialState,
	clientId,
	onBack,
	onEnd,
}: Props) {
	const {
		courts,
		waiting,
		resting,
		pendingTeam,
		setPendingTeam,
		setPendingGroupId,
		showEndConfirm,
		setShowEndConfirm,
		reservedGroups,
		showReserveModal,
		setShowReserveModal,
		reservingSelected,
		setReservingSelected,
		toggleResting,
		toggleForceMixed,
		handleGenerate,
		handleAssignGroup,
		handleAssign,
		handleComplete,
		handleCreateReservation,
		handleDisbandGroup,
		handleEndSession,
		toggleReservingPlayer,
		canGenerate,
		canReserve,
		courtPlayerMap,
		modalPlayers,
		playingCount,
		totalCount,
	} = useSessionState({
		sessionId,
		courtCount,
		clientId,
		initialState,
		singleWomanIds,
		onEnd,
	});

	return (
		<div
			className="h-[100dvh] flex flex-col md:max-w-sm md:mx-auto"
			style={{ background: "#fafbff" }}
		>
			<SessionHeader
				onBack={onBack}
				onEndClick={() => setShowEndConfirm(true)}
			/>

			<StatsSummary
				totalCount={totalCount}
				waitingCount={waiting.length}
				playingCount={playingCount}
				restingCount={resting.length}
			/>

			<div className="flex-1 overflow-y-auto no-sb">
				<CourtsHeader courtsCount={courts.length} />

				<div
					style={{
						padding: "0 16px",
						display: "flex",
						flexDirection: "column",
						gap: 16,
					}}
				>
					<CourtList courts={courts} onComplete={handleComplete} />
				</div>

				<ReservedList
					reservedGroups={reservedGroups}
					courtPlayerMap={courtPlayerMap}
					hasEmptyCourt={courts.some((c) => c.match === null)}
					waitingCount={waiting.length}
					onDisband={handleDisbandGroup}
					onAssign={handleAssignGroup}
				/>

				<WaitingList
					waiting={waiting}
					onToggleResting={toggleResting}
					onToggleForceMixed={toggleForceMixed}
				/>

				<RestingList resting={resting} onToggleResting={toggleResting} />

				<div style={{ height: 16 }} />
			</div>

			<SessionControls
				onGenerate={handleGenerate}
				canGenerate={canGenerate}
				onReserveClick={() => {
					setReservingSelected(new Set());
					setShowReserveModal(true);
				}}
				canReserve={canReserve}
				waitingCount={waiting.length}
			/>

			{pendingTeam && (
				<TeamDialog
					team={pendingTeam}
					courts={courts}
					onAssign={handleAssign}
					onCancel={() => {
						setPendingTeam(null);
						setPendingGroupId(null);
					}}
				/>
			)}

			{showReserveModal && (
				<ReservationModal
					modalPlayers={modalPlayers}
					reservingSelected={reservingSelected}
					courtPlayerMap={courtPlayerMap}
					onTogglePlayer={toggleReservingPlayer}
					onCreate={handleCreateReservation}
					onCancel={() => {
						setShowReserveModal(false);
						setReservingSelected(new Set());
					}}
				/>
			)}

			{showEndConfirm && (
				<EndSessionModal
					onConfirm={handleEndSession}
					onCancel={() => setShowEndConfirm(false)}
				/>
			)}
		</div>
	);
}
