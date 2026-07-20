import { useEffect, useState } from "react";
import { useDebugStore } from "../../store/debugStore";
import { useSessionStore } from "../../store/sessionStore";
import { useAppStore } from "../../store/appStore";
import { useAuthStore } from "../../store/authStore";
import { skillScore as computeSkillScore, skillScoreOf } from "../../lib/teamSelection";
import { fetchMatchLogs, type MatchLogEntry } from "../../lib/supabase/api";
import { dbUpdatePlayerSkill } from "../../lib/supabase/actions";
import { DEFAULT_GRADE, DEFAULT_SKILLS } from "../../lib/constants";
import { fmtHM } from "../../lib/schedule/timeFmt";
import { GradeInput, type GradeAnchor } from "../shared/GradeInput";
import ModalSheet from "../common/ModalSheet";
import EmptyState from "../shared/EmptyState";
import type { GameType, PlayerSkills } from "../../types";

const GAME_TYPE_STYLE: Record<GameType, string> = {
	혼복: "bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300",
	남복: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
	여복: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
	혼합: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
};

// 혼성(혼복·혼합) 먼저 — 디버그 관심사 우선
const GAME_TYPE_ORDER: GameType[] = ["혼복", "혼합", "남복", "여복"];

// lib/magnetStyle의 잉크색은 inline style이라 다크모드 스왑이 안 됨 — 다크 배경 가독성을 위해
// Tailwind 클래스 쌍(라이트 600/다크 300)을 유지한다(디버그 모달 전용).
function genderInk(gender?: string): string {
	return gender === "F" ? "text-rose-600 dark:text-rose-300" : "text-sky-600 dark:text-sky-300";
}

function Flag({ children }: { children: React.ReactNode }) {
	return (
		<span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
			{children}
		</span>
	);
}

/**
 * 자석 롱프레스 시 뜨는 디버그 모달.
 * - 이 선수가 출전한 완료 경기를 시간순(최신순)으로 나열 — 회차/시각·게임타입·파트너·상대
 * - gameCount / mixedCount / status / waitSince 등 카운터·상태값
 *
 * 경기 로그(MatchLogEntry)에는 선수 id가 없어 이름으로 매칭한다(동명이인은 드물어 허용).
 */
