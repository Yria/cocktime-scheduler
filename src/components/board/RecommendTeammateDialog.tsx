import { useMemo, useState } from "react";
import { Clock3, ListOrdered } from "lucide-react";
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
import { prefersWaitingDraft } from "../../lib/board/waitingDrafts";
import { editingRosterIds } from "../../lib/board/matchRosterEdit";

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

export default function RecommendTeammateDialog({ teamId, seedId, newTeam, onClose }: Props) {
	const commitTeammates = useBoardStore((s) => s.commitTeammates);
	const autoFillTarget = useBoardStore((s) => s.autoFillTarget);
	const removeMemberFromBoard = useBoardStore((s) => s.removeMemberFromBoard);
	const sessionPlayers = useSessionStore((s) => s.sessionPlayers);
	const courts = useSessionStore(s => s.courts);
	const drafts = useBoardStore(s => s.drafts);
	const reservations = useBoardStore(s => s.reservations);
	const magnets = useBoardStore(s => s.magnets);
	const matchEdits = useBoardStore(s => s.matchEdits);
	const cockCheckEnabled = useSessionStore(s => s.cockCheckEnabled);
	const [waitingChoice, setWaitingChoice] = useState<boolean | null>(null);

	// 진행 중 다중선택
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	// 추천 우선순위 확인(운영진용).
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
	const canWait = filledCount < 4 && (!teamId || drafts.get(teamId)?.courtId == null);
	const waitForCompletion = canWait && (waitingChoice ?? prefersWaitingDraft({ teamId, seedId, newTeam }, {
		...useSessionStore.getState(), courts, sessionPlayers, cockCheckEnabled, drafts, reservations, magnets,
	}, selectedIds, editingRosterIds(matchEdits)));
	// 대기 중인 기존 팀에 새로 고른 사람이 없으면 대기 모드 자동편성은 더할 사람이 없다.
	const nothingToWaitFor = !!teamId && waitForCompletion && selectedIds.length === 0 && filledCount >= 2;

	// "실력순" 정렬 기준 밴드 — 알고리즘 skillDiff(스프레드 증가분)와 동일 의미론. 미등급(0)은 제외.
	const skillBand = useMemo(() => {
		const grades = [...members, ...selectedPlayers].map(skillScore).filter((g) => g > 0);
		return grades.length ? { min: Math.min(...grades), max: Math.max(...grades) } : null;
	}, [members, selectedPlayers]);


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
			// "경기중" 배지/흐림은 추천 순위과 무관하게,
			// 실제로 경기중인 선수에게는 항상 표시한다 — 배지는 추천 상태가 아니라 사실(경기중)을 나타낸다.
			// 경기중 판별은 courts 기반 playingIds(status는 경기 시작 직후 갱신 지연).
			isPlaying: playingIds.has(item.player.id),
			rank: index,
			// 밴드 안 후보는 동률(0), 밴드를 넓히는 만큼 후순위 — 확정 멤버가 없으면 고실력 우선.
			skillRank: skillBand
				? Math.max(0, skillBand.min - skillScore(item.player), skillScore(item.player) - skillBand.max)
				: -skillScore(item.player),
			waitSince: item.player.waitSince ?? undefined,
		})),
		[ranked, skillBand, playingIds],
	);

	const handleConfirm = () => {
		if (selectedIds.length === 0 && !teamId) return;
		commitTeammates({ teamId: teamId ?? undefined, seedId: seedId ?? undefined, newTeam }, selectedIds, { waitForCompletion });
		onClose();
	};

	// 자동편성 — 직접 고른 선수(selectedIds)는 그대로 두고 나머지 빈 자리를 추천 대기 선수로 채워 commit.
	const handleAutoFill = () => {
		// 체크박스를 건드리지 않았으면 기본값 판단을 스토어에 맡긴다(같은 prefersWaitingDraft, 안내 문구만 다르다).
		// 편성하지 못하면(안내 토스트) 창을 닫지 않아 대기 체크를 끄고 다시 시도할 수 있다.
		if (autoFillTarget({ teamId: teamId ?? undefined, seedId: seedId ?? undefined, newTeam }, selectedIds, { waitForCompletion: waitingChoice ?? undefined })) onClose();
	};

	const headerNote = teamId
		? `${filledCount}/4명 · 추천에서 골라 팀을 채우세요`
		: newTeam
			? `${filledCount}/4명 · 빈 코트에서 매칭하면 순서대로 배정돼요`
			: `${members[0]?.name ?? ""} 선수와 함께할 팀원을 골라 팀을 만듭니다`;

	return (
		<ModalSheet position="bottom" onClose={onClose} className="max-h-[90dvh] flex flex-col">
			<div className="shrink-0 px-5 pt-5 pb-4 border-b border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]">
				<div className="flex items-center justify-between">
					<h3 className="font-bold text-gray-800 dark:text-white text-lg">추천 팀원</h3>
					<button
						type="button"
						onClick={() => setDebug((d) => !d)}
						className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded ${debug ? "bg-purple-500 text-white" : "text-gray-600 dark:text-gray-300"}`}
						title="추천 우선순위 확인"
						aria-label="추천 우선순위 확인"
						aria-pressed={debug}
					>
						<ListOrdered size={18} aria-hidden="true" />
					</button>
				</div>
				<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{headerNote}</p>

				{/* 현재 팀(확정 멤버 + 선택분) — 자석(원형) 형태, 가운데 정렬 */}
				<div className="-mx-3 flex justify-center items-start gap-0 min-[375px]:gap-2 mt-3">
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
							<PlayerCard name={p.name} gender={p.gender} photoId={p.memberId ?? undefined} skillScore={skillScore(p)} size="sm" />
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
							<PlayerCard name={p.name} gender={p.gender} photoId={p.memberId ?? undefined} skillScore={skillScore(p)} size="sm" selected />
						</div>
					))}
					{Array.from({ length: emptyCount }).map((_, i) => waitForCompletion && i >= Math.max(0, 2 - filledCount) ? (
						<div key={`waiting-${i}`} className="flex w-[68px] shrink-0 justify-center">
							<div className="flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-full border-2 border-dashed border-blue-500 bg-blue-50 text-blue-800 dark:border-blue-300 dark:bg-blue-950 dark:text-blue-200">
								<Clock3 size={17} aria-hidden="true" /><span className="text-[11px] font-semibold">합류 대기</span>
							</div>
						</div>
					) : (
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
				{canWait && <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-blue-50 p-3 text-blue-950 dark:bg-blue-950/60 dark:text-blue-100">
					<input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-blue-600" checked={waitForCompletion}
						onChange={event => setWaitingChoice(event.target.checked)} aria-describedby="waiting-team-help" />
					<span><span className="text-sm font-semibold">경기 완료 후 빈자리 채우기</span>
						<span id="waiting-team-help" className="mt-1 block text-xs leading-relaxed text-blue-800 dark:text-blue-200">
							2~3명으로 대기하다가 경기가 끝나면 가능한 조합으로 4명을 채워요. 빈 코트 매칭 시 대기팀끼리 합쳐질 수 있어요. 지금 채우려면 체크를 끄고 자동편성을 누르세요.
						</span>
					</span>
				</label>}
			</div>

			<div className="min-h-0 overflow-y-auto px-5 py-2">
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
					maxHeight={debug || canWait ? "26vh" : "34vh"}
					emptyMessage="추천 가능한 선수가 없습니다"
					noResultMessage="검색 결과가 없습니다"
				/>
			</div>

			{debug && ranked.length > 0 && (
				<div className="flex-1 min-h-0 overflow-auto px-5 pb-3">
					<p className="text-xs text-gray-500 dark:text-gray-400 mb-2">후보를 포함한 최선의 4명 조합 · 왼쪽 조건부터 비교 · 남은 경기 수는 많을수록 우선</p>
					<table className="text-xs w-full border-collapse">
						<thead><tr>{["이름", "경기 중", "남은 경기", "출전 초과", "중복 벌점", "동반 반복", "보조 점수"].map(label => <th key={label} className="px-1 py-2 text-left break-keep">{label}</th>)}</tr></thead>
						<tbody>{ranked.map(({ player, priority: p }) => (
							<tr key={player.id} className="border-t border-gray-100 dark:border-gray-800">
								<td className="px-1 py-2 whitespace-nowrap">{player.name}</td>
								{[p.playing, p.remainingCapacity, p.overplay, p.maximumOverlap, p.repeatedPairs, p.quality.toFixed(1)].map((value, i) => <td key={i} className="px-1 py-2">{value}</td>)}
							</tr>
						))}</tbody>
					</table>
				</div>
			)}

			{/* 취소 / 자동편성(나머지 자동 채움) / 확인(직접 고른 것만) */}
			<div className="shrink-0 px-5 pb-5 border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] pt-4 flex gap-3">
				<button type="button" onClick={onClose} className="btn-lq-ghost flex-1">
					취소
				</button>
				<button
					type="button"
					onClick={handleAutoFill}
					disabled={!canAddMore || nothingToWaitFor || (ranked.length === 0 && !(waitForCompletion && filledCount >= 2))}
					className="btn-lq-ghost flex-1 disabled:opacity-40"
				>
					자동편성
				</button>
				<button
					type="button"
					onClick={handleConfirm}
					disabled={(selectedIds.length === 0 && !(teamId && waitingChoice != null && members.length >= 2)) || (waitForCompletion && filledCount < 2)}
					className="btn-lq-primary flex-1 disabled:opacity-40"
				>
					확인{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
				</button>
			</div>
		</ModalSheet>
	);
}
