import { ClipboardList } from "lucide-react";
import type { MatchLogEntry } from "../../lib/supabase/api";
import Spinner from "../shared/Spinner";
import MatchCard from "./MatchCard";

interface LogListProps {
	logLoading: boolean;
	logs: MatchLogEntry[];
}

export default function LogList({ logLoading, logs }: LogListProps) {
	return (
		<div style={{ padding: "16px", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
			{logLoading ? (
				<div
					style={{
						display: "flex",
						justifyContent: "center",
						paddingTop: 40,
					}}
				>
					<Spinner size={20} />
				</div>
			) : logs.length === 0 ? (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						paddingTop: 60,
						gap: 10,
					}}
				>
					<ClipboardList size={40} color="#64748b" />
					<span style={{ fontSize: 14, color: "#98a0ab" }}>
						기록된 매치가 없습니다
					</span>
				</div>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
					{logs.map((log, i) => (
						<MatchCard key={log.id} log={log} index={logs.length - i} />
					))}
				</div>
			)}
		</div>
	);
}
