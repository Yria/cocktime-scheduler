import { useCallback, useMemo, useRef, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { Check, Fingerprint, LockKeyhole, Sparkles, Zap } from "lucide-react";
import { PARTY_REASON, useMemberParty } from "../../hooks/useMemberParty";
import { useSessionStore } from "../../store/sessionStore";
import { useBoardStore } from "../../store/boardStore";
import { getMemberPartyCandidates } from "../../lib/board/memberParty";
import PlayerAvatar from "../shared/PlayerAvatar";
import "./MemberPartyPanel.css";

export default function MemberPartyPanel() {
	const party = useMemberParty();
	if (!party.state?.available || !party.state.myPlayerId) return null;
	return <MemberPartyContent party={party} />;
}

function MemberPartyContent({ party }: { party: ReturnType<typeof useMemberParty> }) {
	const session = useSessionStore(useShallow((s) => ({ sessionPlayers: s.sessionPlayers, courts: s.courts, groupHistory: s.groupHistory, lastGameType: s.lastGameType, cockCheckEnabled: s.cockCheckEnabled })));
	const board = useBoardStore(useShallow((s) => ({ magnets: s.magnets, drafts: s.drafts, reservations: s.reservations })));
	const candidates = useMemo(() => getMemberPartyCandidates({ ...session, ...board }), [session, board]);
	const players = session.sessionPlayers;
	const activePointer = useRef<number | null>(null);
	const holdButtonRef = useCallback((node: HTMLButtonElement | null) => {
		// The button can disappear before pointerup when edit authority changes.
		// Clear its capture identity so a later read-only visit accepts a new press.
		if (!node) activePointer.current = null;
	}, []);
	const { state, holding, remainingMs, notice, error } = party;
	if (!state?.available || !state.myPlayerId) return null;
	const participantIds = new Set(state.participants);
	// Reflect this device's physical press immediately, even before the RPC returns.
	if (holding) participantIds.add(state.myPlayerId);
	else participantIds.delete(state.myPlayerId);
	const participants = candidates.filter((player) => participantIds.has(player.id));
	const eligible = state.eligible && candidates.some((player) => player.id === state.myPlayerId);
	const count = participants.length;
	const seconds = Math.ceil(remainingMs / 1000);
	const progress = state.roundId ? Math.min(1, Math.max(0, 1 - remainingMs / 5000)) : 0;
	const completed = !state.roundId && party.result?.status === "created";
	const canJoinNext = completed && eligible;
	const selected = completed ? (party.result?.memberIds ?? []).map((id) => players.get(id)).filter((p) => p !== undefined) : [];
	const orbitPlayers = completed ? selected : participants;
	const endHold = () => {
		activePointer.current = null;
		party.end();
	};
	const endPointer = (event: PointerEvent<HTMLButtonElement>) => {
		if (activePointer.current !== event.pointerId) return;
		endHold();
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
	};
	const nextParty = () => {
		endHold();
		party.clearResult();
	};

	return createPortal(
		<div className="member-party-overlay">
		<div className="member-party-dim" aria-hidden="true" />
		<section className={`member-party${holding ? " is-charging" : ""}${state.roundId ? " is-matching" : ""}${completed ? " is-complete" : ""}`} aria-label="회원 파티 만들기">
			<div className="member-party-arena">
				<div className="member-party-people" aria-label={completed ? "선정된 파티 회원" : "현재 참여 회원"}>
					{orbitPlayers.slice(0, 10).map((player, index) => {
						const angle = (-90 + [1, 6, 9, 4, 0, 5, 2, 7, 3, 8][index] * 36) * Math.PI / 180;
						return <div key={player.id} className={`member-party-orbit-player${player.id === state.myPlayerId ? " is-me" : ""}`} style={{
							left: `${50 + Math.cos(angle) * 42}%`, top: `${50 + Math.sin(angle) * 42}%`, "--join-delay": `${index * 45}ms`,
						} as CSSProperties}>
							<div className="member-party-avatar">
								<PlayerAvatar name={player.name} gender={player.gender} photoId={player.memberId ?? undefined} size={48} ringWidth={2} />
								<span className="member-party-player-check" aria-hidden="true"><Check size={10} strokeWidth={3} /></span>
							</div>
							<span className="member-party-person-name">{player.name}{player.id === state.myPlayerId && <b>나</b>}</span>
						</div>;
					})}
				</div>
				<div className="member-party-core" style={{ "--party-progress": `${progress * 100}%` } as CSSProperties}>
					<span className="member-party-core-ring" aria-hidden="true" />
					<button
						ref={holdButtonRef}
						type="button"
						className={`member-party-hold${holding ? " is-holding" : ""}`}
						aria-label="누르고 있는 동안 파티 참여"
						aria-pressed={holding}
						aria-describedby={completed ? undefined : "member-party-help"}
						disabled={!eligible}
						onPointerDown={(event) => {
							if (event.button !== 0 || !event.isPrimary || activePointer.current !== null) return;
							activePointer.current = event.pointerId;
							event.preventDefault();
							event.currentTarget.focus({ preventScroll: true });
							event.currentTarget.setPointerCapture(event.pointerId);
							party.begin();
						}}
						onPointerUp={endPointer}
						onPointerCancel={endPointer}
						onLostPointerCapture={endPointer}
						onBlur={endHold}
						onContextMenu={(event) => event.preventDefault()}
						onKeyDown={(event) => {
							if (event.key !== " " && event.key !== "Enter") return;
							event.preventDefault();
							if (!event.repeat) party.begin();
						}}
						onKeyUp={(event) => {
							if (event.key === " " || event.key === "Enter") { event.preventDefault(); endHold(); }
						}}
					>
						<span className="member-party-core-caption">{completed && !canJoinNext ? "PARTY FOUND" : holding ? "MATCHING" : "HOLD TO JOIN"}</span>
						{completed && !canJoinNext ? <Check className="member-party-core-icon" size={42} strokeWidth={2} /> : holding ? <b className="member-party-timer">{seconds || "…"}<small>SEC</small></b> : <Fingerprint className="member-party-core-icon" size={44} strokeWidth={1.4} />}
						<strong>{canJoinNext ? "다음 파티 참여" : completed ? "파티 완성!" : holding ? "손을 떼지 마세요" : "꾹 눌러 참여"}</strong>
						<small>{canJoinNext ? "다시 꾹 눌러주세요" : completed ? "보드에서 만나요" : holding ? "함께할 4명을 찾는 중" : "함께 누르면 매칭 시작"}</small>
					</button>
				</div>
			</div>

			<div className="member-party-count" role="status">
				<div className="member-party-count-heading"><span>{completed ? <Sparkles size={15} /> : <Zap size={15} />}{completed ? "4명 파티 완성" : <strong>{count}명 참여 중</strong>}</span>{orbitPlayers.length > 10 && <b className="member-party-more">+{orbitPlayers.length - 10}</b>}<span>{completed ? "READY TO PLAY" : state.roundId ? `${seconds > 0 ? `${seconds}초 후` : "잠시 후"} 4명 선정` : "4명이 모이면 준비 완료"}</span></div>
				<div className="member-party-slots" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <span key={index} className={completed || count > index ? "filled" : ""} />)}</div>
			</div>
			{canJoinNext && <button type="button" className="member-party-next" onClick={nextParty}>다음 파티 만들기</button>}
			{!completed && <>
			<p id="member-party-help" className="member-party-help">
				{!eligible ? PARTY_REASON[state.reason ?? ""] ?? "팀 없는 대기 회원만 참여할 수 있어요." : "손을 떼면 참여 해제 · 4명 미만이면 취소"}
			</p>
			<div className="member-party-feedback">{(notice || error) ? <p className={`member-party-notice${error ? " is-error" : ""}`} role="status">{error ?? notice}</p> : <span className="member-party-mode"><LockKeyhole size={11} /> 읽기 모드 전용 <i /> 첫 참여부터 5초 동안 모집</span>}</div>
			</>}
		</section>
		</div>,
		document.body,
	);
}
