import { create } from "zustand";

/** 디버그 전용 전역 상태 — 자석 롱프레스 시 매칭 기록 모달을 띄운다. */
interface DebugState {
	/** 디버그 모달 대상 선수(session_players.id). null이면 모달 닫힘. */
	debugPlayerId: string | null;
	openDebug: (playerId: string) => void;
	closeDebug: () => void;
}

export const useDebugStore = create<DebugState>((set) => ({
	debugPlayerId: null,
	openDebug: (playerId) => set({ debugPlayerId: playerId }),
	closeDebug: () => set({ debugPlayerId: null }),
}));
