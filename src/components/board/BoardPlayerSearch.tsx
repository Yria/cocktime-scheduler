import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Search, X } from "lucide-react";
import ModalSheet from "../common/ModalSheet";
import { useBoardStore } from "../../store/boardStore";
import { useSessionStore } from "../../store/sessionStore";
import { useMatchProposalStore } from "../../store/matchProposalStore";
import { proposalComposer } from "../../hooks/useMatchProposals";
import { createBoardProjection } from "../../lib/board/pixi/projection";
import { findBoardPlayers } from "../../lib/board/playerLocator";

export default function BoardPlayerSearch({ onClose, onSelect }: {
	onClose: () => void;
	onSelect: (playerId: string, name: string) => void;
}) {
	const [query, setQuery] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const dialog = useRef<HTMLDivElement>(null);
	const board = useBoardStore();
	const session = useSessionStore();
	useMatchProposalStore();
	const project = useMemo(() => createBoardProjection(), []);
	const results = findBoardPlayers(project(board, session, proposalComposer.getSnapshot()), query);
	useLayoutEffect(() => {
		const previous = document.activeElement;
		input.current?.focus({ preventScroll: true });
		return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
	}, []);
	return <ModalSheet onClose={onClose} closeOnEscape position="center">
		<div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="board-search-title" className="p-5"
			onKeyDown={(event) => {
				if (event.key !== "Tab") return;
				const controls = dialog.current?.querySelectorAll<HTMLElement>("button, input");
				if (!controls?.length) return;
				const first = controls[0], last = controls[controls.length - 1];
				if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
				else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
			}}>
			<div className="mb-4 flex items-center justify-between gap-3">
				<h2 id="board-search-title" className="text-lg font-bold text-gray-900 dark:text-white">회원 찾기</h2>
				<button type="button" aria-label="검색 닫기" onClick={onClose}
					className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 focus-visible:outline-2 focus-visible:outline-blue-500">
					<X size={20} aria-hidden="true" />
				</button>
			</div>
			<form onSubmit={(event) => {
				event.preventDefault();
				if (results[0]) onSelect(results[0].player.id, results[0].player.name);
			}}>
				<label htmlFor="board-player-query" className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-200">이름 또는 초성</label>
				<div className="relative">
					<Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
					<input ref={input} id="board-player-query" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}
						placeholder="예: 김민지, ㄱㅁㅈ" autoComplete="off" enterKeyHint="search" spellCheck={false}
						className="h-12 w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3 text-base text-gray-900 placeholder:text-gray-500 focus:border-blue-500 focus:outline-2 focus:outline-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-400" />
				</div>
			</form>
			<p role="status" className="sr-only">{query.trim() ? `${results.length}명 검색됨` : "이름이나 초성을 입력해 주세요."}</p>
			<div className="mt-3 max-h-[36dvh] overflow-y-auto overscroll-contain">
				{!query.trim() ? <p className="py-5 text-center text-sm text-gray-500 dark:text-gray-400">찾을 회원의 이름을 입력해 주세요.</p>
					: !results.length ? <p className="py-5 text-center text-sm text-gray-500 dark:text-gray-400">일치하는 회원이 없어요.</p>
					: <ul className="space-y-2">{results.map(({ player, locations }) => <li key={player.id}>
						<button type="button" onClick={() => onSelect(player.id, player.name)}
							className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-gray-100 px-4 py-3 text-left active:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-500 dark:bg-gray-800 dark:active:bg-gray-700">
							<span className="min-w-0 flex-1"><span className="block break-words font-semibold text-gray-900 dark:text-white">{player.name}</span>
								<span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-300">{locations.join(" · ")}</span></span>
							<Crosshair size={20} aria-hidden="true" className="shrink-0 text-blue-600 dark:text-blue-400" />
						</button>
					</li>)}</ul>}
			</div>
		</div>
	</ModalSheet>;
}
