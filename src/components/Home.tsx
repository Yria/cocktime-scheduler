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
		<div className="lq-bg min-h-[100dvh] flex flex-col items-center justify-center p-6">
			<div className="w-full max-w-sm">
				{/* Logo */}
				<div className="text-center mb-10">
					<div className="relative inline-block mb-5">
						<div
							className="absolute inset-0 rounded-full blur-2xl opacity-30"
							style={{
								background: "radial-gradient(circle, #60b4ff, transparent)",
							}}
						/>
						<img
							src="main.png"
							className="relative w-24 h-24 object-contain mix-blend-multiply dark:invert dark:mix-blend-screen"
							alt="콕타임"
						/>
					</div>
					<h1 className="text-[1.7rem] font-bold text-gray-900 dark:text-white tracking-tight">
						콕타임 팀매칭
					</h1>
					<p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5 font-medium">
						스마트 배드민턴 코트 배정
					</p>
				</div>

				{/* Status card */}
				<div className="glass rounded-3xl px-5 py-4 mb-4 text-center">
					{loading ? (
						<div className="flex items-center justify-center gap-2">
							<div
								className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
								style={{
									borderColor: "rgba(0,122,255,0.4)",
									borderTopColor: "transparent",
								}}
							/>
							<p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
								시트 불러오는 중…
							</p>
						</div>
					) : connected ? (
						<div className="flex items-center justify-center gap-2">
							<span
								className="w-2 h-2 rounded-full flex-shrink-0"
								style={{
									background: "#28c750",
									boxShadow: "0 0 6px rgba(40,199,80,0.7)",
								}}
							/>
							<p className="text-sm font-semibold" style={{ color: "#28c750" }}>
								연동됨 — {players.length}명
							</p>
						</div>
					) : (
						<div>
							<p className="text-sm text-red-500 dark:text-red-400 font-medium">
								{error}
							</p>
							<button
								type="button"
								onClick={() => connect()}
								className="mt-3 text-sm font-semibold"
								style={{ color: "#007aff" }}
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
					className="btn-lq-primary w-full py-4 text-lg"
				>
					세션 시작
				</button>
			</div>
		</div>
	);
}
