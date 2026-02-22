import type { ServerSessionSettings } from "../../lib/supabase";
import type { Player } from "../../types";
import ModalSheet from "../common/ModalSheet";

interface SessionConflictDialogProps {
	serverSettings: ServerSessionSettings;
	localCourtCount: number;
	localPlayerIds: string[];
	localSingleWomanIds: string[];
	allPlayers: Player[];
	onForceOverwrite: () => void;
	onCancel: () => void;
}

export function SessionConflictDialog({
	serverSettings,
	localCourtCount,
	localPlayerIds,
	localSingleWomanIds,
	allPlayers,
	onForceOverwrite,
	onCancel,
}: SessionConflictDialogProps) {
	const playerNameMap = new Map([
		...allPlayers.map((p) => [p.id, p.name] as const),
		...serverSettings.playerNames.map((p) => [p.playerId, p.name] as const),
	]);

	const courtCountDiff = localCourtCount !== serverSettings.courtCount;

	const localSet = new Set(localPlayerIds);
	const serverSet = new Set(serverSettings.playerIds);
	const playerDiff =
		localSet.size !== serverSet.size ||
		[...localSet].some((id) => !serverSet.has(id)) ||
		[...serverSet].some((id) => !localSet.has(id));

	const localSingleSet = new Set(localSingleWomanIds);
	const serverSingleSet = new Set(serverSettings.singleWomanIds);
	const singleDiff =
		localSingleWomanIds.length !== serverSettings.singleWomanIds.length ||
		localSingleWomanIds.some((id) => !serverSingleSet.has(id)) ||
		serverSettings.singleWomanIds.some((id) => !localSingleSet.has(id));

	const serverSingleNames = serverSettings.singleWomanIds.map(
		(id) => playerNameMap.get(id) || id,
	);
	const localSingleNames = localSingleWomanIds.map(
		(id) => playerNameMap.get(id) || id,
	);

	// 통합 참가자 목록 (가나다순)
	const allIds = [...new Set([...localPlayerIds, ...serverSettings.playerIds])];
	allIds.sort((a, b) =>
		(playerNameMap.get(a) || a).localeCompare(playerNameMap.get(b) || b),
	);

	return (
		<ModalSheet position="center" onClose={onCancel}>
			<div className="px-5 pt-5 pb-3">
				<div className="flex items-center gap-2 mb-2">
					<span style={{ fontSize: 22 }}>⚠️</span>
					<h3
						className="font-bold text-gray-800 dark:text-white"
						style={{ fontSize: 17 }}
					>
						설정 충돌 감지
					</h3>
				</div>
				<p
					className="text-gray-500 dark:text-gray-400"
					style={{ fontSize: 13 }}
				>
					내가 저장하려는 설정과 서버에 저장된 설정이 다릅니다.
				</p>
			</div>

			<div className="px-5 pb-4 overflow-y-auto" style={{ maxHeight: "50dvh" }}>
				{/* 코트 수 */}
				{courtCountDiff && (
					<DiffSection label="코트 수">
						<DiffRow
							localValue={`${localCourtCount}면`}
							serverValue={`${serverSettings.courtCount}면`}
						/>
					</DiffSection>
				)}

				{/* 혼복 싱글 여성 */}
				{singleDiff && (
					<DiffSection label="혼복 싱글 여성">
						<DiffRow
							localValue={
								localSingleNames.length > 0
									? localSingleNames.join(", ")
									: "없음"
							}
							serverValue={
								serverSingleNames.length > 0
									? serverSingleNames.join(", ")
									: "없음"
							}
						/>
					</DiffSection>
				)}

				{/* 참가자 차이 */}
				{playerDiff && (
					<DiffSection label="참가자">
						<div className="px-3 py-2.5 flex items-start gap-2">
							{/* 서버 (왼쪽) */}
							<div className="flex-1 min-w-0">
								<span
									className="text-xs font-semibold inline-block px-1.5 py-0.5 rounded mb-1.5"
									style={{
										background: "rgba(255,149,0,0.12)",
										color: "#ff9500",
									}}
								>
									서버
								</span>
								<div className="flex flex-wrap gap-1">
									{allIds.map((id) => {
										const onServer = serverSet.has(id);
										const name = playerNameMap.get(id) || id;
										if (onServer) {
											return (
												<span
													key={id}
													className="text-xs px-1.5 py-0.5 rounded-full"
													style={
														!localSet.has(id)
															? {
																	background: "rgba(255,149,0,0.12)",
																	color: "#ff9500",
																	fontWeight: 600,
																}
															: {
																	background: "rgba(0,0,0,0.04)",
																	color: "#888",
																}
													}
												>
													{name}
												</span>
											);
										}
										// 서버에 없음 → dot 플레이스홀더 (이름 크기만큼 공간 확보)
										return (
											<span
												key={id}
												className="text-xs px-1.5 py-0.5 rounded-full"
												style={{
													background: "rgba(0,0,0,0.01)",
													color: "transparent",
													border: "1px dashed #eee",
												}}
											>
												{name}
											</span>
										);
									})}
								</div>
							</div>
							{/* 화살표 */}
							<span
								className="shrink-0 text-base mt-5"
								style={{ color: "#bbb" }}
							>
								→
							</span>
							{/* 내 설정 (오른쪽) */}
							<div className="flex-1 min-w-0">
								<span
									className="text-xs font-semibold inline-block px-1.5 py-0.5 rounded mb-1.5"
									style={{
										background: "rgba(11,132,255,0.1)",
										color: "#007aff",
									}}
								>
									내 설정
								</span>
								<div className="flex flex-wrap gap-1">
									{allIds.map((id) => {
										const onLocal = localSet.has(id);
										const name = playerNameMap.get(id) || id;
										if (onLocal) {
											return (
												<span
													key={id}
													className="text-xs px-1.5 py-0.5 rounded-full"
													style={
														!serverSet.has(id)
															? {
																	background: "rgba(11,132,255,0.12)",
																	color: "#007aff",
																	fontWeight: 600,
																}
															: {
																	background: "rgba(0,0,0,0.04)",
																	color: "#888",
																}
													}
												>
													{name}
												</span>
											);
										}
										// 내 설정에 없음 (서버에만 있음 = 제거됨) → 취소선
										return (
											<span
												key={id}
												className="text-xs px-1.5 py-0.5 rounded-full line-through"
												style={{
													background: "rgba(255,59,48,0.06)",
													color: "#ccc",
												}}
											>
												{name}
											</span>
										);
									})}
								</div>
							</div>
						</div>
					</DiffSection>
				)}
			</div>

			<div
				className="flex flex-col gap-2 px-5 py-4"
				style={{ borderTop: "1px solid var(--border-light)" }}
			>
				<button
					type="button"
					onClick={onForceOverwrite}
					className="btn-lq-primary w-full py-3 text-sm"
				>
					내 설정으로 덮어쓰기
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="btn-lq-secondary w-full py-3 text-sm"
				>
					취소 (설정 화면으로 돌아가기)
				</button>
			</div>
		</ModalSheet>
	);
}

