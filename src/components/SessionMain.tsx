import { useSessionState } from "../hooks/useSessionState";
import type { SessionStateData } from "../lib/supabaseClient";
import type { Player, SessionSettings } from "../types";
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
  initialPlayers: Player[];
  settings: SessionSettings;
  initialStateData: SessionStateData | null;
  clientId: string;
  sessionId: number;
  onBack: () => void;
  onEnd: () => void;
}

export default function SessionMain({
  initialPlayers,
  settings,
  initialStateData,
  clientId,
  sessionId,
  onBack,
  onEnd,
}: Props) {
  const {
    courts,
    waiting,
    resting,
    gameCountHistory,
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
    handleGenerate,
    handleAssignGroup,
    handleAssign,
    handleComplete,
    handleCreateReservation,
    handleDisbandGroup,
    toggleReservingPlayer,
    canGenerate,
    canReserve,
    courtPlayerMap,
    modalPlayers,
    totalCount,
  } = useSessionState({
    initialPlayers,
    settings,
    initialStateData,
    clientId,
    sessionId,
    onEnd,
  });

  const playingCount = courts.reduce(
    (n, c) => n + (c.team ? c.team.teamA.length + c.team.teamB.length : 0),
    0
  );

  return (
    <div
      className="h-[100dvh] flex flex-col md:max-w-sm md:mx-auto"
      style={{ background: "#fafbff" }}
    >
      <SessionHeader
        onBack={onBack}
        onEndClick={() => setShowEndConfirm(true)}
      />

      {/* Stats Summary */}
      <StatsSummary
        totalCount={totalCount}
        waitingCount={waiting.length}
        playingCount={playingCount}
        restingCount={resting.length}
      />

      <div className="flex-1 overflow-y-auto no-sb">
        {/* Courts Section */}
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
          hasEmptyCourt={courts.some((c) => c.team === null)}
          waitingCount={waiting.length}
          onDisband={handleDisbandGroup}
          onAssign={handleAssignGroup}
        />

        <WaitingList
          waiting={waiting}
          gameCountHistory={gameCountHistory}
          onToggleResting={toggleResting}
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
          onConfirm={onEnd}
          onCancel={() => setShowEndConfirm(false)}
        />
      )}
    </div>
  );
}
