import { useSessionState } from "../hooks/useSessionState";
import { useAppStore } from "../store/appStore";
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
	onBack: () => void;
	onEnd: () => void;
}

const EMPTY_SINGLE_WOMAN_IDS: string[] = [];

export default function SessionMain({ onBack, onEnd }: Props) {
	const singleWomanIds =
		useAppStore((s) => s.sessionMeta?.singleWomanIds) ?? EMPTY_SINGLE_WOMAN_IDS;
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
		toggleForceHardGame,
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
		onEnd,
	});

	return (
		<div
			className="md:max-w-sm md:mx-auto bg-[#fafbff] dark:bg-[#0f172a]"
			style={{ minHeight: "100dvh" }}
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
					singleWomanIds={singleWomanIds}
					onToggleResting={toggleResting}
					onToggleForceMixed={toggleForceMixed}
				onToggleForceHardGame={toggleForceHardGame}
				/>

				<RestingList resting={resting} onToggleResting={toggleResting} />

				{/* 하단 고정 바 높이만큼 스페이서 */}
				<div style={{ height: "calc(60px + max(12px, env(safe-area-inset-bottom)))" }} />
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