export default function DebugMatchModal() {
	const debugPlayerId = useDebugStore((s) => s.debugPlayerId);
	const closeDebug = useDebugStore((s) => s.closeDebug);
	const sessionPlayers = useSessionStore((s) => s.sessionPlayers);
	const sessionId = useAppStore((s) => s.sessionMeta?.sessionId);
	const isAdmin = useAuthStore((s) => s.isAdmin);

	// null = 아직 로드 전(로딩 표시용). 배열 = 현재 세션의 완료 경기 로그.
	const [logs, setLogs] = useState<MatchLogEntry[] | null>(null);

	// 운영진 실력 편집 상태. editTarget=편집 중인 선수 id → 대상 선수가 바뀌면 파생적으로 편집 종료.
	const [editTarget, setEditTarget] = useState<string | null>(null);
	const [draft, setDraft] = useState<PlayerSkills>(DEFAULT_SKILLS);
	const [saving, setSaving] = useState(false);
	const [editErr, setEditErr] = useState<string | null>(null);
	const editing = editTarget != null && editTarget === debugPlayerId;

	// 모달이 열릴 때(대상 선수 변경 시) 현재 세션의 완료 경기 로그를 가져온다.
	useEffect(() => {
		if (!debugPlayerId || !sessionId) return;
		let alive = true;
		fetchMatchLogs(sessionId).then((all) => {
			if (alive) setLogs(all);
		});
		return () => {
			alive = false;
		};
	}, [debugPlayerId, sessionId]);

	const player = debugPlayerId ? sessionPlayers.get(debugPlayerId) : undefined;
	if (!debugPlayerId || !player) return null;

	const myName = player.name;

	// 동성 세션 선수 비교 표본(본인 제외는 GradeInput이 id로 처리 — 회원은 members.id, 게스트는 session_players.id).
	const skillAnchors: GradeAnchor[] = [...sessionPlayers.values()]
		.filter((p) => p.gender === player.gender)
		.map((p) => ({
			id: p.memberId ?? p.id,
			name: p.name,
			grade: skillScoreOf(p.skills),
			gender: p.gender,
		}));

	const startEdit = () => {
		setDraft({ grade: skillScoreOf(player.skills) || DEFAULT_GRADE });
		setEditErr(null);
		setEditTarget(player.id);
	};

	const handleSaveSkill = async () => {
		if (saving) return;
		setSaving(true);
		setEditErr(null);
		const updated = await dbUpdatePlayerSkill(player.id, draft);
		setSaving(false);
		if (updated) {
			// 보드 즉시 반영 + 타 기기 전파(members.skills 는 RPC가 함께 갱신)
			useSessionStore.getState().broadcastPlayerUpdated(updated);
			setEditTarget(null);
		} else {
			setEditErr("저장에 실패했어요. 운영진만 편집할 수 있어요.");
		}
	};

	// 이 선수가 낀 경기만 추려 파트너/상대를 계산 (logs는 ended_at 최신순)
	const history = (logs ?? []).flatMap((m) => {
		const inA = m.teamA.some((p) => p.name === myName);
		const inB = m.teamB.some((p) => p.name === myName);
		if (!inA && !inB) return [];
		const myTeam = inA ? m.teamA : m.teamB;
		const oppTeam = inA ? m.teamB : m.teamA;
		const partner = myTeam.find((p) => p.name !== myName);
		return [{ id: m.id, gameType: m.gameType, at: m.endedAt ?? m.startedAt, partner, opponents: oppTeam }];
	});

	// 동반 횟수 — 같은 경기를 뛴 본인 제외 3명(파트너 + 상대 2명) 기준, 횟수 내림차순
	const coPlayerCounts = (() => {
		const map = new Map<string, { name: string; gender?: string; count: number }>();
		for (const h of history) {
			const coPlayers = [h.partner, ...h.opponents].filter(Boolean) as { name: string; gender?: string }[];
			for (const c of coPlayers) {
				const e = map.get(c.name);
				if (e) e.count += 1;
				else map.set(c.name, { name: c.name, gender: c.gender, count: 1 });
			}
		}
		return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	})();

	return (
		<ModalSheet position="center" onClose={closeDebug} className="flex flex-col max-h-[85dvh]">
			<div className="flex items-center justify-between px-5 pt-5 pb-3">
				<div className="flex flex-col">
					<span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">
						🐛 DEBUG · 매칭 이력
					</span>
					<h3 className="font-bold text-gray-800 dark:text-white text-lg leading-tight">
						{player.name}
						<span className="ml-1.5 text-xs font-medium text-gray-400">
							{player.gender === "F" ? "여" : "남"} · 등급 {computeSkillScore(player)}
						</span>
					</h3>
				</div>
				<div className="flex items-center gap-2">
					{isAdmin && !editing && (
						<button
							type="button"
							onClick={startEdit}
							className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
						>
							실력 편집
						</button>
					)}
					<button type="button" onClick={closeDebug} className="btn-icon-close">
						✕
					</button>
				</div>
			</div>

			<div className="no-sb overflow-y-auto px-5 pb-5">
				{editing ? (
					<div className="flex flex-col gap-2">
						<GradeInput
							value={draft.grade}
							onChange={(grade) => setDraft({ grade })}
							gender={player.gender}
							excludeName={player.name}
							excludeId={player.memberId ?? player.id}
							anchors={skillAnchors}
							title="실력 편집"
						/>
						{editErr && (
							<p className="text-xs font-semibold text-red-500 mt-1">{editErr}</p>
						)}
						<div className="flex gap-2 mt-3">
							<button
								type="button"
								onClick={handleSaveSkill}
								disabled={saving}
								className="flex-1 rounded-xl bg-blue-500 py-2.5 text-sm font-bold text-white disabled:opacity-50"
							>
								{saving ? "저장 중…" : "저장"}
							</button>
							<button
								type="button"
								onClick={() => setEditTarget(null)}
								disabled={saving}
								className="rounded-xl bg-gray-100 dark:bg-white/10 px-5 py-2.5 text-sm font-bold text-gray-600 dark:text-gray-300 disabled:opacity-50"
							>
								취소
							</button>
						</div>
					</div>
				) : (
					<>
				{/* 플래그 — 설정된 것만 표시 */}
				{player.allowMixedSingle && (
					<div className="flex flex-wrap gap-1.5 mb-4">
						<Flag>혼단허용</Flag>
					</div>
				)}

				{/* 경기별 시간순 매칭 이력 */}
				<p className="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide mb-2">
					팀 매칭 이력 {logs !== null && `(${history.length}경기)`}
				</p>
				{/* 실제 출전 게임타입 집계 — 이력 기반이라 남녀 모두 정확(위 '혼복(남)'은 남자 전용 균등화 지표) */}
				{logs !== null && history.length > 0 && (
					<div className="flex flex-wrap gap-1.5 mb-2.5">
						{GAME_TYPE_ORDER.map((gt) => {
							const count = history.filter((h) => h.gameType === gt).length;
							if (count === 0) return null;
							return (
								<span
									key={gt}
									className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${GAME_TYPE_STYLE[gt]}`}
								>
									{gt} {count}
								</span>
							);
						})}
					</div>
				)}
				{/* 동반 횟수 — 같은 경기를 뛴 사람(본인 제외 3명) 기준, 누구랑 몇 번 들어갔는지 */}
				{logs !== null && coPlayerCounts.length > 0 && (
					<>
						<p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 mb-1.5">
							같은 경기 동반 횟수
						</p>
						<div className="flex flex-wrap gap-1.5 mb-3">
							{coPlayerCounts.map((p) => (
								<span
									key={p.name}
									className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium ${
										p.gender === "F"
											? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
											: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
									}`}
								>
									{p.name}
									<span className="font-bold tabular-nums">×{p.count}</span>
								</span>
							))}
						</div>
					</>
				)}
				{logs === null ? (
					<EmptyState loading style={{ padding: "12px 0" }} />
				) : history.length === 0 ? (
					<EmptyState style={{ padding: "12px 0" }}>완료된 경기 기록 없음</EmptyState>
				) : (
					<ol className="flex flex-col gap-2">
						{history.map((h, i) => (
							<li
								key={h.id}
								className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 py-2"
							>
								<div className="flex items-center justify-between mb-1">
									<span className="text-xs font-bold text-gray-400 dark:text-gray-500">
										#{history.length - i}
										<span className="ml-1.5 font-medium">{fmtHM(h.at)}</span>
									</span>
									<span
										className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${GAME_TYPE_STYLE[h.gameType]}`}
									>
										{h.gameType}
									</span>
								</div>
								<div className="text-sm">
									<span className="text-gray-400 dark:text-gray-500">파트너 </span>
									<span className={`font-bold ${genderInk(h.partner?.gender ?? "M")}`}>
										{h.partner?.name ?? "—"}
									</span>
									<span className="mx-1.5 text-gray-300 dark:text-gray-600">vs</span>
									{h.opponents.map((o, j) => (
										<span key={j}>
											<span className={`font-medium ${genderInk(o.gender)}`}>{o.name}</span>
											{j < h.opponents.length - 1 && (
												<span className="text-gray-300 dark:text-gray-600">, </span>
											)}
										</span>
									))}
								</div>
							</li>
						))}
					</ol>
				)}
					</>
				)}
			</div>
		</ModalSheet>
	);
}
