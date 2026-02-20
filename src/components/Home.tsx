import { useEffect, useState } from "react";
import { fetchPlayers } from "../lib/sheetsApi";
import type { Player } from "../types";

interface Props {
	onStart: (players: Player[], scriptUrl: string) => void;
}

const ENV_SHEET_ID = import.meta.env.VITE_SHEET_ID as string;
const ENV_API_KEY = import.meta.env.VITE_API_KEY as string;
const ENV_SCRIPT_URL = (import.meta.env.VITE_SCRIPT_URL as string) ?? "";

export default function Home({ onStart }: Props) {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [connected, setConnected] = useState(false);
	const [players, setPlayers] = useState<Player[]>([]);

	async function connect() {
		setLoading(true);
		setError("");
		try {
			const data = await fetchPlayers(ENV_SHEET_ID, ENV_API_KEY);
			setPlayers(data);
			setConnected(true);
		} catch (e) {
			setError(e instanceof Error ? e.message : "연동 실패");
		} finally {
			setLoading(false);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: 초기화
	useEffect(() => {
		connect();
	}, []);

	return (
		<div
			className="min-h-[100dvh] flex flex-col items-center justify-center p-6"
			style={{ background: "#fafbff" }}
		>
			<div className="w-full max-w-sm flex flex-col gap-4">
				{/* Logo */}
				<div className="flex flex-col items-center mb-6">
					<img
						src="main.png"
						className="w-20 h-20 object-contain mb-5"
						style={{ filter: "drop-shadow(0 4px 12px rgba(11,132,255,0.15))" }}
						alt="콕타임"
					/>
					<h1
						className="font-bold tracking-tight"
						style={{ fontSize: 28, color: "#0f1724", marginBottom: 6 }}
					>
						콕타임 팀매칭
					</h1>
					<p style={{ fontSize: 14, color: "#64748b", fontWeight: 500 }}>
						스마트 배드민턴 코트 배정
					</p>
				</div>

				{/* Status card */}
				<div
					style={{
						background: "#ffffff",
						borderRadius: 12,
						border: "1px solid rgba(0,0,0,0.06)",
						padding: "16px 20px",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						minHeight: 56,
					}}
				>
					{loading ? (
						<div className="flex items-center gap-2">
							<div
								style={{
									width: 16,
									height: 16,
									borderRadius: "50%",
									border: "2px solid rgba(11,132,255,0.3)",
									borderTopColor: "#0b84ff",
									animation: "spin 0.8s linear infinite",
								}}
							/>
							<p style={{ fontSize: 14, color: "#64748b", fontWeight: 500 }}>
								시트 불러오는 중…
							</p>
						</div>
					) : connected ? (
						<div className="flex items-center gap-2">
							<span
								style={{
									width: 8,
									height: 8,
									borderRadius: "50%",
									background: "#34c759",
									boxShadow: "0 0 6px rgba(52,199,89,0.6)",
									flexShrink: 0,
								}}
							/>
							<p style={{ fontSize: 14, fontWeight: 600, color: "#166534" }}>
								연동됨 — {players.length}명
							</p>
						</div>
					) : (
						<div className="flex flex-col items-center gap-2">
							<p style={{ fontSize: 14, color: "#ef4444", fontWeight: 500 }}>
								{error}
							</p>
							<button
								type="button"
								onClick={() => connect()}
								style={{
									fontSize: 14,
									fontWeight: 600,
									color: "#0b84ff",
									background: "none",
									border: "none",
									cursor: "pointer",
									padding: "2px 8px",
								}}
							>
								재시도
							</button>
						</div>
					)}
				</div>

				{/* CTA */}
				<button
					type="button"
					onClick={() => connected && onStart(players, ENV_SCRIPT_URL)}
					disabled={!connected}
					style={{
						width: "100%",
						padding: "16px",
						borderRadius: 12,
						fontSize: 17,
						fontWeight: 600,
						color: "#fff",
						background: connected ? "#0b84ff" : "rgba(11,132,255,0.35)",
						border: "none",
						cursor: connected ? "pointer" : "not-allowed",
						boxShadow: connected ? "0 4px 16px rgba(11,132,255,0.3)" : "none",
						transition: "opacity 0.2s",
					}}
				>
					세션 시작
				</button>
			</div>

			<style>{`
				@keyframes spin {
					to { transform: rotate(360deg); }
				}
			`}</style>
		</div>
	);
}
