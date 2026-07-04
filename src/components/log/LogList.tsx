import { ClipboardList } from "lucide-react";
import type { MatchLogEntry } from "../../lib/supabase/api";
import EmptyState from "../shared/EmptyState";
import MatchCard from "./MatchCard";

interface LogListProps {
	logLoading: boolean;
	logs: MatchLogEntry[];
}

export default function LogList({ logLoading, logs }: LogListProps) {
	return (
		<div style={{ padding: "16px", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
			{logLoading ? (
				<EmptyState loading style={{ padding: "40px 0 0" }} />
			) : logs.length === 0 ? (
				<EmptyState
					icon={<ClipboardList size={40} color="#64748b" />}
					style={{ padding: "60px 0 0", fontSize: 14 }}
				>
					기록된 매치가 없습니다
				</EmptyState>
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
