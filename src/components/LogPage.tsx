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
import { useAppStore } from "../store/appStore";
import type { Gender } from "../types";
import ClearConfirmModal from "./log/ClearConfirmModal";
import LogList from "./log/LogList";
import MatchSummary from "./log/MatchSummary";
import SessionSelector from "./log/SessionSelector";

export default function LogPage() {
	const navigate = useNavigate();
	const sessionMeta = useAppStore((s) => s.sessionMeta);
	const loadSessionAction = useAppStore((s) => s.loadSessionAction);

	const [sessions, setSessions] = useState<SessionRow[]>([]);
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const [logs, setLogs] = useState<MatchLogEntry[]>([]);
	const [participants, setParticipants] = useState<
		{ name: string; gender: Gender; game_count: number }[]
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
			if (row) await loadSessionAction(row);
		}
		setClearing(false);
		setShowClearConfirm(false);
	}, [selectedId, loadSessionAction]);

	return (
		<div
			className="md:max-w-sm md:mx-auto bg-[#fafbff] dark:bg-[#0f172a]"
			style={{ minHeight: "100dvh" }}
		>
			{/* Header */}
			<div
				className="flex items-center justify-between px-4 bg-white dark:bg-[#1c1c1e] border-b border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]"
				style={{
					position: "sticky",
					top: 0,
					zIndex: 50,
					height: "calc(60px + env(safe-area-inset-top))",
					paddingTop: "env(safe-area-inset-top)",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<button
						type="button"
						onClick={() => navigate(-1)}
						className="bg-[rgba(241,245,249,1)] dark:bg-[rgba(255,255,255,0.1)] text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
						style={{
							width: 32,
							height: 32,
							borderRadius: "50%",
							border: "none",
							cursor: "pointer",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: 20,
							flexShrink: 0,
						}}
					>
						‹
					</button>
					<span
						className="font-bold tracking-tight text-[#0f1724] dark:text-white"
						style={{ fontSize: 18 }}
					>
						매치 로그
					</span>
				</div>

				{isCurrentSession && (
					<button
						type="button"
						onClick={() => setShowClearConfirm(true)}
						style={{
							fontSize: 13,
							fontWeight: 500,
							color: "#ef4444",
							background: "none",
							border: "none",
							padding: "5px 8px",
							cursor: "pointer",
						}}
					>
						클리어
					</button>
				)}
			</div>

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

			<style>{`
				@keyframes spin {
					to { transform: rotate(360deg); }
				}
			`}</style>
		</div>
	);
}
