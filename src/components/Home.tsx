import { useState, useEffect } from "react";
import { fetchPlayers } from "../lib/sheetsApi";
import type { Player } from "../types";

interface Props {
	onStart: (players: Player[], scriptUrl: string) => void;
}

const STORAGE_KEY_SHEET_ID = "bmt_sheet_id";
const STORAGE_KEY_API_KEY = "bmt_api_key";
const STORAGE_KEY_SCRIPT_URL = "bmt_script_url";

const ENV_SHEET_ID = import.meta.env.VITE_SHEET_ID as string | undefined;
const ENV_API_KEY = import.meta.env.VITE_API_KEY as string | undefined;
const ENV_SCRIPT_URL = import.meta.env.VITE_SCRIPT_URL as string | undefined;

const USE_ENV = !!(ENV_SHEET_ID && ENV_API_KEY);

export default function Home({ onStart }: Props) {
	const [sheetId, setSheetId] = useState(
		localStorage.getItem(STORAGE_KEY_SHEET_ID) ?? "",
	);
	const [apiKey, setApiKey] = useState(
		localStorage.getItem(STORAGE_KEY_API_KEY) ?? "",
	);
	const [scriptUrl, setScriptUrl] = useState(
		localStorage.getItem(STORAGE_KEY_SCRIPT_URL) ?? "",
	);
	const [loading, setLoading] = useState(USE_ENV);
	const [error, setError] = useState("");
	const [connected, setConnected] = useState(false);
	const [players, setPlayers] = useState<Player[]>([]);

	async function connect(sid: string, akey: string) {
		setLoading(true);
		setError("");
		try {
			const data = await fetchPlayers(sid, akey);
			setPlayers(data);
			setConnected(true);
		} catch (e) {
			setError(e instanceof Error ? e.message : "연동 실패");
		} finally {
			setLoading(false);
		}
	}

	// env 변수가 있으면 마운트 시 자동 연결
	useEffect(() => {
		if (USE_ENV) {
			connect(ENV_SHEET_ID!, ENV_API_KEY!);
		}
	}, []);

	async function handleConnect() {
		if (!sheetId.trim() || !apiKey.trim()) {
			setError("시트 ID와 API Key를 입력하세요.");
			return;
		}
		await connect(sheetId.trim(), apiKey.trim());
		localStorage.setItem(STORAGE_KEY_SHEET_ID, sheetId.trim());
		localStorage.setItem(STORAGE_KEY_API_KEY, apiKey.trim());
		localStorage.setItem(STORAGE_KEY_SCRIPT_URL, scriptUrl.trim());
	}

	return (
		<div className="min-h-[100dvh] bg-[#ebebf0] flex flex-col items-center justify-center p-6">
			<div className="w-full max-w-sm">
				<div className="text-center mb-10">
					<img src="main.jpeg" />
					<h1 className="text-2xl font-bold text-gray-800">콕타임 팀매칭</h1>
				</div>

				{USE_ENV ? (
					/* env 변수로 빌드된 경우: 입력 폼 숨김 */
					<div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4 text-center">
						{loading ? (
							<p className="text-sm text-gray-400">시트 불러오는 중...</p>
						) : connected ? (
							<p className="text-sm text-green-600 font-medium">
								✓ 연동됨 ({players.length}명)
							</p>
						) : (
							<p className="text-sm text-red-500">{error}</p>
						)}
						{error && (
							<button
								onClick={() => connect(ENV_SHEET_ID!, ENV_API_KEY!)}
								className="mt-3 text-sm text-blue-500 font-medium"
							>
								재시도
							</button>
						)}
					</div>
				) : (
					/* 수동 입력 모드 */
					<div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4 mb-4">
						<p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
							구글시트 연동
						</p>

						<div>
							<label className="text-sm text-gray-600 mb-1 block">
								스프레드시트 ID
							</label>
							<input
								type="text"
								value={sheetId}
								onChange={(e) => {
									setSheetId(e.target.value);
									setConnected(false);
								}}
								placeholder="1BxiM..."
								className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
							/>
						</div>

						<div>
							<label className="text-sm text-gray-600 mb-1 block">
								API Key
							</label>
							<input
								type="password"
								value={apiKey}
								onChange={(e) => {
									setApiKey(e.target.value);
									setConnected(false);
								}}
								placeholder="AIzaSy..."
								className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
							/>
						</div>

						<div>
							<label className="text-sm text-gray-600 mb-1 block">
								Apps Script URL (선택)
							</label>
							<input
								type="text"
								value={scriptUrl}
								onChange={(e) => setScriptUrl(e.target.value)}
								placeholder="https://script.google.com/macros/s/..."
								className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
							/>
						</div>

						{error && <p className="text-red-500 text-sm">{error}</p>}

						<button
							onClick={handleConnect}
							disabled={loading}
							className="w-full bg-gray-800 text-white rounded-xl py-3 font-medium text-sm disabled:opacity-50"
						>
							{loading
								? "연동 중..."
								: connected
									? `✓ 연동됨 (${players.length}명)`
									: "연동 확인"}
						</button>
					</div>
				)}

				<button
					onClick={() =>
						connected &&
						onStart(players, USE_ENV ? (ENV_SCRIPT_URL ?? "") : scriptUrl)
					}
					disabled={!connected}
					className="w-full bg-blue-500 text-white rounded-2xl py-4 text-lg font-bold shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
				>
					세션 시작
				</button>
			</div>
		</div>
	);
}
