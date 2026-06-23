import { memo, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import ModalSheet from "../common/ModalSheet";
import { useSessionStore } from "../../store/sessionStore";
import { useBoardStore } from "../../store/boardStore";
import { TOOLBAR_H } from "../../lib/board/constants";

export { TOOLBAR_H };

const iconBtn = (color: string): React.CSSProperties => ({
	display: "inline-flex",
	alignItems: "center",
	gap: 4,
	padding: "6px 8px",
	borderRadius: 8,
	border: "none",
	background: "transparent",
	color,
	fontSize: 13,
	fontWeight: 500,
	cursor: "pointer",
});

const BoardToolbar = memo(function BoardToolbar() {
	const navigate = useNavigate();
	const handleEndSession = useSessionStore((s) => s.handleEndSession);
	const courts = useSessionStore((s) => s.courts);
	const isEditor = useSessionStore((s) => s.isEditor);
	const lockFree = useSessionStore((s) => s.lockFree);
	const holderName = useSessionStore((s) => s.holderName);
	const holderClientId = useSessionStore((s) => s.holderClientId);
	const presenceCount = useSessionStore((s) => s.presenceCount);
	const presenceList = useSessionStore((s) => s.presenceList);
	const myClientId = useSessionStore((s) => s._clientId);
	const claimEditor = useSessionStore((s) => s.claimEditor);
	const handoffEditor = useSessionStore((s) => s.handoffEditor);
	// 모달 표시는 공유 플래그(헤더 칩 + 보기전용 칩 둘 다 연다)
	const showPresence = useBoardStore((s) => s.presenceModalOpen);
	const setShowPresence = useBoardStore((s) => s.setPresenceModalOpen);
	// 팀 소속 자석 드래그 중에는 네비 위에 detach 드롭존 오버레이(반투명)가 뜬다 → 그 사이로 네비 글자가
	// 비쳐 보이므로, 드래그 동안 네비 내용을 숨긴다(드롭존 디자인은 유지, 글자만 가림). DetachZoneOverlay의 노출 조건과 동일.
	const draggingTeamBound = useBoardStore((s) => s.dragInfo?.detachable ?? false);
	const [confirmEnd, setConfirmEnd] = useState(false);
	// 다른 기기가 편집 중일 때 권한을 "뺏는" 경우만 경고 확인. 빈 자리(자유) 점유는 경고 없음.
	const [confirmTakeover, setConfirmTakeover] = useState(false);

	const onConfirmEnd = useCallback(() => {
		setConfirmEnd(false);
		handleEndSession(() => navigate("/"));
	}, [handleEndSession, navigate]);

	const onTakeover = useCallback(() => {
		// 빈 자리(자유) 가져오기는 남을 쫓아내지 않으므로 경고 없이 즉시 점유.
		if (lockFree || holderClientId === null) {
			claimEditor();
			setShowPresence(false);
			return;
		}
		// 남이 편집 중 → 강제 탈취. 확인 경고를 띄운다(상대는 보기 전용으로 떨어짐).
		setShowPresence(false);
		setConfirmTakeover(true);
	}, [lockFree, holderClientId, claimEditor, setShowPresence]);

	const onConfirmTakeover = useCallback(() => {
		setConfirmTakeover(false);
		claimEditor();
	}, [claimEditor]);

	const onHandoff = useCallback(
		(toClientId: string, toName: string) => {
			void handoffEditor(toClientId, toName);
			setShowPresence(false);
		},
		[handoffEditor, setShowPresence],
	);

	return (
		<>
			<div
				className="lq-header"
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					height: `calc(${TOOLBAR_H}px + env(safe-area-inset-top))`,
					display: "flex",
					alignItems: "center",
					padding: "env(safe-area-inset-top) 8px 0",
					zIndex: 10,
					// detach 드롭존이 뜨는 동안 네비 글자가 반투명 오버레이 사이로 비치지 않게 숨김.
					opacity: draggingTeamBound ? 0 : 1,
					pointerEvents: draggingTeamBound ? "none" : undefined,
					transition: "opacity 0.12s ease",
				}}
			>
				<button
					type="button"
					onClick={() => navigate("/setup")}
					aria-label="세션 설정"
					style={iconBtn("var(--text-secondary)")}
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
					</svg>
					<span>설정</span>
				</button>

				{/* 코트 현황(중앙) — 비어있음(초록)/경기중(주황) */}
				<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, minWidth: 0, overflow: "hidden" }}>
					{courts.map((court) => {
						const empty = !court.match;
						const dotColor = empty ? "var(--ios-green)" : "var(--ios-orange)";
						return (
							<span
								key={court.id}
								title={empty ? `${court.id}번 코트 · 비어있음` : `${court.id}번 코트 · 경기중`}
								style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
							>
								<span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, display: "inline-block" }} />
								<span style={{ color: empty ? "var(--text-secondary)" : dotColor, fontSize: 11, fontWeight: 600 }}>{court.id}번</span>
							</span>
						);
					})}
				</div>

				<button
					type="button"
					onClick={() => navigate("/logs")}
					aria-label="로그"
					style={iconBtn("var(--text-secondary)")}
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
						<polyline points="14 2 14 8 20 8" />
						<line x1="8" y1="13" x2="16" y2="13" />
						<line x1="8" y1="17" x2="13" y2="17" />
					</svg>
					<span>로그</span>
				</button>

				{/* 세션 종료는 편집자만 */}
				{isEditor && (
					<button
						type="button"
						onClick={() => setConfirmEnd(true)}
						aria-label="세션 종료"
						style={iconBtn("var(--ios-red)")}
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
							<polyline points="16 17 21 12 16 7" />
							<line x1="21" y1="12" x2="9" y2="12" />
						</svg>
						<span>종료</span>
					</button>
				)}
			</div>

			{confirmEnd && (
				<ModalSheet position="center" className="p-6" onClose={() => setConfirmEnd(false)}>
					<h3 className="font-bold text-gray-800 dark:text-white text-lg mb-1.5">
						세션 종료
					</h3>
					<p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
						{courts.some((c) => c.match)
							? "진행 중인 경기는 자동으로 종료 처리된 뒤 세션이 종료됩니다. 모든 참가자의 세션이 종료됩니다."
							: "진행 중인 세션을 종료합니다. 모든 참가자의 세션이 종료됩니다."}
					</p>
					<div className="flex gap-3">
						<button
							type="button"
							onClick={() => setConfirmEnd(false)}
							className="btn-lq-secondary flex-1 py-3 text-sm"
						>
							취소
						</button>
						<button
							type="button"
							onClick={onConfirmEnd}
							className="btn-lq-red flex-1 py-3 text-sm"
						>
							종료
						</button>
					</div>
				</ModalSheet>
			)}

			{confirmTakeover && (
				<ModalSheet position="center" className="p-6" onClose={() => setConfirmTakeover(false)}>
					<h3 className="font-bold text-gray-800 dark:text-white text-lg mb-1.5">
						편집 권한 가져오기
					</h3>
					<p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
						{holderName ?? "다른 기기"}님이 편집 중입니다. 권한을 가져오면 상대는 보기 전용이 되어 편집할 수 없게 됩니다.
					</p>
					<div className="flex gap-3">
						<button
							type="button"
							onClick={() => setConfirmTakeover(false)}
							className="btn-lq-secondary flex-1 py-3 text-sm"
						>
							취소
						</button>
						<button
							type="button"
							onClick={onConfirmTakeover}
							className="btn-lq-primary flex-1 py-3 text-sm"
						>
							가져오기
						</button>
					</div>
				</ModalSheet>
			)}

			{showPresence && (
				<ModalSheet position="center" className="p-6" onClose={() => setShowPresence(false)}>
					<div className="flex items-center justify-between mb-3">
						<h3 className="font-bold text-gray-800 dark:text-white text-lg">
							접속 기기 {Math.max(1, presenceCount)}
						</h3>
						<button type="button" onClick={() => setShowPresence(false)} className="btn-icon-close">✕</button>
					</div>
					<ul className="flex flex-col gap-1.5 mb-4">
						{presenceList.map((d) => {
							const isMe = d.clientId === myClientId;
							const holds = d.clientId === holderClientId;
							return (
								<li
									key={d.clientId}
									className="flex items-center justify-between rounded-lg px-3 py-2 bg-gray-50 dark:bg-white/5"
								>
									<span className={`text-sm ${isMe ? "font-bold text-blue-600 dark:text-blue-400" : "font-medium text-gray-800 dark:text-gray-100"}`}>
										{d.name}{isMe ? " (나)" : ""}
									</span>
									<span className="flex items-center gap-1.5">
										{holds && (
											<span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
												편집 중
											</span>
										)}
										{/* 내가 편집자이고 상대가 다른 기기면 편집권 넘기기(서버 권위 양도). */}
										{isEditor && !isMe && (
											<button
												type="button"
												onClick={() => onHandoff(d.clientId, d.name)}
												className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-500/15 dark:text-blue-300"
											>
												넘기기
											</button>
										)}
									</span>
								</li>
							);
						})}
					</ul>
					<p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
						{lockFree
							? "현재 아무도 편집하지 않습니다. 편집하면 자동으로 권한을 갖습니다."
							: isEditor
								? "내가 편집 권한을 갖고 있습니다."
								: `${holderName ?? "다른 기기"}님이 편집 중입니다. 권한을 가져오면 상대는 보기 전용이 됩니다.`}
					</p>
					{!isEditor && (
						<button type="button" onClick={onTakeover} className="btn-lq-primary w-full py-3 text-sm">
							편집 권한 가져오기
						</button>
					)}
				</ModalSheet>
			)}
		</>
	);
});

export default BoardToolbar;
