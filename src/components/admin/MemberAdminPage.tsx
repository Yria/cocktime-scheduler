import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_SKILLS, SKILL_LEVELS, SKILLS } from "../../lib/constants";
import {
	type AdminMemberRow,
	deleteMember,
	fetchMembersForAdmin,
	grantAdmin,
	revokeAdmin,
	updateMemberSkills,
} from "../../lib/supabase/adminMembers";
import { useAuthStore } from "../../store/authStore";
import AppHeader from "../common/AppHeader";
import GroupSettingsModal from "./GroupSettingsModal";
import type { PlayerSkills } from "../../types";
import { SkillButton } from "../setup/SkillButton";

// 운영진 전용 회원 관리(라우트). 100명+ 대비 가상화 리스트 + 컴팩트 행. 실력 편집은 모달.
// 권한 가드: 클라(여기) + RPC/RLS(서버) 이중. error 키워드로 친절 문구 분기.

const ROW_H = 68; // 가상화 행 높이(px)

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 텍스트에서 키워드와 겹치는 부분을 색 다르게 표시(대소문자 무시). */
function Highlight({ text, kw }: { text: string; kw: string }) {
	const q = kw.trim();
	if (!q) return <>{text}</>;
	const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
	return (
		<>
			{parts.map((p, i) =>
				p.toLowerCase() === q.toLowerCase() ? (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: split 조각은 안정적 인덱스
						key={i}
						style={{
							color: "#0b84ff",
							background: "rgba(11,132,255,0.15)",
							borderRadius: 3,
							fontWeight: 700,
						}}
					>
						{p}
					</span>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: split 조각은 안정적 인덱스
					<span key={i}>{p}</span>
				),
			)}
		</>
	);
}

function genderText(g: AdminMemberRow["gender"]): string {
	return g === "M" ? "남" : g === "F" ? "여" : "";
}

