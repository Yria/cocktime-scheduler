import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionPlayer } from "../types";
import { useSessionState } from "../hooks/useSessionState";
import { useAppStore } from "../store/appStore";
import { calculateTeamCandidateCount, generateBulkTeamCandidates } from "../lib/teamGenerator";
import CourtList from "./session/CourtList";
import CourtsHeader from "./session/CourtsHeader";
import EndSessionModal from "./session/EndSessionModal";
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
	const singleWomanIds =
		useAppStore((s) => s.sessionMeta?.singleWomanIds) ?? EMPTY_SINGLE_WOMAN_IDS;
	const {
		courts,
		waiting,
		resting,
		candidateTeams,
		setCandidateTeams,
		updateCandidateTeam,
		showEndConfirm,
		setShowEndConfirm,
		toggleResting,
		toggleForceMixed,
		toggleForceHardGame,
		handleReserveOrAssign,
		handleCancelReservation,
		handleComplete,
		handleEndSession,
		playingCount,
		totalCount,
		pairHistory,
		lastMixedPlayerIds,
		lastCoPlayers,
	} = useSessionState({
		onEnd,
	});

	// 예약된 선수 파생 상태
	const reservedPlayerIds = useMemo(() => {
		const ids = new Set<string>();
		for (const court of courts) {
			if (court.reserved) {
				for (const p of [...court.reserved.teamA, ...court.reserved.teamB]) {
					ids.add(p.id);
				}
			}
		}
		return ids;
	}, [courts]);

	const reservedPlayerCourtMap = useMemo(() => {
		const map = new Map<string, number>();
		for (const court of courts) {
			if (court.reserved) {
				for (const p of [...court.reserved.teamA, ...court.reserved.teamB]) {
					map.set(p.id, court.id);
				}
			}
		}
		return map;
	}, [courts]);

	// 4명 모두 대기 중(예약되지 않은)인 후보만 필터 → 코트 수 × 3 만큼만 표시
	const { visibleCandidates, originalIndices } = useMemo(() => {
		const waitingIds = new Set(waiting.map((p) => p.id));
		const filtered: { team: typeof candidateTeams[number]; origIdx: number }[] = [];
		for (let i = 0; i < candidateTeams.length; i++) {
			const team = candidateTeams[i];
			const players = [...team.teamA, ...team.teamB];
			const allWaiting = players.every((p) => waitingIds.has(p.id));
			const noneReserved = players.every((p) => !reservedPlayerIds.has(p.id));
			if (allWaiting && noneReserved) {
				filtered.push({ team, origIdx: i });
			}
		}
		const limited = filtered.slice(0, courts.length * 3);

		console.log(`[UI] visibleCandidates: ${limited.length}/${candidateTeams.length} total, waiting=${waiting.length}, reservedIds=${reservedPlayerIds.size}`);
		if (candidateTeams.length > 0 && limited.length === 0) {
			// 왜 모두 필터링됐는지 상세 로그
			for (let i = 0; i < Math.min(candidateTeams.length, 3); i++) {
				const team = candidateTeams[i];
				const players = [...team.teamA, ...team.teamB];
				const detail = players.map((p) => `${p.name}(w=${waitingIds.has(p.id)},r=${reservedPlayerIds.has(p.id)})`);
				console.log(`  [UI] candidate[${i}] filtered: ${detail.join(", ")}`);
			}
		}

		return {
			visibleCandidates: limited.map((f) => f.team),
			originalIndices: limited.map((f) => f.origIdx),
		};
	}, [candidateTeams, waiting, courts.length, reservedPlayerIds]);

	const handleRefreshCandidates = useCallback(() => {
		const targetCount = calculateTeamCandidateCount(courts.length);
		const availableWaiting = waiting.filter((p) => !reservedPlayerIds.has(p.id));
		const newCandidates = generateBulkTeamCandidates(
			targetCount, availableWaiting, singleWomanIds, lastMixedPlayerIds, lastCoPlayers,
		);
		setCandidateTeams(newCandidates);
	}, [courts.length, waiting, reservedPlayerIds, singleWomanIds, lastMixedPlayerIds, lastCoPlayers, setCandidateTeams]);

	// 표시할 후보가 없거나 가용 선수 풀이 변경되면 자동 생성
	const autoRefreshDone = useRef(false);
	const [prevAvailableCount, setPrevAvailableCount] = useState(0);
	useEffect(() => {
		const availableCount = waiting.filter((p) => !reservedPlayerIds.has(p.id)).length;

		// 가용 선수 풀이 늘어나면 후보 재생성 (완료된 경기 선수가 대기 복귀 시)
		const poolGrew = availableCount > prevAvailableCount && availableCount >= 4;
		const noCandidates = visibleCandidates.length === 0 && availableCount >= 4;

		if (noCandidates || poolGrew) {
			if (!autoRefreshDone.current || poolGrew) {
				console.log(`[UI] auto-refresh: visible=${visibleCandidates.length}, available=${availableCount}, prev=${prevAvailableCount}, triggering generation`);
				autoRefreshDone.current = true;
				setPrevAvailableCount(availableCount);
				handleRefreshCandidates();
			} else {
				console.log(`[UI] auto-refresh: already tried, skipping (available=${availableCount})`);
			}
		} else {
			autoRefreshDone.current = false;
			setPrevAvailableCount(availableCount);
		}
	}, [visibleCandidates.length, waiting, reservedPlayerIds, handleRefreshCandidates, prevAvailableCount]);

	const handleCandidatePlayerReplace = (visibleIndex: number, oldPlayer: SessionPlayer, newPlayer: SessionPlayer) => {
		const origIndex = originalIndices[visibleIndex];
		const team = candidateTeams[origIndex];
		if (!team) return;

		const newTeamA = team.teamA.map((p) =>
			p.id === oldPlayer.id ? newPlayer : p
		) as [SessionPlayer, SessionPlayer];

		const newTeamB = team.teamB.map((p) =>
			p.id === oldPlayer.id ? newPlayer : p
		) as [SessionPlayer, SessionPlayer];

		updateCandidateTeam(origIndex, {
			...team,
			teamA: newTeamA,
			teamB: newTeamB,
		});
	};

	const handleReserveOrAssignCandidate = useCallback(
		(candidateIndex: number, courtId: number) => {
			const origIndex = originalIndices[candidateIndex];
			const team = candidateTeams[origIndex];
			if (!team) return;
			handleReserveOrAssign(team, courtId);
		},
		[originalIndices, candidateTeams, handleReserveOrAssign],
	);

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
						onCancelReservation={handleCancelReservation}
					/>
				</div>

				<TeamCandidatesList
					candidates={visibleCandidates}
					courts={courts}
					waiting={waiting}
					pairHistory={pairHistory}
					reservedPlayerIds={reservedPlayerIds}
					onReserveOrAssign={handleReserveOrAssignCandidate}
					onPlayerReplace={handleCandidatePlayerReplace}
					onRefresh={handleRefreshCandidates}
				/>

				<WaitingList
					waiting={waiting}
					singleWomanIds={singleWomanIds}
					reservedPlayerCourtMap={reservedPlayerCourtMap}
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
