import { useState } from "react";
import { Check, ChevronRight, LockKeyhole, Send, X } from "lucide-react";
import { useMatchProposalStore } from "../../store/matchProposalStore";
import { useAuthStore } from "../../store/authStore";
import { useSessionStore } from "../../store/sessionStore";
import { matchProposalScope, proposalComposer, resolveProposal } from "../../hooks/useMatchProposals";
import ModalSheet from "../common/ModalSheet";
import "./MatchProposalPanel.css";

export default function MatchProposalPanel() {
	const state = useMatchProposalStore();
	const isAdmin = useAuthStore((s) => s.isAdmin);
	const userId = useAuthStore((s) => s.user?.id);
	const players = useSessionStore((s) => s.sessionPlayers);
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	if (!state.scope || state.scope !== matchProposalScope()) return null;
	// Defense in depth for account changes; database SELECT RLS is the privacy boundary.
	const proposals = state.proposals.filter((proposal) => isAdmin || proposal.created_by === userId);
	const pending = proposals.filter((proposal) => proposal.status === "pending");
	if (!isAdmin && !state.enabled) return null;
	const resolve = async (id: string, status: "reviewed" | "withdrawn") => {
		if (busy) return;
		setBusy(id); setError(null);
		try { await resolveProposal(id, status); }
		catch { setError("처리하지 못했어요. 다시 눌러주세요."); }
		finally { setBusy(null); }
	};
	return <>
		<button type="button" className={`proposal-dock${pending.length ? " has-proposals" : ""}`}
			onClick={() => setOpen(true)} aria-label={isAdmin ? `매칭 제안 ${pending.length}건` : "내 매칭 제안"}>
			<Send size={17} aria-hidden="true" />
			<span><strong>{isAdmin ? `매칭 제안 ${pending.length}건` : state.groups.length ? `만드는 중 ${state.groups.length}개` : "매칭 제안"}</strong>
				<small>{isAdmin ? pending[0]?.player_names.join(" · ") ?? "새 제안을 기다리고 있어요" : "회원을 끌어 묶어보세요 · 1~4명"}</small></span>
			<ChevronRight size={16} aria-hidden="true" />
		</button>
		{open && <ModalSheet className="proposal-sheet" title={isAdmin ? "회원들의 매칭 제안" : "내 매칭 제안"}
			subtitle="작성자와 운영진에게만 보여요" onClose={() => setOpen(false)} closeOnEscape>
			<div className="proposal-panel" role="dialog" aria-modal="true" aria-label={isAdmin ? "회원들의 매칭 제안" : "내 매칭 제안"}>
				<p className="proposal-help"><LockKeyhole size={16} aria-hidden="true" />제안은 실제 팀이나 경기 순서를 바꾸지 않아요.</p>
				{!isAdmin && <p className="proposal-guide">보드의 회원을 겹쳐 놓으면 묶을 수 있어요. 빈 곳으로 옮기면 1명으로도 제안할 수 있고, 묶음 밖으로 빼면 선택이 해제돼요.</p>}
				{state.groups.map((group) => <article className="proposal-item" key={group.id}>
					<div className="proposal-item-heading"><strong>아직 보내지 않은 묶음</strong><span>{group.playerIds.length}/4명</span></div>
					<div className="proposal-players">{group.playerIds.map((id) => <span key={id}>{players.get(id)?.name ?? "참가 종료"}</span>)}</div>
					<div className="proposal-actions">
						<button type="button" disabled={state.sendingIds.has(group.id)} onClick={() => proposalComposer.removeGroup(group.id)}><X size={16} />묶음 해제</button>
						<button type="button" className="proposal-primary" disabled={state.sendingIds.has(group.id)} onClick={() => proposalComposer.submit(group.id)}>
							<Send size={16} />{state.sendingIds.has(group.id) ? "보내는 중…" : "매칭 제안"}
						</button>
					</div>
				</article>)}
				{proposals.map((proposal) => <article className="proposal-item" key={proposal.id}>
					<div className="proposal-item-heading"><strong>{isAdmin ? `${proposal.creator_name}님의 제안` : "보낸 제안"}</strong>
						<span className={proposal.status === "reviewed" ? "proposal-reviewed" : ""}>{proposal.status === "reviewed" ? "운영진 확인" : "확인 대기"}</span></div>
					<div className="proposal-players">{proposal.player_names.map((name, index) => <span key={proposal.player_ids[index]}>{name}</span>)}</div>
					<div className="proposal-actions">
						{proposal.created_by === userId && <button type="button" disabled={busy !== null} onClick={() => void resolve(proposal.id, "withdrawn")}><X size={16} />제안 취소</button>}
						{isAdmin && proposal.status === "pending" && <button type="button" className="proposal-primary" disabled={busy !== null} onClick={() => void resolve(proposal.id, "reviewed")}>
							<Check size={16} />{busy === proposal.id ? "처리 중…" : "확인했어요"}
						</button>}
					</div>
				</article>)}
				{!state.groups.length && !proposals.length && <p className="proposal-empty">{state.loading ? "제안을 불러오는 중…" : isAdmin ? "아직 받은 제안이 없어요." : "아직 보낸 제안이 없어요. 보드에서 원하는 회원을 묶어보세요."}</p>}
				{(error || state.error) && <p className="proposal-error" role="alert">{error || state.error}</p>}
			</div>
		</ModalSheet>}
	</>;
}
