import { useMemo, useState } from "react";
import type { SessionPlayer } from "../../types";
import { useSessionStore } from "../../store/sessionStore";
import { useBoardStore } from "../../store/boardStore";
import { useDebugStore } from "../../store/debugStore";
import { useDoubleTap } from "../../hooks/useDoubleTap";
import { useLongPress } from "../../hooks/useLongPress";
import { useTeammateRecommendations, type RecommendTarget } from "../../hooks/useTeammateRecommendations";
import { skillScore } from "../../lib/teamSelection";
import ModalSheet from "../common/ModalSheet";
import PlayerCard from "../shared/PlayerCard";
import PlayerPickerList, { type PlayerPickerItem, type PlayerPickerSortOption } from "../shared/PlayerPickerList";

type Props = {
	onClose: () => void;
} & RecommendTarget;

const TEAM_SIZE = 4;

const SORT_OPTIONS: PlayerPickerSortOption[] = [
	{ value: "fit", label: "추천순" },
	{ value: "skill", label: "실력순" },
	{ value: "gameCount", label: "경기수" },
	{ value: "waitTime", label: "대기시간" },
];

/** 디버그 점수 분해 표시 — 0(또는 미세)이면 가운뎃점, 그 외 소수1자리. */
const fmtScore = (n?: number): string => (n === undefined || Math.abs(n) < 0.05 ? "·" : n.toFixed(1));

