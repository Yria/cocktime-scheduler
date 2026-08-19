import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { nameWithBirthYear } from "../../lib/birthYear";
import { DEFAULT_GRADE, DEFAULT_SKILLS } from "../../lib/constants";
import { skillScoreOf } from "../../lib/teamSelection";
import type { GradeAnchor } from "../shared/GradeInput";
import {
	type AdminMemberRow,
	fetchGuestCount,
	fetchMembersForAdmin,
	grantAdmin,
	revokeAdmin,
	setMemberActive,
	updateMemberSkills,
} from "../../lib/supabase/adminMembers";
import {
	fetchLastParticipationByMember,
	fetchRecentActiveMemberIds,
} from "../../lib/supabase/members";
import { useAuthStore } from "../../store/authStore";
import AppHeader from "../common/AppHeader";
import ConfirmDialog from "../common/ConfirmDialog";
import { inputCls, inputStyle } from "../common/fieldStyles";
import EmptyState from "../shared/EmptyState";
import FilterChip from "../shared/FilterChip";
import GroupSettingsModal from "./GroupSettingsModal";
import type { PlayerSkills } from "../../types";
import { MemberRow } from "./MemberAdminRow";
import { genderText } from "./memberAdminText";
import { MemberSkillEditModal } from "./MemberSkillEditModal";
import { MemberPhotoModal } from "./MemberPhotoModal";

// 운영진 전용 회원 관리(라우트). 100명+ 대비 가상화 리스트 + 컴팩트 행. 실력 편집은 모달.
// 권한 가드: 클라(여기) + RPC/RLS(서버) 이중. error 키워드로 친절 문구 분기.

const ROW_H = 68; // 가상화 행 높이(px)
const HEADER_H = 34; // 그룹 구분선(헤더) 높이(px)

/** 목록 정렬 방식. */
type SortMode = "name" | "birth" | "recent";

/** 가상화 리스트 항목 — 회원 행 또는 그룹 구분선 헤더(회원 수 포함). */
type HeaderItem = { type: "header"; key: string; label: string; count: number };
type MemberItem = { type: "member"; key: string; member: AdminMemberRow };
type ListItem = HeaderItem | MemberItem;

/** 최근참가 구간(누적 상한, 일 단위). 좁은 순 → 넓은 순. */
const RECENT_BUCKETS: { maxDays: number; label: string }[] = [
	{ maxDays: 7, label: "최근 1주일" },
	{ maxDays: 14, label: "최근 2주일" },
	{ maxDays: 21, label: "최근 3주일" },
	{ maxDays: 28, label: "최근 4주일" },
	{ maxDays: 60, label: "최근 2달" },
	{ maxDays: 90, label: "최근 3달" },
];
const RECENT_OLDER_LABEL = "3달 이전 · 기록 없음";

