import { useCallback, useEffect } from "react";
import { useAppStore } from "../store/appStore";
import { useSessionStore, sessionActions } from "../store/sessionStore";
import CompactCourtBar from "./session/CompactCourtBar";
import EndSessionModal from "./session/EndSessionModal";
import MatchQueue from "./session/MatchQueue";
import RestingList from "./session/RestingList";
import SessionHeader from "./session/SessionHeader";
import TeamCandidatesList from "./session/TeamCandidatesList";
import WaitingList from "./session/WaitingList";

interface Props {
	onBack: () => void;
	onEnd: () => void;
}

export default function SessionMain({ onBack, onEnd }: Props) {
	const sessionId = useAppStore((s) => s.sessionMeta?.sessionId) ?? 0;
	const showEndConfirm = useSessionStore((s) => s.showEndConfirm);
	const subscribe = useSessionStore((s) => s.subscribe);
	const unsubscribe = useSessionStore((s) => s.unsubscribe);
	const handleEndSessionAction = useSessionStore((s) => s.handleEndSession);

	// Subscribe to broadcast channel
	useEffect(() => {
		subscribe(sessionId, onEnd);
		return () => {
			unsubscribe();
		};
	}, [sessionId, onEnd, subscribe, unsubscribe]);

	const handleEndSession = useCallback(
		() => handleEndSessionAction(onEnd),
		[handleEndSessionAction, onEnd],
	);

	return (
		<div
			className="md:max-w-sm md:mx-auto bg-[#fafbff] dark:bg-[#0f172a]"
			style={{ minHeight: "100dvh", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
		>
			{/* ── Sticky area: Header + Compact Court Bar ── */}
			<div
				style={{ position: "sticky", top: 0, zIndex: 50 }}
			>
				<SessionHeader
					onBack={onBack}
					onEndClick={() => sessionActions.setShowEndConfirm(true)}
				/>

				<CompactCourtBar />
			</div>

			{/* ── Scroll area ── */}
			<div>
				<MatchQueue />

				<TeamCandidatesList />

				<WaitingList />

				<RestingList />
			</div>

			{showEndConfirm && (
				<EndSessionModal
					onConfirm={handleEndSession}
					onCancel={() => sessionActions.setShowEndConfirm(false)}
				/>
			)}
		</div>
	);
}
