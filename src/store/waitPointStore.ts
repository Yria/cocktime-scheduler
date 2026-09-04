import { create } from "zustand";
import {
	type WaitPointEntry,
	type WaitPointStatus,
	fetchWaitPointLedger,
	fetchWaitPointStatus,
} from "../lib/supabase/waitPoints";

// 대기 포인트 스토어. duesStore 관례(uncurried create + 별도 actions 객체)를 따른다.
//
// 갱신 시점을 좁게 잡는다 — 앱 진입 1회 + 참석 신청/취소 성공 직후 + 내 정보 모달을 열 때뿐이다.
// (무료 플랜 호출 폭주 이력이 있어 새 폴링·구독을 붙이지 않는다. 포인트는 회차가 끝나야 움직이므로
//  실시간성이 필요 없다.)

interface WaitPointState {
	/** null = 아직 안 불러왔거나 조회 실패. 화면은 이때 티켓 UI 를 아예 감춘다. */
	status: WaitPointStatus | null;
	/** 내역. 내 정보 모달을 열 때만 채운다(홈 진입에는 잔액만 필요). */
	ledger: WaitPointEntry[];
	ledgerLoading: boolean;
	ledgerLoaded: boolean;
	/** 티켓 사용 RPC 왕복 중 — 헤더 배지를 잠시 감춰 이중 사용을 시각적으로 막는다. */
	spending: boolean;
}

export const useWaitPointStore = create<WaitPointState>(() => ({
	status: null,
	ledger: [],
	ledgerLoading: false,
	ledgerLoaded: false,
	spending: false,
}));

const set = useWaitPointStore.setState;

export const waitPointActions = {
	/** 잔액만 새로 읽는다. 로그아웃/비회원이면 서버가 예외를 던지고 status 는 null 로 남는다. */
	async loadStatus() {
		const status = await fetchWaitPointStatus();
		set({ status });
	},

	/**
	 * 내역 로드. 호출부(내 정보 모달)는 **항상 force** 로 부른다 — 티켓을 쓴 직후 모달을 열면
	 * 캐시된 옛 내역에 'spend' 행이 빠져 보이기 때문이다. ledgerLoaded 는 첫 화면의 빈 상태
	 * 판정에만 쓰고, 중복 발사는 ledgerLoading 인플라이트 가드가 막는다.
	 */
	async loadLedger(force = false) {
		const st = useWaitPointStore.getState();
		if (st.ledgerLoading) return;
		if (!force && st.ledgerLoaded) return;
		set({ ledgerLoading: true });
		const [ledger, status] = await Promise.all([
			fetchWaitPointLedger(),
			fetchWaitPointStatus(),
		]);
		set({ ledger, status, ledgerLoading: false, ledgerLoaded: true });
	},

	setSpending(spending: boolean) {
		set({ spending });
	},

	/** 로그아웃·회원 전환 시 초기화(다른 사람의 잔액이 남아 보이지 않게). */
	reset() {
		set({
			status: null,
			ledger: [],
			ledgerLoading: false,
			ledgerLoaded: false,
			spending: false,
		});
	},
};
