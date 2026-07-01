import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	dbClearSessionLogs,
	fetchAllSessions,
	fetchMatchLogs,
	fetchSessionPlayers,
	type MatchLogEntry,
} from "../lib/supabase/api";
import type { SessionRow } from "../lib/supabase/types";
import { appActions, useAppStore } from "../store/appStore";
import type { Gender, PlayerSkills } from "../types";
import AppHeader from "./common/AppHeader";
import ClearConfirmModal from "./log/ClearConfirmModal";
import LogList from "./log/LogList";
import MatchSummary from "./log/MatchSummary";
import SessionSelector from "./log/SessionSelector";

export default function LogPage() {
	const navigate = useNavigate();
	const sessionMeta = useAppStore((s) => s.sessionMeta);

	const [sessions, setSessions] = useState<SessionRow[]>([]);
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const [logs, setLogs] = useState<MatchLogEntry[]>([]);
	const [participants, setParticipants] = useState<
		{ name: string; gender: Gender; game_count: number; skills: PlayerSkills }[]
	>([]);
	const [loading, setLoading] = useState(true);
	const [logLoading, setLogLoading] = useState(false);
	const [showClearConfirm, setShowClearConfirm] = useState(false);
	const [clearing, setClearing] = useState(false);

	const sessionsRef = useRef<SessionRow[]>([]);

	useEffect(() => {
		fetchAllSessions().then((rows) => {
			setSessions(rows);
			sessionsRef.current = rows;
			const activeId = rows.find((s) => s.is_active)?.id ?? rows[0]?.id ?? null;
			setSelectedId(activeId);
			if (activeId !== null) {
				setLogLoading(true);
			}
			setLoading(false);
		});
	}, []);

	useEffect(() => {
		if (selectedId === null) return;
		Promise.all([
			fetchMatchLogs(selectedId),
			fetchSessionPlayers(selectedId),
		]).then(([entries, players]) => {
			setLogs(entries);
			setParticipants(players);
			setLogLoading(false);
		});
	}, [selectedId]);

	const handleSelectSession = useCallback(
		(id: number) => {
			if (id !== selectedId) {
				setSelectedId(id);
				setLogLoading(true);
			}
		},
		[selectedId],
	);

	const selectedSession = sessions.find((s) => s.id === selectedId);
	const isCurrentSession =
		selectedSession?.is_active === true &&
		sessionMeta?.sessionId === selectedId;

	const handleClear = useCallback(async () => {
		if (!selectedId) return;
		setClearing(true);
		const ok = await dbClearSessionLogs(selectedId);
		if (ok) {
			setLogs([]);
			const row = sessionsRef.current.find((s) => s.id === selectedId);
			if (row) await appActions.loadSession(row);
		}
		setClearing(false);
		setShowClearConfirm(false);
	}, [selectedId]);

	return (
		<div
			className="app-shell-minh bg-[#fafbff] dark:bg-[#0f172a]"
		>
			<AppHeader
				title="매치 로그"
				onBack={() => navigate(-1)}
				right={
					isCurrentSession && (
						<button
							type="button"
							onClick={() => setShowClearConfirm(true)}
							style={{
								fontSize: 13,
								fontWeight: 500,
								color: "#ef4444",
								background: "none",
								border: "none",
								padding: "6px 0 6px 8px",
								cursor: "pointer",
							}}
						>
							클리어
						</button>
					)
				}
			/>

			<SessionSelector
				loading={loading}
				sessions={sessions}
				selectedId={selectedId}
				setSelectedId={handleSelectSession}
			/>

			{!loading && selectedId !== null && !logLoading && (
				<MatchSummary logs={logs} participants={participants} />
			)}

			<LogList logLoading={logLoading} logs={logs} />

			{showClearConfirm && (
				<ClearConfirmModal
					clearing={clearing}
					handleClear={handleClear}
					setShowClearConfirm={setShowClearConfirm}
				/>
			)}
		</div>
	);
}