export default function MemberAdminPage() {
	const navigate = useNavigate();
	const ready = useAuthStore((s) => s.ready);
	const isAdmin = useAuthStore((s) => s.isAdmin);
	const myMemberId = useAuthStore((s) => s.memberId);

	const [members, setMembers] = useState<AdminMemberRow[]>([]);
	const [loading, setLoading] = useState(true);
	// 실력 편집 모달 대상 회원 id(null=닫힘) + 편집 중 draft.
	const [skillEditId, setSkillEditId] = useState<string | null>(null);
	const [draft, setDraft] = useState<PlayerSkills>(DEFAULT_SKILLS);
	// 처리 중인 회원 id(중복 클릭 방지).
	const [busyId, setBusyId] = useState<string | null>(null);
	// 검색 키워드(이름/성별/지역 대상)
	const [query, setQuery] = useState("");
	const [showGroupSettings, setShowGroupSettings] = useState(false);
	// 확인 다이얼로그(승급/해제/삭제). null=닫힘.
	const [confirmState, setConfirmState] = useState<{
		message: string;
		danger?: boolean;
		run: () => void | Promise<void>;
	} | null>(null);

	const parentRef = useRef<HTMLDivElement>(null);

	// 운영진 전용
	useEffect(() => {
		if (ready && !isAdmin) navigate("/", { replace: true });
	}, [ready, isAdmin, navigate]);

	// 초기 loading=true. effect 내 동기 setState 회피를 위해 await 이후에만 갱신.
	const reload = useCallback(async () => {
		const rows = await fetchMembersForAdmin();
		setMembers(rows);
		setLoading(false);
	}, []);

	useEffect(() => {
		void reload(); // 마운트 시 1회 로드(setState 는 await 이후라 cascade 없음)
	}, [reload]);

	const doToggleAdmin = useCallback(
		async (m: AdminMemberRow) => {
			if (busyId) return;
			setBusyId(m.id);
			const res = m.isAdmin ? await revokeAdmin(m.id) : await grantAdmin(m.id);
			setBusyId(null);
			if (res.ok) {
				await reload();
			} else if ((res.error ?? "").includes("last admin")) {
				alert("마지막 운영진은 해제할 수 없어요.");
			} else {
				alert("처리에 실패했어요.");
			}
		},
		[busyId, reload],
	);

	const requestToggleAdmin = (m: AdminMemberRow) => {
		setConfirmState({
			message: m.isAdmin
				? `'${m.name}'님을 운영진에서 해제할까요?`
				: `'${m.name}'님을 운영진으로 승급할까요?`,
			run: () => doToggleAdmin(m),
		});
	};

	const openSkillEdit = useCallback((m: AdminMemberRow) => {
		setDraft({ ...DEFAULT_SKILLS, ...(m.skills ?? {}) });
		setSkillEditId(m.id);
	}, []);

	const handleSaveSkills = useCallback(async () => {
		if (!skillEditId || busyId) return;
		setBusyId(skillEditId);
		const ok = await updateMemberSkills(skillEditId, draft);
		setBusyId(null);
		if (ok) {
			setSkillEditId(null);
			await reload();
		} else {
			alert("실력 저장에 실패했어요.");
		}
	}, [skillEditId, busyId, draft, reload]);

	const doDelete = useCallback(
		async (m: AdminMemberRow) => {
			if (busyId) return;
			setBusyId(m.id);
			const res = await deleteMember(m.id);
			setBusyId(null);
			if (res.ok) {
				await reload();
				return;
			}
			const err = res.error ?? "";
			if (err.includes("last admin")) {
				alert("마지막 운영진은 삭제할 수 없어요.");
			} else if (err.includes("self")) {
				alert("본인은 탈퇴를 이용하세요.");
			} else {
				alert("삭제에 실패했어요.");
			}
		},
		[busyId, reload],
	);

	const requestDelete = (m: AdminMemberRow) => {
		setConfirmState({
			message: `'${m.name}'님을 삭제할까요?\n계정·회원 정보가 삭제되며 되돌릴 수 없습니다.`,
			danger: true,
			run: () => doDelete(m),
		});
	};

	// 검색: 이름/성별(남·여)/지역 안에서만 부분일치(대소문자 무시)
	const q = query.trim().toLowerCase();
	const filtered = q
		? members.filter(
				(m) =>
					m.name.toLowerCase().includes(q) ||
					genderText(m.gender).includes(q) ||
					(m.residence ?? "").toLowerCase().includes(q),
			)
		: members;

	// 운영진을 맨 위로, 그 안에서 이름순
	const sorted = [...filtered].sort(
		(a, b) =>
			Number(b.isAdmin) - Number(a.isAdmin) || a.name.localeCompare(b.name),
	);

	const rowVirtualizer = useVirtualizer({
		count: sorted.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => ROW_H,
		overscan: 10,
	});

	const editingMember = skillEditId
		? members.find((m) => m.id === skillEditId)
		: undefined;

	if (!ready) return null;

	return (
		<div
			className="app-shell-h bg-[#fafbff] dark:bg-[#0f172a]"
			style={{ display: "flex", flexDirection: "column" }}
		>
			<AppHeader
				title="회원 관리"
				onBack={() => navigate(-1)}
				right={
					!loading && (
						<span
							className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
							style={{ fontSize: 14, fontWeight: 700 }}
						>
							{filtered.length}
							{q ? `/${members.length}` : ""}
						</span>
					)
				}
			/>
			<div
				className="w-full mx-auto"
				style={{
					// 메인(AppScreen: 외부 패딩 + 내부 .app-card)과 본문 콘텐츠 폭을 동일하게 맞춘다.
					// 카드 폭(--card-max) + 좌우 패딩 40 을 컨테이너 max 로 두고 안쪽에 1.25rem 패딩.
					maxWidth: "calc(var(--card-max) + 40px)",
					flex: 1,
					minHeight: 0,
					width: "100%",
					display: "flex",
					flexDirection: "column",
					paddingLeft: "1.25rem",
					paddingRight: "1.25rem",
					paddingTop: "0.75rem",
					paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
				}}
			>
				{/* 그룹(콕) 설정 — 운영진 전용 전역 설정 */}
				{!loading && (
					<button
						type="button"
						onClick={() => setShowGroupSettings(true)}
						className="w-full bg-white dark:bg-[rgba(30,30,35,0.8)] text-[#0f1724] dark:text-white border border-[rgba(0,0,0,0.1)] dark:border-[rgba(255,255,255,0.12)]"
						style={{
							marginTop: 12,
							padding: "11px 13px",
							borderRadius: 10,
							fontSize: 14,
							fontWeight: 600,
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							cursor: "pointer",
							flexShrink: 0,
						}}
					>
						<span>⚙️ 콕 설정 (콕량·월 지원)</span>
						<span className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]" style={{ fontSize: 18 }}>›</span>
					</button>
				)}

				{/* 검색 */}
				{!loading && members.length > 0 && (
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="이름·성별·지역 검색"
						className="w-full bg-white dark:bg-[rgba(30,30,35,0.8)] text-[#0f1724] dark:text-white border border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.12)]"
						style={{
							marginTop: 12,
							padding: "11px 13px",
							borderRadius: 10,
							fontSize: 15,
							outline: "none",
							flexShrink: 0,
						}}
					/>
				)}

				{/* 목록(가상화 스크롤 영역) */}
				<div
					ref={parentRef}
					className="no-sb"
					style={{ flex: 1, minHeight: 0, overflowY: "auto", marginTop: 12 }}
				>
					{loading ? (
						<div
							className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
							style={{ textAlign: "center", padding: "2.5rem 0", fontSize: 14 }}
						>
							회원 목록을 불러오는 중…
						</div>
					) : members.length === 0 ? (
						<div
							className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
							style={{ textAlign: "center", padding: "2.5rem 0", fontSize: 14 }}
						>
							등록된 회원이 없습니다.
						</div>
					) : filtered.length === 0 ? (
						<div
							className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
							style={{ textAlign: "center", padding: "2.5rem 0", fontSize: 14 }}
						>
							"{query.trim()}" 검색 결과가 없습니다.
						</div>
					) : (
						<div
							style={{
								height: rowVirtualizer.getTotalSize(),
								position: "relative",
								width: "100%",
							}}
						>
							{rowVirtualizer.getVirtualItems().map((vr) => {
								const m = sorted[vr.index];
								const isMe = m.id === myMemberId;
								const isBusy = busyId === m.id;
								const g = genderText(m.gender);
								return (
									<div
										key={m.id}
										style={{
											position: "absolute",
											top: 0,
											left: 0,
											width: "100%",
											height: vr.size,
											transform: `translateY(${vr.start}px)`,
											display: "flex",
											alignItems: "center",
											gap: 8,
											borderBottom: "1px solid rgba(0,0,0,0.06)",
										}}
									>
										{/* 정보(탭 → 실력 편집) */}
										<button
											type="button"
											onClick={() => openSkillEdit(m)}
											style={{
												flex: 1,
												minWidth: 0,
												textAlign: "left",
												background: "none",
												border: "none",
												cursor: "pointer",
												padding: "4px 0",
												overflow: "hidden",
											}}
										>
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: 5,
													whiteSpace: "nowrap",
													overflow: "hidden",
												}}
											>
												<span
													className="text-[#0f1724] dark:text-white"
													style={{
														fontSize: 15,
														fontWeight: 800,
														overflow: "hidden",
														textOverflow: "ellipsis",
													}}
												>
													<Highlight text={m.name} kw={query} />
												</span>
												{isMe && (
													<span
														className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.45)]"
														style={{ fontSize: 12, fontWeight: 600, flexShrink: 0 }}
													>
														(나)
													</span>
												)}
											</div>
											<div
												className="text-[#64748b] dark:text-[rgba(235,235,245,0.55)]"
												style={{
													fontSize: 12.5,
													fontWeight: 500,
													marginTop: 2,
													whiteSpace: "nowrap",
													overflow: "hidden",
													textOverflow: "ellipsis",
												}}
											>
												{!g && m.birthYear == null && !m.residence ? (
													"정보 없음"
												) : (
													<>
														{g && <Highlight text={g} kw={query} />}
														{g && (m.birthYear != null || m.residence) && " · "}
														{m.birthYear != null && `${m.birthYear}년생`}
														{m.birthYear != null && m.residence && " · "}
														{m.residence && (
															<Highlight text={m.residence} kw={query} />
														)}
													</>
												)}
											</div>
										</button>

										{/* 액션(컴팩트) */}
										<div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
											<button
												type="button"
												onClick={() => requestToggleAdmin(m)}
												disabled={isBusy}
												title={
													m.isAdmin ? "운영진 — 눌러서 해제" : "회원 — 눌러서 승급"
												}
												style={miniBtn(
													m.isAdmin ? "#0b84ff" : "#64748b",
													m.isAdmin
														? "rgba(11,132,255,0.15)"
														: "rgba(100,116,139,0.12)",
													isBusy,
												)}
											>
												{m.isAdmin ? "운영진" : "회원"}
											</button>
											<button
												type="button"
												onClick={() => openSkillEdit(m)}
												disabled={isBusy}
												style={miniBtn("#16a34a", "rgba(22,163,74,0.12)", isBusy)}
											>
												실력
											</button>
											{!isMe && (
												<button
													type="button"
													onClick={() => requestDelete(m)}
													disabled={isBusy}
													style={miniBtn("#ef4444", "rgba(239,68,68,0.12)", isBusy)}
												>
													삭제
												</button>
											)}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</div>

			{/* 실력 편집 모달 */}
			{editingMember && (
				<div
					style={{
						position: "fixed",
						inset: 0,
						background: "rgba(0,0,0,0.5)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						zIndex: 70,
						padding: "1.25rem",
					}}
					onClick={() => setSkillEditId(null)}
					onKeyDown={(e) => {
						if (e.key === "Escape") setSkillEditId(null);
					}}
				>
					<div
						className="w-full max-w-sm bg-[#fafbff] dark:bg-[#0f172a]"
						style={{
							borderRadius: 16,
							padding: "1.5rem",
							boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
							maxHeight: "85dvh",
							overflowY: "auto",
						}}
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-center justify-between mb-4">
							<h2
								className="text-[#0f1724] dark:text-white"
								style={{ fontSize: 18, fontWeight: 800 }}
							>
								{editingMember.name} · 실력
							</h2>
							<button
								type="button"
								onClick={() => setSkillEditId(null)}
								className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
								style={{
									background: "none",
									border: "none",
									fontSize: 22,
									lineHeight: 1,
									cursor: "pointer",
									padding: "0 2px",
								}}
								aria-label="닫기"
							>
								×
							</button>
						</div>

						<div className="flex flex-col gap-2">
							{SKILLS.map((skill) => (
								<div
									key={skill}
									style={{ display: "flex", alignItems: "center", gap: 8 }}
								>
									<span
										className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
										style={{ width: 56, fontSize: 13, fontWeight: 700, flexShrink: 0 }}
									>
										{skill}
									</span>
									<div style={{ display: "flex", gap: 6, flex: 1 }}>
										{SKILL_LEVELS.map((level) => (
											<SkillButton
												key={level}
												level={level}
												active={draft[skill] === level}
												onClick={() =>
													setDraft((prev) => ({ ...prev, [skill]: level }))
												}
											/>
										))}
									</div>
								</div>
							))}
						</div>

						<button
							type="button"
							onClick={handleSaveSkills}
							disabled={busyId === skillEditId}
							style={{
								width: "100%",
								marginTop: 16,
								padding: "14px",
								borderRadius: 12,
								fontSize: 16,
								fontWeight: 700,
								color: "#fff",
								background:
									busyId === skillEditId ? "rgba(11,132,255,0.5)" : "#0b84ff",
								border: "none",
								cursor: busyId === skillEditId ? "not-allowed" : "pointer",
							}}
						>
							{busyId === skillEditId ? "저장 중…" : "저장"}
						</button>
					</div>
				</div>
			)}

			{/* 확인 다이얼로그(승급/해제/삭제) */}
			{confirmState && (
				<div
					style={{
						position: "fixed",
						inset: 0,
						background: "rgba(0,0,0,0.5)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						zIndex: 80,
						padding: "1.25rem",
					}}
					onClick={() => setConfirmState(null)}
					onKeyDown={(e) => {
						if (e.key === "Escape") setConfirmState(null);
					}}
				>
					<div
						className="w-full max-w-xs bg-[#fafbff] dark:bg-[#0f172a]"
						style={{
							borderRadius: 16,
							padding: "1.5rem",
							boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
						}}
						onClick={(e) => e.stopPropagation()}
					>
						<p
							className="text-[#0f1724] dark:text-white"
							style={{
								fontSize: 15,
								fontWeight: 600,
								lineHeight: 1.6,
								whiteSpace: "pre-line",
								marginBottom: 18,
							}}
						>
							{confirmState.message}
						</p>
						<div style={{ display: "flex", gap: 8 }}>
							<button
								type="button"
								onClick={() => setConfirmState(null)}
								className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
								style={{
									flex: 1,
									padding: "12px",
									borderRadius: 12,
									fontSize: 15,
									fontWeight: 700,
									background: "rgba(100,116,139,0.12)",
									border: "none",
									cursor: "pointer",
								}}
							>
								취소
							</button>
							<button
								type="button"
								onClick={() => {
									const fn = confirmState.run;
									setConfirmState(null);
									void fn();
								}}
								style={{
									flex: 1,
									padding: "12px",
									borderRadius: 12,
									fontSize: 15,
									fontWeight: 700,
									color: "#fff",
									background: confirmState.danger ? "#ef4444" : "#0b84ff",
									border: "none",
									cursor: "pointer",
								}}
							>
								확인
							</button>
						</div>
					</div>
				</div>
			)}

			{showGroupSettings && (
				<GroupSettingsModal onClose={() => setShowGroupSettings(false)} />
			)}
		</div>
	);
}

function miniBtn(
	color: string,
	bg: string,
	busy: boolean,
): React.CSSProperties {
	return {
		padding: "7px 10px",
		borderRadius: 9,
		fontSize: 12.5,
		fontWeight: 700,
		color,
		background: bg,
		border: "none",
		cursor: busy ? "not-allowed" : "pointer",
		opacity: busy ? 0.5 : 1,
	};
}
