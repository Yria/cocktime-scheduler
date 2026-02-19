import { useEffect, useRef, useState } from "react";
import {
	deserializePairHistory,
	serializePairHistory,
	supabase,
	updateSessionState,
	type SessionRow,
	type SessionStateData,
} from "../lib/supabaseClient";
import {
	generateTeam,
	generateTeamFromPlayers,
	recordGameCount,
	recordHistory,
	recordMixedHistory,
} from "../lib/teamGenerator";
import type {
	Court,
	GameCountHistory,
	GeneratedTeam,
	MixedHistory,
	PairHistory,
	Player,
	ReservedGroup,
	SessionSettings,
} from "../types";
import CourtList from "./session/CourtList";
import EndSessionModal from "./session/EndSessionModal";
import ReservationModal from "./session/ReservationModal";
import ReservedList from "./session/ReservedList";
import RestingList from "./session/RestingList";
import SessionControls from "./session/SessionControls";
import SessionHeader from "./session/SessionHeader";
import WaitingList from "./session/WaitingList";
import TeamDialog from "./TeamDialog";

interface Props {
	initialPlayers: Player[];
	settings: SessionSettings;
	initialStateData: SessionStateData | null;
	clientId: string;
	onBack: () => void;
	onEnd: () => void;
}

export default function SessionMain({
	initialPlayers,
	settings,
	initialStateData,
	clientId,
	onBack,
	onEnd,
}: Props) {
	const [courts, setCourts] = useState<Court[]>(
		() =>
			initialStateData?.courts ??
			Array.from({ length: settings.courtCount }, (_, i) => ({
				id: i + 1,
				team: null,
			})),
	);
	const [waiting, setWaiting] = useState<Player[]>(
		() => initialStateData?.waiting ?? initialPlayers,
	);
	const [resting, setResting] = useState<Player[]>(
		() => initialStateData?.resting ?? [],
	);
	const [history, setHistory] = useState<PairHistory>(() =>
		initialStateData?.history
			? deserializePairHistory(initialStateData.history)
			: {},
	);
	const [mixedHistory, setMixedHistory] = useState<MixedHistory>(
		() => initialStateData?.mixedHistory ?? {},
	);
	const [gameCountHistory, setGameCountHistory] = useState<GameCountHistory>(
		() => initialStateData?.gameCountHistory ?? {},
	);
	const [pendingTeam, setPendingTeam] = useState<GeneratedTeam | null>(null);
	const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
	const [showEndConfirm, setShowEndConfirm] = useState(false);
	const [reservedGroups, setReservedGroups] = useState<ReservedGroup[]>(
		() => initialStateData?.reservedGroups ?? [],
	);
	const [showReserveModal, setShowReserveModal] = useState(false);
	const [reservingSelected, setReservingSelected] = useState<Set<string>>(
		new Set(),
	);
	const [prevInitialPlayers, setPrevInitialPlayers] = useState(initialPlayers);

	const courtsRef = useRef(courts);
	const reservedGroupsRef = useRef(reservedGroups);
	const restingRef = useRef(resting);

	useEffect(() => {
		courtsRef.current = courts;
		reservedGroupsRef.current = reservedGroups;
		restingRef.current = resting;
	}, [courts, reservedGroups, resting]);

	const processingRemoteUpdate = useRef(false);

	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		if (processingRemoteUpdate.current) {
			processingRemoteUpdate.current = false;
			return;
		}

		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(() => {
			const stateData: SessionStateData = {
				courts,
				waiting,
				history: serializePairHistory(history),
				mixedHistory,
				gameCountHistory,
				reservedGroups,
				resting,
			};
			console.log(
				"[SAVE] 저장 courts:",
				JSON.stringify(
					courts.map((c) => ({
						id: c.id,
						team: c.team
							? c.team.teamA.map((p) => p.name) +
								" vs " +
								c.team.teamB.map((p) => p.name)
							: null,
					})),
				),
			);
			updateSessionState(stateData, clientId);
		}, 500);
		return () => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		};
	}, [
		courts,
		waiting,
		history,
		mixedHistory,
		gameCountHistory,
		reservedGroups,
		resting,
		clientId,
	]);

	useEffect(() => {
		const channel = supabase
			.channel("session-state-changes")
			.on(
				"postgres_changes",
				{
					event: "UPDATE",
					schema: "public",
					table: "sessions",
					filter: "id=eq.1",
				},
				(payload) => {
					const row = payload.new as SessionRow;
					if (row.last_client_id === clientId) {
						console.log("[REALTIME] 내 업데이트 → 무시");
						return;
					}
					if (!row.is_active) {
						onEnd();
						return;
					}
					if (!row.state_data) return;

					processingRemoteUpdate.current = true;

					const {
						courts: rc,
						waiting: rw,
						history: rh,
						mixedHistory: rm,
						gameCountHistory: rgc,
						reservedGroups: rr,
						resting: rrs,
					} = row.state_data;
					console.log(
						"[REALTIME] 상태 적용 courts:",
						JSON.stringify(
							rc.map((c) => ({
								id: c.id,
								team: c.team
									? c.team.teamA.map((p) => p.name) +
										" vs " +
										c.team.teamB.map((p) => p.name)
									: null,
							})),
						),
					);
					setCourts(rc);
					setWaiting(rw);
					setHistory(deserializePairHistory(rh));
					setMixedHistory(rm);
					setGameCountHistory(rgc);
					setReservedGroups(rr);
					setResting(rrs);
				},
			)
			.subscribe();

		return () => {
			supabase.removeChannel(channel);
		};
	}, [clientId, onEnd]);

	if (initialPlayers !== prevInitialPlayers) {
		setPrevInitialPlayers(initialPlayers);

		const onCourtIds = new Set(
			courts.flatMap((c) =>
				c.team ? [...c.team.teamA, ...c.team.teamB].map((p) => p.id) : [],
			),
		);
		const reservedIds = new Set(
			reservedGroups.flatMap((g) => g.players.map((p) => p.id)),
		);
		const restingIds = new Set(resting.map((p) => p.id));
		const newIds = new Set(initialPlayers.map((p) => p.id));

		setResting((prev) => {
			const next = prev.filter((p) => newIds.has(p.id));
			if (next.length === prev.length) return prev;
			return next;
		});

		setWaiting((prev) => {
			const kept = prev.filter((p) => newIds.has(p.id));
			const keptIds = new Set(kept.map((p) => p.id));
			const added = initialPlayers.filter(
				(p) =>
					!keptIds.has(p.id) &&
					!onCourtIds.has(p.id) &&
					!reservedIds.has(p.id) &&
					!restingIds.has(p.id),
			);
			const next = [...kept, ...added];
			if (
				next.length === prev.length &&
				next.every((p, i) => p.id === prev[i].id)
			)
				return prev;
			return next;
		});
	}

	function toggleResting(playerId: string) {
		const isResting = resting.some((p) => p.id === playerId);
		if (isResting) {
			const player = resting.find((p) => p.id === playerId);
			if (!player) return;
			setResting((prev) => prev.filter((p) => p.id !== playerId));
			setWaiting((prev) => [...prev, player]);
		} else {
			const player = waiting.find((p) => p.id === playerId);
			if (!player) return;
			setWaiting((prev) => prev.filter((p) => p.id !== playerId));
			setResting((prev) => [...prev, player]);
		}
	}

	function handleGenerate() {
		const team = generateTeam(
			waiting,
			history,
			mixedHistory,
			gameCountHistory,
			settings.singleWomanIds,
		);
		if (!team) return;
		setPendingTeam(team);
		setPendingGroupId(null);
	}

	function handleAssignGroup(groupId: string) {
		const group = reservedGroups.find((g) => g.id === groupId);
		if (!group || group.players.length !== 4 || group.readyIds.length !== 4)
			return;
		const team = generateTeamFromPlayers(
			group.players as [Player, Player, Player, Player],
			history,
			settings.singleWomanIds,
		);
		setPendingTeam(team);
		setPendingGroupId(groupId);
	}

	function handleAssign(courtId: number) {
		if (!pendingTeam) return;
		const assigned = [...pendingTeam.teamA, ...pendingTeam.teamB];
		console.log("[handleAssign] 코트", courtId, "배정");
		setCourts((prev) =>
			prev.map((c) => (c.id === courtId ? { ...c, team: pendingTeam } : c)),
		);
		setWaiting((prev) =>
			prev.filter((p) => !assigned.some((a) => a.id === p.id)),
		);
		setHistory((prev) => recordHistory(prev, pendingTeam));
		setMixedHistory((prev) => recordMixedHistory(prev, pendingTeam));
		setGameCountHistory((prev) => recordGameCount(prev, pendingTeam));
		if (pendingGroupId) {
			setReservedGroups((prev) => prev.filter((g) => g.id !== pendingGroupId));
			setPendingGroupId(null);
		}
		setPendingTeam(null);
	}

	function handleComplete(courtId: number) {
		const court = courts.find((c) => c.id === courtId);
		if (!court?.team) return;
		const returning = [...court.team.teamA, ...court.team.teamB];
		setCourts((prev) =>
			prev.map((c) => (c.id === courtId ? { ...c, team: null } : c)),
		);

		const reservedGroupPlayerIds = new Set(
			reservedGroups.flatMap((g) => g.players.map((p) => p.id)),
		);
		const toReserved = returning.filter((p) =>
			reservedGroupPlayerIds.has(p.id),
		);
		const toWaiting = returning.filter(
			(p) => !reservedGroupPlayerIds.has(p.id),
		);

		if (toReserved.length > 0) {
			setReservedGroups((prev) =>
				prev.map((g) => {
					const newReady = [...g.readyIds];
					for (const p of toReserved) {
						if (
							g.players.some((gp) => gp.id === p.id) &&
							!newReady.includes(p.id)
						) {
							newReady.push(p.id);
						}
					}
					return { ...g, readyIds: newReady };
				}),
			);
		}

		setWaiting((prev) => [...prev, ...toWaiting]);
	}

	function handleCreateReservation() {
		if (reservingSelected.size < 2 || reservingSelected.size > 4) return;

		const waitingIds = new Set(waiting.map((p) => p.id));
		const onCourtPlayers = courts.flatMap((c) =>
			c.team ? [...c.team.teamA, ...c.team.teamB] : [],
		);
		const allPlayers = [...waiting, ...onCourtPlayers];
		const players = allPlayers.filter((p) => reservingSelected.has(p.id));
		const readyIds = [...reservingSelected].filter((id) => waitingIds.has(id));

		const groupId = `reserved-${Date.now()}`;
		setReservedGroups((prev) => [...prev, { id: groupId, players, readyIds }]);
		setWaiting((prev) => prev.filter((p) => !reservingSelected.has(p.id)));
		setReservingSelected(new Set());
		setShowReserveModal(false);
	}

	function handleDisbandGroup(groupId: string) {
		const group = reservedGroups.find((g) => g.id === groupId);
		if (!group) return;
		const readyPlayers = group.players.filter((p) =>
			group.readyIds.includes(p.id),
		);
		setWaiting((prev) => [...prev, ...readyPlayers]);
		setReservedGroups((prev) => prev.filter((g) => g.id !== groupId));
	}

	function toggleReservingPlayer(playerId: string) {
		setReservingSelected((prev) => {
			const next = new Set(prev);
			if (next.has(playerId)) {
				next.delete(playerId);
			} else if (next.size < 4) {
				next.add(playerId);
			}
			return next;
		});
	}

	const canGenerate =
		waiting.length >= 4 && courts.some((c) => c.team === null);
	const canReserve = (() => {
		const onCourtCount = courts.reduce((n, c) => n + (c.team ? 4 : 0), 0);
		return waiting.length + onCourtCount >= 2;
	})();

	const reservedPlayerIds = new Set(
		reservedGroups.flatMap((g) => g.players.map((p) => p.id)),
	);
	const onCourtPlayers = courts.flatMap((c) =>
		c.team ? [...c.team.teamA, ...c.team.teamB] : [],
	);
	const courtPlayerMap = new Map<string, number>();
	courts.forEach((c) => {
		if (c.team) {
			[...c.team.teamA, ...c.team.teamB].forEach((p) =>
				courtPlayerMap.set(p.id, c.id),
			);
		}
	});
	const modalPlayers = [
		...waiting.filter((p) => !reservedPlayerIds.has(p.id)),
		...onCourtPlayers.filter((p) => !reservedPlayerIds.has(p.id)),
	];

	return (
		<div className="lq-bg min-h-[100dvh] flex flex-col md:max-w-sm md:mx-auto">
			<SessionHeader
				onBack={onBack}
				onEndClick={() => setShowEndConfirm(true)}
			/>

			<div className="flex-1 overflow-y-auto no-sb p-4 space-y-3">
				<CourtList courts={courts} onComplete={handleComplete} />

				<ReservedList
					reservedGroups={reservedGroups}
					courtPlayerMap={courtPlayerMap}
					hasEmptyCourt={courts.some((c) => c.team === null)}
					onDisband={handleDisbandGroup}
					onAssign={handleAssignGroup}
				/>

				<WaitingList
					waiting={waiting}
					gameCountHistory={gameCountHistory}
					onToggleResting={toggleResting}
				/>

				<RestingList resting={resting} onToggleResting={toggleResting} />
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
