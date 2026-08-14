import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	fetchAllSessions,
	fetchMatchLogs,
	fetchSessionPlayers,
	type MatchLogEntry,
	type SessionParticipant,
} from "../lib/supabase/api";
import type { SessionRow } from "../lib/supabase/types";
import AppHeader from "./common/AppHeader";
import LogList from "./log/LogList";
import MatchSummary from "./log/MatchSummary";
import SessionSelector from "./log/SessionSelector";

export default function LogPage() {
	const navigate = useNavigate();

	const [sessions, setSessions] = useState<SessionRow[]>([]);
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const [logs, setLogs] = useState<MatchLogEntry[]>([]);
	const [participants, setParticipants] = useState<SessionParticipant[]>([]);
	const [loading, setLoading] = useState(true);
	const [logLoading, setLogLoading] = useState(false);

	useEffect(() => {
		fetchAllSessions().then((rows) => {
			setSessions(rows);
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

	return (
		<div className="app-shell-minh bg-[#fafbff] dark:bg-[#0f172a]">
			<AppHeader title="매치 로그" onBack={() => navigate(-1)} />

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
		</div>
	);
}
