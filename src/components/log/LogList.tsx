import type { MatchLogEntry } from "../../lib/supabase/api";
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
					<div
						style={{
							width: 20,
							height: 20,
							borderRadius: "50%",
							border: "2px solid rgba(11,132,255,0.3)",
							borderTopColor: "#0b84ff",
							animation: "spin 0.8s linear infinite",
						}}
					/>
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
					<svg
						width="40"
						height="40"
						viewBox="0 0 40 40"
						fill="none"
						aria-hidden="true"
					>
						<rect
							x="8"
							y="6"
							width="24"
							height="28"
							rx="3"
							stroke="#98a0ab"
							strokeWidth="1.5"
							fill="none"
						/>
						<line
							x1="13"
							y1="14"
							x2="27"
							y2="14"
							stroke="#98a0ab"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
						<line
							x1="13"
							y1="19"
							x2="27"
							y2="19"
							stroke="#98a0ab"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
						<line
							x1="13"
							y1="24"
							x2="20"
							y2="24"
							stroke="#98a0ab"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
					</svg>
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
