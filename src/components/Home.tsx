import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/appStore";

interface Props {
	onStart: () => void;
}

export default function Home({ onStart }: Props) {
	const navigate = useNavigate();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [connected, setConnected] = useState(false);
	const players = useAppStore((s) => s.allPlayers);
	const sessionMeta = useAppStore((s) => s.sessionMeta);
	const fetchPlayersAction = useAppStore((s) => s.fetchPlayersAction);

	const connect = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			await fetchPlayersAction();
			setConnected(true);
		} catch (e) {
			setError(e instanceof Error ? e.message : "연동 실패");
		} finally {
			setLoading(false);
		}
	}, [fetchPlayersAction]);

	useEffect(() => {
		connect();
	}, [connect]);

	return (
		<div
			className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#fafbff] dark:bg-[#0f172a]"
			style={{
				padding: "1.5rem",
				paddingTop: "max(1.5rem, env(safe-area-inset-top))",
				paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
			}}
		>
			<div className="w-full max-w-sm flex flex-col gap-4">
				{/* Logo */}
				<div className="flex flex-col items-center mb-6">
					<img
						src="main.png"
						className="w-20 h-20 object-contain mb-5 drop-shadow-[0_4px_12px_rgba(11,132,255,0.15)] dark:[filter:brightness(0)_invert(1)_drop-shadow(0_4px_16px_rgba(255,255,255,0.2))]"
						alt="콕타임"
					/>
					<h1
						className="font-bold tracking-tight text-[#0f1724] dark:text-white"
						style={{ fontSize: 28, marginBottom: 6 }}
					>
						콕타임 팀매칭
					</h1>
					<p className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]" style={{ fontSize: 14, fontWeight: 500 }}>
						스마트 배드민턴 코트 배정
					</p>
				</div>

				{/* Status card */}
				<div
					className="bg-white dark:bg-[rgba(30,30,35,0.8)] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.1)]"
					style={{
						borderRadius: 12,
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
							<p className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]" style={{ fontSize: 14, fontWeight: 500 }}>
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
							<p className="text-[#166534] dark:text-[#30d158]" style={{ fontSize: 14, fontWeight: 600 }}>
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
					onClick={() => {
						if (!connected) return;
						if (sessionMeta) {
							navigate("/session");
						} else {
							onStart();
						}
					}}
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
					{sessionMeta ? "세션 이어하기" : "세션 시작"}
				</button>

				{/* Log link */}
				<button
					type="button"
					onClick={() => navigate("/logs")}
					className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
					style={{
						background: "none",
						border: "none",
						fontSize: 13,
						fontWeight: 500,
						cursor: "pointer",
						padding: "4px 0",
						alignSelf: "center",
					}}
				>
					매치 로그 보기
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
