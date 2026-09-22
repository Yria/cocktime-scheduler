import { useMatchProposalStore } from "../../store/matchProposalStore";
import { useBoardStore } from "../../store/boardStore";
import { useSessionStore } from "../../store/sessionStore";
import { applySubmittedProposal } from "../../hooks/useMatchProposals";
import { teamMembers } from "../../lib/board/membership";
import ModalSheet from "../common/ModalSheet";

export default function ProposalCourtDialog() {
	const proposalId = useMatchProposalStore(state => state.targetProposalId);
	const isEditor = useSessionStore(state => state.isEditor);
	const courts = useSessionStore(state => state.courts);
	const players = useSessionStore(state => state.sessionPlayers);
	const drafts = useBoardStore(state => state.drafts);
	const reservations = useBoardStore(state => state.reservations);
	const assigning = useBoardStore(state => state.assigningTeamIds);
	if (!proposalId || !isEditor) return null;
	return <ModalSheet title="편성제안을 넣을 코트" subtitle="선택한 그룹의 기존 명단과 예약이 교체됩니다."
		onClose={() => useMatchProposalStore.setState({ targetProposalId: null })} closeOnEscape>
		<div className="px-5 pb-5 space-y-2" role="group" aria-label="배치할 코트">
			{courts.map(court => {
				const team = [...drafts.values()].find(item => item.courtId === court.id);
				const busy = !!court.match || !team || assigning.has(team.id);
				const names = team ? teamMembers(team.id, drafts, reservations).map(member => players.get(member.playerId)?.name).filter(Boolean).join(", ") : "";
				return <button key={court.id} type="button" disabled={busy}
					className="btn-lq-secondary w-full px-4 text-left disabled:opacity-40"
					onClick={() => { if (team) void applySubmittedProposal(proposalId, team.id); }}>
					<span className="block font-bold">{court.id}번 코트{court.match ? " · 경기 중" : ""}</span>
					<span className="block text-xs mt-1">{court.match ? "경기 중에는 교체할 수 없어요" : names || "빈 그룹"}</span>
				</button>;
			})}
		</div>
	</ModalSheet>;
}
