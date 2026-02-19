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

	useEffect(() => {
		connect();
	}, []);

	return (
		<div className="min-h-[100dvh] bg-[#ebebf0] dark:bg-[#1c1c1e] flex flex-col items-center justify-center p-6">
			<div className="w-full max-w-sm">
				<div className="text-center mb-10">
					<img src="main.png" className="mix-blend-multiply dark:invert dark:mix-blend-screen mx-auto" />
					<h1 className="text-2xl font-bold text-gray-800 dark:text-white">콕타임 팀매칭</h1>
				</div>

				<div className="bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-4 text-center">
					{loading ? (
						<p className="text-sm text-gray-400 dark:text-gray-500">시트 불러오는 중...</p>
					) : connected ? (
						<p className="text-sm text-green-600 dark:text-green-400 font-medium">
							✓ 연동됨 ({players.length}명)
						</p>
					) : (
						<p className="text-sm text-red-500 dark:text-red-400">{error}</p>
					)}
					{error && (
						<button
							onClick={() => connect()}
							className="mt-3 text-sm text-blue-500 font-medium"
						>
							재시도
						</button>
					)}
				</div>

				<button
					onClick={() => connected && onStart(players, ENV_SCRIPT_URL)}
					disabled={!connected}
					className="w-full bg-blue-500 text-white rounded-2xl py-4 text-lg font-bold shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
				>
					세션 시작
				</button>
			</div>
		</div>
	);
}