function recentBucketLabel(days: number): string {
	for (const b of RECENT_BUCKETS) if (days <= b.maxDays) return b.label;
	return RECENT_OLDER_LABEL;
}

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
	const memberLoaded = useAuthStore((s) => s.memberLoaded);
	const isAdmin = useAuthStore((s) => s.isAdmin);
	const myMemberId = useAuthStore((s) => s.memberId);

	const [members, setMembers] = useState<AdminMemberRow[]>([]);
	const [loading, setLoading] = useState(true);
	// 실력 비교 표본 필터용 — 최근 3달 참석 회원 id(null=로딩 중, 빈 Set=이력없음→미필터 폴백).
	const [recentActiveIds, setRecentActiveIds] = useState<Set<string> | null>(null);
	// 목록 정렬 방식(기본 가나다순).
	const [sortMode, setSortMode] = useState<SortMode>("name");
	// 최근참가순 정렬/그룹핑용 — 회원별 최근 참가일(member_id → scheduled_at ISO).
	const [lastPartMap, setLastPartMap] = useState<Map<string, string> | null>(
		null,
	);
	// 실력 편집 모달 대상 회원 id(null=닫힘) + 편집 중 draft.
	const [skillEditId, setSkillEditId] = useState<string | null>(null);
	// 아바타 탭 → 큰 사진 보기(회원관리 전용)
	const [photoMember, setPhotoMember] = useState<AdminMemberRow | null>(null);
	const [draft, setDraft] = useState<PlayerSkills>(DEFAULT_SKILLS);
	// 처리 중인 회원 id(중복 클릭 방지).
	const [busyId, setBusyId] = useState<string | null>(null);
	// 검색 키워드(이름/성별/지역 대상)
	const [query, setQuery] = useState("");
	// 비활성 회원 숨김(기본 false=전원 표시). 목록이 커지면 활성만 보도록 토글.
	const [hideInactive, setHideInactive] = useState(false);
	// 게스트 보기(기본 false=회원만 — 기존 화면 그대로). 게스트도 members 행이지만 방문마다 새 행이 생겨
	// 평소 목록을 오염시키므로, 켤 때만 fetchMembersForAdmin(true) 로 함께 불러온다.
	// 목록에 섞어 배지로 구분한다(별도 섹션 없음 — 정렬·검색이 회원과 같은 로직을 그대로 타야 한다).
	const [showGuests, setShowGuests] = useState(false);
	// 게스트 행 수 — 칩 라벨용. 목록을 안 불러온 상태(기본값)에서도 개수를 보여줘야 해 별도 카운트.
	const [guestCount, setGuestCount] = useState(0);
	const [showGroupSettings, setShowGroupSettings] = useState(false);
	// 확인 다이얼로그(승급/해제/삭제). null=닫힘.
	const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

	const parentRef = useRef<HTMLDivElement>(null);
	// 스티키 헤더: 현재 상단에 고정할 그룹 헤더의 listItems 인덱스.
	const activeStickyIndexRef = useRef(0);

	// 운영진 전용 — 회원정보 로드 완료(memberLoaded) 후에만 판정(새로고침 시 조기 리다이렉트 방지).
	useEffect(() => {
		if (ready && memberLoaded && !isAdmin) navigate("/", { replace: true });
	}, [ready, memberLoaded, isAdmin, navigate]);

	// 초기 loading=true. effect 내 동기 setState 회피를 위해 await 이후에만 갱신.
	// showGuests 가 바뀌면 reload 정체성이 바뀌어 아래 effect 가 다시 돌며 재조회한다(칩 토글 = 재조회).
	// 세대 가드: 게스트 칩을 ON→OFF 로 연타하면 응답이 역전돼 "칩은 꺼졌는데 게스트가 남은" 목록이
	// 붙을 수 있다(다시 토글해야 복구). 마지막으로 시작한 재조회의 응답만 반영한다.
	const reloadSeq = useRef(0);
	const reload = useCallback(async () => {
		const seq = ++reloadSeq.current;
		const rows = await fetchMembersForAdmin(showGuests);
		if (seq !== reloadSeq.current) return;
		setMembers(rows);
		setLoading(false);
	}, [showGuests]);

	useEffect(() => {
		void reload(); // 마운트 시 1회 + 게스트 보기 토글 시(setState 는 await 이후라 cascade 없음)
	}, [reload]);

	// 게스트 행 수 로드(칩 라벨). 비활성 게스트도 포함한 총 개수라 토글/비활성 처리로 변하지 않아 1회면 충분.
	useEffect(() => {
		let alive = true;
		void fetchGuestCount().then((n) => {
			if (alive) setGuestCount(n);
		});
		return () => {
			alive = false;
		};
	}, []);

	// 최근 3달 참석 회원 id 로드(실력 편집 비교군 한정용).
	useEffect(() => {
		let alive = true;
		void fetchRecentActiveMemberIds(3).then((ids) => {
			if (alive) setRecentActiveIds(ids);
		});
		return () => {
			alive = false;
		};
	}, []);

	// 회원별 최근 참가일 로드(최근참가순 정렬·그룹핑용).
	useEffect(() => {
		let alive = true;
		void fetchLastParticipationByMember(100).then((m) => {
			if (alive) setLastPartMap(m);
		});
		return () => {
			alive = false;
		};
	}, []);

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
				? `'${nameWithBirthYear(m.name, m.birthYear)}'님을 운영진에서 해제할까요?`
				: `'${nameWithBirthYear(m.name, m.birthYear)}'님을 운영진으로 승급할까요?`,
			run: () => doToggleAdmin(m),
		});
	};

	const doToggleActive = useCallback(
		async (m: AdminMemberRow) => {
			if (busyId) return;
			setBusyId(m.id);
			const ok = await setMemberActive(m.id, !m.isActive);
			setBusyId(null);
			if (ok) {
				await reload();
			} else {
				alert("처리에 실패했어요.");
			}
		},
		[busyId, reload],
	);

	const requestToggleActive = (m: AdminMemberRow) => {
		const who = `'${nameWithBirthYear(m.name, m.birthYear)}'님`;
		// 게스트는 세션 명단(fetchMembers 가 is_guest=false 로 이미 제외)도, 회비 부과 대상도 아니다 —
		// 회원용 "세션 명단·회비 부과에서 제외" 문구는 게스트에겐 거짓이라 분기한다.
		// "정산함 납부자 후보에서 내려갑니다"도 쓰지 않았다: 정산함 후보 위생(matching.sanitizeCandidatePool)은
		// 비활성 행을 빼지 않고 순서만 뒤로 미는 규칙이라, 지금 그렇게 적으면 지키지 못하는 약속이 된다.
		// 오늘 참인 효과는 '이 목록에서 비활성으로 접힌다'뿐 → 그것만 적는다.
		// 되살아남 안내는 add_guest_attendance 재사용 규칙(20260819030000_guest_row_reuse) 근거 —
		// 같은 이름·성별 게스트가 다시 오면 그 행을 is_active=true 로 되살려 붙인다.
		if (m.isGuest) {
			setConfirmState({
				title: m.isActive ? "게스트 접어두기" : "게스트 다시 보이기",
				message: m.isActive ? (
					<>
						{`${who}(게스트)을 접어둘까요?`}
						<br />
						이 목록에서 '비활성'으로 표시돼 [비활성 숨기기]로 접힙니다. 게스트는
						회비 부과가 없어 정산 금액은 그대로예요. (참석·정산 기록도 보존)
						<br />
						같은 이름·성별로 다시 신청되면 이 행이 자동으로 되살아납니다.
					</>
				) : (
					`${who}(게스트)을 다시 활성으로 표시할까요?`
				),
				run: () => doToggleActive(m),
			});
			return;
		}
		setConfirmState({
			title: m.isActive ? "회원 비활성화" : "회원 활성화",
			message: m.isActive ? (
				<>
					{`${who}을 비활성화할까요?`}
					<br />
					세션 명단과 회비 자동부과에서 제외됩니다. (회원 정보는 보존)
				</>
			) : (
				`${who}을 다시 활성화할까요?`
			),
			run: () => doToggleActive(m),
		});
	};

	const openSkillEdit = useCallback((m: AdminMemberRow) => {
		// 신 모델 {grade} 우선, 구 6종/빈값이면 등급으로 환산해 초기화.
		setDraft({ grade: skillScoreOf(m.skills) || DEFAULT_GRADE });
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

	// 회원 하드삭제(delete_member)는 폐지 — 탈퇴는 비활성(is_active=false)으로만.
	// 하드삭제는 dues_charges/allocations/attendances 를 CASCADE 로 날려 정산을 꼬이게 하므로
	// UI·서버 RPC 양쪽에서 차단(재가입은 재활성화로 옛 created_at 보존 → 당월 회비 자동 부과).

	// 비활성 수(필터 칩 노출/라벨용). 게스트 보기를 켜면 접어둔 게스트도 포함 — 현재 목록 기준이라 맞다.
	const inactiveCount = useMemo(
		() => members.filter((m) => !m.isActive).length,
		[members],
	);

	// 검색: 이름/성별(남·여)/지역 안에서만 부분일치(대소문자 무시) + 비활성 숨김 필터
	const q = query.trim().toLowerCase();
	const filtered = useMemo(() => {
		let list = hideInactive ? members.filter((m) => m.isActive) : members;
		if (q)
			list = list.filter(
				(m) =>
					m.name.toLowerCase().includes(q) ||
					genderText(m.gender).includes(q) ||
					(m.residence ?? "").toLowerCase().includes(q),
			);
		return list;
	}, [members, q, hideInactive]);

	// 정렬 + 그룹 구분선(헤더) 삽입 → 평탄한 가상화 항목 배열.
	const listItems = useMemo<ListItem[]>(() => {
		if (sortMode === "name") {
			// 기본: 가나다순(순수 이름). 헤더 없음.
			return [...filtered]
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((m) => ({ type: "member", key: m.id, member: m }));
		}

		if (sortMode === "birth") {
			// 년생 내림차순(높은 년도 먼저), 년생 미상은 맨 뒤. 년도별 구분선.
			const arr = [...filtered].sort((a, b) => {
				if (a.birthYear != null && b.birthYear != null)
					return b.birthYear - a.birthYear || a.name.localeCompare(b.name);
				if (a.birthYear != null) return -1;
				if (b.birthYear != null) return 1;
				return a.name.localeCompare(b.name);
			});
			const items: ListItem[] = [];
			let curHeader: HeaderItem | null = null;
			for (const m of arr) {
				const label = m.birthYear != null ? `${m.birthYear}년생` : "년생 미상";
				if (!curHeader || curHeader.label !== label) {
					curHeader = { type: "header", key: `h:${label}`, label, count: 0 };
					items.push(curHeader);
				}
				curHeader.count++;
				items.push({ type: "member", key: m.id, member: m });
			}
			return items;
		}

		// 최근참가순: 최근 참가일 내림차순, 기록 없음은 맨 뒤. 주/달 구간별 구분선.
		const now = Date.now();
		const withDate = filtered.map((m) => ({
			m,
			at: lastPartMap?.get(m.id) ?? null,
		}));
		withDate.sort((a, b) => {
			if (a.at && b.at)
				return a.at < b.at ? 1 : a.at > b.at ? -1 : a.m.name.localeCompare(b.m.name);
			if (a.at) return -1;
			if (b.at) return 1;
			return a.m.name.localeCompare(b.m.name);
		});
		const items: ListItem[] = [];
		let curHeader: HeaderItem | null = null;
		for (const { m, at } of withDate) {
			const label = at
				? recentBucketLabel(Math.floor((now - new Date(at).getTime()) / 86400000))
				: RECENT_OLDER_LABEL;
			if (!curHeader || curHeader.label !== label) {
				curHeader = { type: "header", key: `h:${label}`, label, count: 0 };
				items.push(curHeader);
			}
			curHeader.count++;
			items.push({ type: "member", key: m.id, member: m });
		}
		return items;
	}, [filtered, sortMode, lastPartMap]);

	// 스티키 헤더용 — 헤더 항목의 인덱스들.
	const stickyIndexes = useMemo(
		() =>
			listItems.reduce<number[]>((acc, it, i) => {
				if (it.type === "header") acc.push(i);
				return acc;
			}, []),
		[listItems],
	);

	const rowVirtualizer = useVirtualizer({
		count: listItems.length,
		getScrollElement: () => parentRef.current,
		estimateSize: (i) =>
			listItems[i]?.type === "header" ? HEADER_H : ROW_H,
		getItemKey: (i) => listItems[i]?.key ?? i,
		overscan: 10,
		// 스티키 헤더: 현재 상단 그룹의 헤더를 항상 렌더 범위에 포함시켜 top:0 고정.
		rangeExtractor: useCallback(
			(range: { startIndex: number; endIndex: number; overscan: number; count: number }) => {
				if (stickyIndexes.length === 0) return defaultRangeExtractor(range);
				activeStickyIndexRef.current =
					[...stickyIndexes].reverse().find((i) => range.startIndex >= i) ??
					stickyIndexes[0];
				const next = new Set([
					activeStickyIndexRef.current,
					...defaultRangeExtractor(range),
				]);
				return [...next].sort((a, b) => a - b);
			},
			[stickyIndexes],
		),
	});

	// 정렬 방식이 바뀌면 헤더/행 위치가 달라지므로 측정 캐시 재계산.
	useEffect(() => {
		rowVirtualizer.measure();
	}, [sortMode, rowVirtualizer]);

	const editingMember = skillEditId
		? members.find((m) => m.id === skillEditId)
		: undefined;

	// 실력 편집 비교 표본 — 편집 대상과 동성 + 최근 3달 참석 회원(본인 제외는 GradeInput이 id로 처리).
	// recentActiveIds 가 null(로딩) 또는 빈 Set(이력없음)이면 미필터 폴백.
	const skillAnchors = useMemo<GradeAnchor[]>(() => {
		if (!editingMember?.gender) return [];
		const g = editingMember.gender;
		// 게스트 보기를 켜면 members 에 게스트가 섞인다 — 게스트 등급은 초대자가 눈대중으로 넣은 값이라
		// 비교 앵커로 부적합하고, 방문마다 새 행이 생겨 앵커 목록을 부풀린다 → 앵커에서는 항상 제외.
		const sameGender = members.filter((m) => m.gender === g && !m.isGuest);
		const pool =
			recentActiveIds && recentActiveIds.size
				? sameGender.filter((m) => recentActiveIds.has(m.id))
				: sameGender;
		return pool.map((m) => ({ id: m.id, name: m.name, grade: skillScoreOf(m.skills), gender: g, birthYear: m.birthYear }));
	}, [members, editingMember, recentActiveIds]);

	if (!ready || !memberLoaded) return null;

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
							{/* 게스트 보기가 켜져 있으면 이 숫자는 회원 수가 아니다(게스트 포함) → '+게스트'를 붙여 오독을 막는다. */}
							{filtered.length}
							{q ? `/${members.length}` : ""}
							{showGuests && <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 3 }}>+게스트</span>}
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

				{/* 정렬 */}
				{!loading && members.length > 0 && (
					<div
						style={{ display: "flex", gap: 6, marginTop: 8, flexShrink: 0 }}
					>
						{(
							[
								["name", "가나다순"],
								["birth", "년생순"],
								["recent", "최근 참가순"],
							] as [SortMode, string][]
						).map(([key, label]) => (
							<button
								key={key}
								type="button"
								onClick={() => setSortMode(key)}
								className={`btn-toggle flex-1 py-2 ${sortMode === key ? "btn-toggle-active" : ""}`}
								style={{ fontSize: 13 }}
							>
								{label}
							</button>
						))}
					</div>
				)}

				{/* 필터 칩 — 게스트 보기 / 비활성 숨김. 해당 대상이 있을 때만 각각 노출.
				    비활성 칩은 기존 자리(맨 오른쪽)를 지키고 게스트 칩을 왼쪽에 붙인다. */}
				{!loading && (guestCount > 0 || inactiveCount > 0) && (
					<div
						style={{
							display: "flex",
							justifyContent: "flex-end",
							gap: 6,
							marginTop: 8,
							flexShrink: 0,
						}}
					>
						{guestCount > 0 && (
							<FilterChip
								label={`게스트 ${guestCount}명 보기`}
								active={showGuests}
								// 앱 공통 게스트 색(참가자 목록 pill·행 배지와 동일 계열)
								activeColor="#b4762b"
								onClick={() => setShowGuests((v) => !v)}
							/>
						)}
						{inactiveCount > 0 && (
							<FilterChip
								label={`비활성 ${inactiveCount}명 숨기기`}
								active={hideInactive}
								onClick={() => setHideInactive((v) => !v)}
							/>
						)}
					</div>
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
								const item = listItems[vr.index];
								if (!item) return null;
								if (item.type === "header") {
									const sticky = activeStickyIndexRef.current === vr.index;
									return (
										<div
											key={vr.key}
											className="bg-[#fafbff] dark:bg-[#0f172a]"
											style={{
												position: sticky ? "sticky" : "absolute",
												top: 0,
												left: 0,
												width: "100%",
												height: vr.size,
												transform: sticky
													? undefined
													: `translateY(${vr.start}px)`,
												zIndex: sticky ? 2 : 1,
												display: "flex",
												alignItems: "center",
												gap: 6,
												borderBottom: "1px solid rgba(120,120,140,0.22)",
											}}
										>
											<span
												className="text-muted"
												style={{
													fontSize: 11.5,
													fontWeight: 800,
													whiteSpace: "nowrap",
												}}
											>
												{item.label}
											</span>
											<span
												className="text-faint"
												style={{ fontSize: 11, fontWeight: 700 }}
											>
												{item.count}명
											</span>
										</div>
									);
								}
								const m = item.member;
								return (
									<MemberRow
										key={vr.key}
										member={m}
										isMe={m.id === myMemberId}
										isBusy={busyId === m.id}
										query={query}
										size={vr.size}
										start={vr.start}
										onOpenSkillEdit={openSkillEdit}
										onOpenPhoto={setPhotoMember}
										onRequestToggleAdmin={requestToggleAdmin}
										onRequestToggleActive={requestToggleActive}
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
					memberId={editingMember.id}
					gender={editingMember.gender ?? "M"}
					draft={draft}
					setDraft={setDraft}
					anchors={skillAnchors}
					saving={busyId === skillEditId}
					onSave={handleSaveSkills}
					onClose={() => setSkillEditId(null)}
				/>
			)}

			{/* 큰 프로필 사진 보기 */}
			{photoMember && (
				<MemberPhotoModal
					member={photoMember}
					onClose={() => setPhotoMember(null)}
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
