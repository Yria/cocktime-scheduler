import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_SKILLS } from "../../lib/constants";
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
import ConfirmDialog from "../common/ConfirmDialog";
import { inputCls, inputStyle } from "../common/fieldStyles";
import EmptyState from "../shared/EmptyState";
import GroupSettingsModal from "./GroupSettingsModal";
import type { PlayerSkills } from "../../types";
import { MemberRow } from "./MemberAdminRow";
import { genderText } from "./memberAdminText";
import { MemberSkillEditModal } from "./MemberSkillEditModal";

// 운영진 전용 회원 관리(라우트). 100명+ 대비 가상화 리스트 + 컴팩트 행. 실력 편집은 모달.
// 권한 가드: 클라(여기) + RPC/RLS(서버) 이중. error 키워드로 친절 문구 분기.

const ROW_H = 68; // 가상화 행 높이(px)

/** 확인 다이얼로그 상태(null=닫힘). run은 확인 시 실행할 작업. */
interface ConfirmState {
	title: string;
	message?: React.ReactNode;
	danger?: boolean;
	run: () => void | Promise<void>;
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
	const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

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
			title: m.isAdmin ? "운영진 해제" : "운영진 승급",
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
			title: "회원 삭제",
			message: (
				<>
					{`'${m.name}'님을 삭제할까요?`}
					<br />
					계정·회원 정보가 삭제되며 되돌릴 수 없습니다.
				</>
			),
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
							className="text-faint"
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
						className="w-full bg-white dark:bg-[rgba(30,30,35,0.8)] text-strong border border-[rgba(0,0,0,0.1)] dark:border-[rgba(255,255,255,0.12)]"
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
						<span className="text-faint" style={{ fontSize: 18 }}>›</span>
					</button>
				)}

				{/* 검색 */}
				{!loading && members.length > 0 && (
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="이름·성별·지역 검색"
						className={inputCls}
						style={{ ...inputStyle, marginTop: 12, flexShrink: 0 }}
					/>
				)}

				{/* 목록(가상화 스크롤 영역) */}
				<div
					ref={parentRef}
					className="no-sb"
					style={{ flex: 1, minHeight: 0, overflowY: "auto", marginTop: 12 }}
				>
					{loading ? (
						<EmptyState loading style={{ padding: "2.5rem 0" }} />
					) : members.length === 0 ? (
						<EmptyState style={{ fontSize: 14, padding: "2.5rem 0" }}>
							등록된 회원이 없습니다.
						</EmptyState>
					) : filtered.length === 0 ? (
						<EmptyState style={{ fontSize: 14, padding: "2.5rem 0" }}>
							"{query.trim()}" 검색 결과가 없습니다.
						</EmptyState>
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
								return (
									<MemberRow
										key={m.id}
										member={m}
										isMe={isMe}
										isBusy={isBusy}
										query={query}
										size={vr.size}
										start={vr.start}
										onOpenSkillEdit={openSkillEdit}
										onRequestToggleAdmin={requestToggleAdmin}
										onRequestDelete={requestDelete}
									/>
								);
							})}
						</div>
					)}
				</div>
			</div>

			{/* 실력 편집 모달 */}
			{editingMember && (
				<MemberSkillEditModal
					memberName={editingMember.name}
					draft={draft}
					setDraft={setDraft}
					saving={busyId === skillEditId}
					onSave={handleSaveSkills}
					onClose={() => setSkillEditId(null)}
				/>
			)}

			{/* 확인 다이얼로그(승급/해제/삭제) */}
			{confirmState && (
				<ConfirmDialog
					title={confirmState.title}
					message={confirmState.message}
					confirmLabel="확인"
					tone={confirmState.danger ? "danger" : "primary"}
					maxWidth="xs"
					onCancel={() => setConfirmState(null)}
					onDismiss={() => setConfirmState(null)}
					onConfirm={() => {
						const fn = confirmState.run;
						setConfirmState(null);
						void fn();
					}}
				/>
			)}

			{showGroupSettings && (
				<GroupSettingsModal onClose={() => setShowGroupSettings(false)} />
			)}
		</div>
	);
}