/* ── 공통 비교 UI ─────────────────────────────── */

function DiffSection({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div
			className="mb-3 rounded-xl overflow-hidden"
			style={{ border: "1px solid var(--border-light)" }}
		>
			<div
				className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"
				style={{ background: "rgba(0,0,0,0.03)", color: "#8e8e93" }}
			>
				{label}
			</div>
			{children}
		</div>
	);
}

function DiffRow({
	localValue,
	serverValue,
}: {
	localValue: React.ReactNode;
	serverValue: React.ReactNode;
}) {
	return (
		<div className="px-3 py-2.5 flex items-center gap-2">
			{/* 서버 (현재) */}
			<div className="flex-1 min-w-0 flex items-center gap-1.5">
				<span
					className="text-xs font-semibold shrink-0 px-1.5 py-0.5 rounded"
					style={{ background: "rgba(255,149,0,0.12)", color: "#ff9500" }}
				>
					서버
				</span>
				<span className="text-sm text-gray-700 dark:text-gray-300 truncate">
					{serverValue}
				</span>
			</div>
			{/* 화살표 */}
			<span className="shrink-0 text-base" style={{ color: "#bbb" }}>
				→
			</span>
			{/* 내 설정 (변경하려는) */}
			<div className="flex-1 min-w-0 flex items-center gap-1.5">
				<span
					className="text-xs font-semibold shrink-0 px-1.5 py-0.5 rounded"
					style={{ background: "rgba(11,132,255,0.1)", color: "#007aff" }}
				>
					내 설정
				</span>
				<span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
					{localValue}
				</span>
			</div>
		</div>
	);
}