export default function RecommendTeammateDialog({ teamId, seedId, newTeam, onClose }: Props) {
	const commitTeammates = useBoardStore((s) => s.commitTeammates);
	const autoFillTarget = useBoardStore((s) => s.autoFillTarget);
	const removeMemberFromBoard = useBoardStore((s) => s.removeMemberFromBoard);
	const sessionPlayers = useSessionStore((s) => s.sessionPlayers);

	// 진행 중 다중선택
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	// 점수 분해 디버그 토글(제목 우측 🐛 버튼)
	const [debug, setDebug] = useState(false);

	const { ranked, members, playingIds } = useTeammateRecommendations({ teamId, seedId, newTeam }, selectedIds);

	const selectedPlayers = useMemo(
		() =>
			selectedIds
				.map((id) => sessionPlayers.get(id))
				.filter((p): p is SessionPlayer => p !== undefined),
		[selectedIds, sessionPlayers],
	);

	const filledCount = members.length + selectedIds.length;
	const canAddMore = filledCount < TEAM_SIZE;
	const emptyCount = Math.max(0, TEAM_SIZE - filledCount);

	const avgSkill = useMemo(() => {
		const all = [...members, ...selectedPlayers];
		if (all.length === 0) return 0;
		return all.reduce((sum, p) => sum + skillScore(p), 0) / all.length;
	}, [members, selectedPlayers]);

	// 디버그: 점수 분해 % 계산용 min/max (ranked score 기준)
	const dbgRange = useMemo(() => {
		const scores = ranked.map((r) => r.score);
		return scores.length ? { min: Math.min(...scores), max: Math.max(...scores) } : { min: 0, max: 0 };
	}, [ranked]);

	const toggle = (playerId: string) => {
		setSelectedIds((prev) => {
			if (prev.includes(playerId)) return prev.filter((id) => id !== playerId);
			if (members.length + prev.length >= TEAM_SIZE) return prev; // 4명 상한
			return [...prev, playerId];
		});
	};

	// 상단 4칸 제스처 — 더블탭하면 빠짐(확정 멤버=팀에서 제거 / 선택분=선택 해제), 롱프레스=디버그. 단일탭은 무동작.
	const topLong = useLongPress<string>((id) => useDebugStore.getState().openDebug(id));
	const topTap = useDoubleTap<{ kind: "member" | "selected"; id: string }>(
		() => {},
		(arg) => {
			if (arg.kind === "member") removeMemberFromBoard(arg.id);
			else toggle(arg.id);
		},
	);

	const pickerPlayers = useMemo((): PlayerPickerItem[] =>
		ranked.map((item, index) => ({
			player: item.player,
			// "경기중" 배지/흐림은 추천 정렬 정책(deprioritizePlaying)과 무관하게,
			// 실제로 경기중인 선수에게는 항상 표시한다 — 배지는 추천 상태가 아니라 사실(경기중)을 나타낸다.
			// 경기중 판별은 courts 기반 playingIds(status는 경기 시작 직후 갱신 지연).
			isPlaying: playingIds.has(item.player.id),
			rank: index,
			skillRank: avgSkill > 0 ? Math.abs(skillScore(item.player) - avgSkill) : -skillScore(item.player),
			fitnessScore: item.score,
			waitSince: item.player.waitSince ?? undefined,
		})),
		[ranked, avgSkill, playingIds],
	);

	const handleConfirm = () => {
		if (selectedIds.length === 0) return;
		commitTeammates({ teamId: teamId ?? undefined, seedId: seedId ?? undefined, newTeam }, selectedIds);
		onClose();
	};

	// 자동편성 — 직접 고른 선수(selectedIds)는 그대로 두고 나머지 빈 자리를 추천 대기 선수로 채워 commit.
	const handleAutoFill = () => {
		autoFillTarget({ teamId: teamId ?? undefined, seedId: seedId ?? undefined, newTeam }, selectedIds);
		onClose();
	};

	const headerNote = teamId
		? `${filledCount}/4명 · 추천에서 골라 팀을 채우세요`
		: newTeam
			? `${filledCount}/4명 · 추천 순으로 골라 새 팀을 만듭니다`
			: `${members[0]?.name ?? ""} 선수와 함께할 팀원을 골라 팀을 만듭니다`;

	return (
		<ModalSheet position="bottom" onClose={onClose} className="max-h-[90dvh] flex flex-col">
			<div className="shrink-0 px-5 pt-5 pb-4 border-b border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]">
				<div className="flex items-center justify-between">
					<h3 className="font-bold text-gray-800 dark:text-white text-lg">추천 팀원</h3>
					<button
						type="button"
						onClick={() => setDebug((d) => !d)}
						className={`text-xs px-2 py-1 rounded ${debug ? "bg-purple-500 text-white" : "text-gray-400 dark:text-gray-500"}`}
						title="점수 분해 디버그"
					>
						🐛
					</button>
				</div>
				<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{headerNote}</p>

				{/* 현재 팀(확정 멤버 + 선택분) — 자석(원형) 형태, 가운데 정렬 */}
				<div className="flex justify-center items-start gap-2 mt-3">
					{members.map((p) => (
						<div
							key={p.id}
							style={{ cursor: "pointer" }}
							onPointerDown={() => topLong.start(p.id, p.id)}
							onPointerUp={topLong.cancel}
							onPointerLeave={topLong.cancel}
							onClick={() => {
								if (topLong.didFire()) return;
								topTap(p.id, { kind: "member", id: p.id });
							}}
						>
							<PlayerCard name={p.name} gender={p.gender} skillScore={skillScore(p)} size="sm" />
						</div>
					))}
					{selectedPlayers.map((p) => (
						<div
							key={p.id}
							style={{ cursor: "pointer" }}
							onPointerDown={() => topLong.start(p.id, p.id)}
							onPointerUp={topLong.cancel}
							onPointerLeave={topLong.cancel}
							onClick={() => {
								if (topLong.didFire()) return;
								topTap(p.id, { kind: "selected", id: p.id });
							}}
						>
							<PlayerCard name={p.name} gender={p.gender} skillScore={skillScore(p)} size="sm" selected />
						</div>
					))}
					{Array.from({ length: emptyCount }).map((_, i) => (
						<div key={`empty-${i}`} style={{ width: 68, display: "flex", justifyContent: "center" }}>
							<div
								style={{
									width: 56,
									height: 56,
									borderRadius: "50%",
									border: "2px dashed rgba(128,128,128,0.3)",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									color: "rgba(128,128,128,0.45)",
									fontSize: 22,
								}}
							>
								+
							</div>
						</div>
					))}
				</div>
			</div>

			<div className="shrink-0 px-5 py-2">
				<PlayerPickerList
					players={pickerPlayers}
					onSelect={(p) => toggle(p.id)}
					onItemLongPress={(p) => useDebugStore.getState().openDebug(p.id)}
					isDisabled={() => !canAddMore}
					showSearch
					searchThreshold={0}
					showGenderFilter
					showStatusFilter={false}
					sortOptions={SORT_OPTIONS}
					maxHeight={debug ? "26vh" : "34vh"}
					emptyMessage="추천 가능한 선수가 없습니다"
					noResultMessage="검색 결과가 없습니다"
				/>
			</div>

			{debug && ranked.length > 0 && (
				<div className="flex-1 min-h-0 overflow-auto px-5 pb-3">
					<div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
						점수 분해 · 합계 낮을수록 상위 · 값은 가중치 적용 기여도(− = 유리)
					</div>
					<table className="text-[11px] w-full border-collapse">
						<thead>
							<tr className="text-gray-400 dark:text-gray-500">
								<th className="text-left pr-2">이름</th>
								<th className="text-right px-1">실력</th>
								<th className="text-right px-1">동반</th>
								<th className="text-right px-1">로테</th>
								<th className="text-right px-1">성별</th>
								<th className="text-right px-1">경기중</th>
								<th className="text-right px-1">참여</th>
								<th className="text-right px-1 font-bold">합계</th>
								<th className="text-right pl-1 font-bold">%</th>
							</tr>
						</thead>
						<tbody>
							{ranked.map((r) => {
								const b = r.breakdown;
								const pct = dbgRange.max === dbgRange.min ? 100 : Math.round(((dbgRange.max - r.score) / (dbgRange.max - dbgRange.min)) * 100);
								return (
									<tr key={r.player.id} className="border-t border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-300">
										<td className="text-left pr-2 whitespace-nowrap">{r.player.name}</td>
										<td className="text-right px-1">{fmtScore(b?.skill)}</td>
										<td className="text-right px-1">{fmtScore(b?.pair)}</td>
										<td className="text-right px-1">{fmtScore(b?.rotate)}</td>
										<td className="text-right px-1">{fmtScore(b?.gender)}</td>
										<td className="text-right px-1">{fmtScore(b?.playing)}</td>
										<td className="text-right px-1">{fmtScore(b?.game)}</td>
										<td className="text-right px-1 font-bold">{r.score.toFixed(1)}</td>
										<td className="text-right pl-1 font-bold">{pct}%</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			{/* 취소 / 자동편성(나머지 자동 채움) / 확인(직접 고른 것만) */}
			<div className="shrink-0 px-5 pb-5 border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] pt-4 flex gap-3">
				<button type="button" onClick={onClose} className="btn-lq-ghost flex-1 py-3 text-sm">
					취소
				</button>
				<button
					type="button"
					onClick={handleAutoFill}
					disabled={!canAddMore || ranked.length === 0}
					className="btn-lq-ghost flex-1 py-3 text-sm disabled:opacity-40"
				>
					자동편성
				</button>
				<button
					type="button"
					onClick={handleConfirm}
					disabled={selectedIds.length === 0}
					className="btn-lq-primary flex-1 py-3 text-sm disabled:opacity-40"
				>
					확인{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
				</button>
			</div>
		</ModalSheet>
	);
}
