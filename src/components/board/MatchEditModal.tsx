import { useMemo, useState } from "react";
import { useSessionStore } from "../../store/sessionStore";
import { useBoardStore } from "../../store/boardStore";
import { skillScore } from "../../lib/teamSelection";
import ModalSheet from "../common/ModalSheet";
import PlayerCard from "../shared/PlayerCard";

type Props = { courtId: number; onClose: () => void };

/**
 * 경기 수정(특수 액션) — 진행중 매치의 로스터를 자유롭게 편집.
 * 현재 4명 중 하나 + 아래 목록(경기중 아닌 전원) 중 하나를 고르면 서로 자리가 바뀐다(로컬 스테이징).
 * 여러 번 바꾼 뒤 "수정하기"를 누르면 최종 로스터만 서버에 반영(동기화 없음).
 */
export default function MatchEditModal({ courtId, onClose }: Props) {
	const court = useSessionStore((s) => s.courts.find((c) => c.id === courtId));
	const sessionPlayers = useSessionStore((s) => s.sessionPlayers);
	const setMatchRoster = useBoardStore((s) => s.setMatchRoster);

	const match = court?.match ?? null;
	const original = useMemo<string[]>(
		() => (match ? [match.teamA[0], match.teamA[1], match.teamB[0], match.teamB[1]] : []),
		[match],
	);

	// 스테이징 로스터(슬롯 0=A1,1=A2,2=B1,3=B2)
	const [roster, setRoster] = useState<string[]>(original);
	const [selSlot, setSelSlot] = useState<number | null>(null);
	const [selBench, setSelBench] = useState<string | null>(null);

	// 선택 가능한 전체 풀 = 원래 4명 ∪ 경기중 아닌 전원. bench = 풀 − 현재 로스터.
	const benchIds = useMemo(() => {
		const universe = new Set<string>(original);
		for (const p of sessionPlayers.values()) {
			if (p.status !== "playing") universe.add(p.id);
		}
		return [...universe].filter((id) => !roster.includes(id));
	}, [original, sessionPlayers, roster]);

	if (!match) return null;

	const swap = (slot: number, benchId: string) => {
		setRoster((r) => r.map((id, i) => (i === slot ? benchId : id)));
		setSelSlot(null);
		setSelBench(null);
	};
	const clickSlot = (slot: number) => {
		if (selBench !== null) swap(slot, selBench);
		else setSelSlot(slot === selSlot ? null : slot);
	};
	const clickBench = (id: string) => {
		if (selSlot !== null) swap(selSlot, id);
		else setSelBench(id === selBench ? null : id);
	};

	const changed = roster.some((id, i) => id !== original[i]);

	const apply = () => {
		if (!changed) return;
		setMatchRoster(courtId, [roster[0], roster[1]], [roster[2], roster[3]]);
		onClose();
	};

	const card = (id: string, selected: boolean, onClick: () => void) => {
		const p = sessionPlayers.get(id);
		if (!p) return null;
		return (
			<div
				key={id}
				style={{
					position: "relative",
					borderRadius: 16,
					padding: 4,
					background: selected ? "rgba(0,122,255,0.16)" : "transparent",
					boxShadow: selected ? "0 0 0 3px var(--ios-blue)" : "none",
					transition: "background 120ms ease, box-shadow 120ms ease",
				}}
			>
				<PlayerCard
					name={p.name}
					gender={p.gender}
					skillScore={skillScore(p)}
					size="sm"
					selected={selected}
					onClick={onClick}
				/>
				{selected && (
					<span
						style={{
							position: "absolute",
							top: -7,
							left: "50%",
							transform: "translateX(-50%)",
							background: "var(--ios-blue)",
							color: "#fff",
							fontSize: 9,
							fontWeight: 800,
							lineHeight: 1,
							padding: "3px 7px",
							borderRadius: 999,
							whiteSpace: "nowrap",
							boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
						}}
					>
						선택됨
					</span>
				)}
			</div>
		);
	};

	return (
		<ModalSheet position="bottom" onClose={onClose} className="max-h-[90dvh] flex flex-col">
			<div className="shrink-0 px-5 pt-5 pb-3 border-b border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]">
				<h3 className="font-bold text-gray-800 dark:text-white text-lg">경기 수정 · {courtId}번 코트</h3>
				<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
					바꿀 선수와 아래 목록의 선수를 고르면 자리가 바뀝니다 · {match.gameType}
				</p>
			</div>

			{/* 현재 로스터(스테이징) */}
			<div className="shrink-0 px-5 py-4">
				<div className="flex justify-center items-start gap-3">
					{[0, 1].map((i) => card(roster[i], selSlot === i, () => clickSlot(i)))}
				</div>
				<div className="text-center text-xs font-bold text-gray-400 dark:text-gray-500 my-1">vs</div>
				<div className="flex justify-center items-start gap-3">
					{[2, 3].map((i) => card(roster[i], selSlot === i, () => clickSlot(i)))}
				</div>
			</div>

			{/* 교체 후보 — 경기중 아닌 전원 */}
			<div className="flex-1 min-h-0 overflow-auto px-5 pb-2 border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] pt-3">
				<p className="text-xs font-semibold text-gray-500 dark:text-gray-300 mb-2">교체할 선수 ({benchIds.length})</p>
				{benchIds.length === 0 ? (
					<p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">교체 가능한 선수가 없습니다</p>
				) : (
					<div className="flex flex-wrap justify-center gap-2">
						{benchIds.map((id) => card(id, selBench === id, () => clickBench(id)))}
					</div>
				)}
			</div>

			<div className="shrink-0 px-5 pb-5 border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] pt-4 flex gap-3">
				<button type="button" onClick={onClose} className="btn-lq-ghost flex-1 py-3 text-sm">
					취소
				</button>
				<button
					type="button"
					onClick={apply}
					disabled={!changed}
					className="btn-lq-primary flex-1 py-3 text-sm disabled:opacity-40"
				>
					수정하기
				</button>
			</div>
		</ModalSheet>
	);
}
