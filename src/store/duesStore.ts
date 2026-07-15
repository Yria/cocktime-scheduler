import { create } from "zustand";
import {
	type AdminMemberRow,
	fetchMembersForAdmin,
} from "../lib/supabase/adminMembers";
import {
	type BankTxnRow,
	type ClubAccount,
	type CourtChargeRow,
	type MonthlyChargeRow,
	type MyChargeRow,
	type MyPayment,
	type PublicLedger,
	type SessionFeeRow,
	type TxAllocation,
	type TxnCategory,
	type UnpaidCharge,
	type UpcomingSessionRow,
	fetchBankTransactions,
	fetchCategories,
	fetchClubAccount,
	fetchCourtCharges,
	fetchDuesSettings,
	fetchLedgerSessions,
	fetchMonthlyCharges,
	fetchMyCharges,
	fetchMyPayments,
	fetchPublicLedger,
	fetchSessionTxns,
	fetchTxAllocations,
	fetchUnpaidByMember,
	fetchUpcomingParticipating,
} from "../lib/supabase/dues";

// 회비 데이터 스토어(scheduleStore/authStore 관례: uncurried create + 별도 actions 객체).
// setState 를 컴포넌트 밖(스토어)에서 하여 effect 내 동기 setState 규칙(React Compiler)을 피한다.
//
// 최적화(ACCOUNTING_SPEC §11): 관리자 화면 3개(정모·정산함·회계)는 같은 달 데이터를 공유하므로
// loadMonth(ym) 한 번으로 공통 데이터를 로드하고 loadedYm 로 캐시 — 화면 전환 시 재조회 없음.
// 뮤테이션(확인/취소/분류/가져오기) 후에만 loadMonth(ym, true)로 무효화.

interface DuesState {
	// ── 공통 월 데이터(정모·정산함·회계 공유) ──────────────────────
	loadedYm: string | null; // 캐시 가드(같은 ym 재진입 시 refetch skip)
	monthLoading: boolean;
	members: AdminMemberRow[]; // 게스트 포함 전체(roster=활성 비운영진은 파생)
	monthly: MonthlyChargeRow[]; // 그 달 회비 부과
	court: CourtChargeRow[]; // 그 달 세션 대관비 부과
	bankTxns: BankTxnRow[]; // 그 달 은행 입출금
	monthSessions: SessionFeeRow[]; // 그 달 대관 세션
	ledgerSessions: SessionFeeRow[]; // ±1개월 대관 세션(출금→세션 지정용)
	upcomingSessions: UpcomingSessionRow[]; // 참가 예정(open) 대관 세션 + 참가자 — 정산함 선납 후보(now 기준)
	sessionTxns: { sessionId: number; direction: "in" | "out"; amount: number }[]; // 세션 링크 거래(발생월 무관)
	categories: TxnCategory[]; // 거래 분류
	unpaidByMember: Record<string, UnpaidCharge[]>; // 전체 미납(크로스먼스 배분용)
	txAllocations: Record<number, TxAllocation>; // 거래별 처리내역(라벨·세션)
	monthlyFee: number;
	courtFee: number;

	// ── 내 회비(회원 본인) ──────────────────────────────────────────
	myLoading: boolean;
	myCharges: MyChargeRow[];
	myPayments: MyPayment[]; // 실제 납부 이력(부과 배분 + paid_by 카테고리)
	account: ClubAccount | null;
	myLedger: PublicLedger | null; // 클럽 공개 회계(항목별만) — 선택 월
	myLedgerYm: string | null; // myLedger가 담고 있는 월
	myLedgerLoading: boolean;
}

export const useDuesStore = create<DuesState>(() => ({
	loadedYm: null,
	monthLoading: true,
	members: [],
	monthly: [],
	court: [],
	bankTxns: [],
	monthSessions: [],
	ledgerSessions: [],
	upcomingSessions: [],
	sessionTxns: [],
	categories: [],
	unpaidByMember: {},
	txAllocations: {},
	monthlyFee: 5000,
	courtFee: 6000,
	myLoading: true,
	myCharges: [],
	myPayments: [],
	account: null,
	myLedger: null,
	myLedgerYm: null,
	myLedgerLoading: true,
}));

/** ISO(timestamptz)가 KST 기준 ym('YYYY-MM')에 속하는지. monthSessions 파생용. */
function isInYm(iso: string | null, ym: string): boolean {
	if (!iso) return false;
	const kst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
	return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}` === ym;
}

// 클럽 회계 로드 경합 가드용 시퀀스(빠른 월 이동 시 오래된 응답이 최신 표시를 덮지 않게).
let ledgerReq = 0;

export const duesActions = {
	/**
	 * 관리자 월 데이터 통합 로드. 같은 ym 캐시(force로 무효화).
	 * 정모·정산함·회계가 공유 — 한 번의 병렬 조회 wave + sessionTxns(세션 id 필요) 순차.
	 */
	async loadMonth(ym: string, force = false) {
		const s = useDuesStore.getState();
		if (!force && s.loadedYm === ym && !s.monthLoading) return; // 캐시 히트
		useDuesStore.setState({ monthLoading: true });
		// wave 1: 서로 독립인 조회 병렬. (정적: members·sessions·categories·settings / 가변: charges·txns·unpaid)
		// monthSessions는 ledgerSessions(±1개월 상위집합)에서 파생 — 세션 쿼리 1회로(§11).
		const [members, monthly, court, bankTxns, ledgerSessions, categories, settings, unpaidByMember, upcomingSessions] = await Promise.all([
			fetchMembersForAdmin(true), // 게스트 포함 — 대관비 입금 매칭용
			fetchMonthlyCharges(ym),
			fetchCourtCharges(ym),
			fetchBankTransactions(ym),
			fetchLedgerSessions(ym),
			fetchCategories(),
			fetchDuesSettings(),
			fetchUnpaidByMember(),
			fetchUpcomingParticipating(), // now 기준 참가 예정 세션(ym 무관)
		]);
		const monthSessions = ledgerSessions.filter((x) => isInYm(x.scheduledAt, ym));
		// wave 2: 앞 결과 id가 필요한 조회(세션 링크 거래 · 이번 달 거래 배분만 — 전역 배분 누적 회피).
		const [sessionTxns, txAllocations] = await Promise.all([
			fetchSessionTxns(monthSessions.map((x) => x.id)),
			fetchTxAllocations(bankTxns.map((t) => t.id)),
		]);
		useDuesStore.setState({
			members,
			monthly,
			court,
			bankTxns,
			monthSessions,
			ledgerSessions,
			upcomingSessions,
			categories,
			sessionTxns,
			unpaidByMember,
			txAllocations,
			monthlyFee: settings?.monthlyFee ?? 5000,
			courtFee: settings?.courtFeeDefault ?? 6000,
			loadedYm: ym,
			monthLoading: false,
		});
	},

	/**
	 * 뮤테이션 후 가변 슬라이스만 갱신(§11). 정적(회원·세션·카테고리·설정)은 재조회 안 함 → triage 중 왕복 절반.
	 * 로딩 플래그를 켜지 않아 목록이 깜빡이지 않음. 카테고리 추가/삭제는 loadMonth(force)로.
	 * charge를 바꾸는 뮤테이션(입금확인·대사취소)용. tx만 바꾸는 건 refreshTxns.
	 */
	async refreshMonth(ym: string) {
		const [monthly, court, bankTxns, unpaidByMember, upcomingSessions] = await Promise.all([
			fetchMonthlyCharges(ym),
			fetchCourtCharges(ym),
			fetchBankTransactions(ym),
			fetchUnpaidByMember(),
			fetchUpcomingParticipating(), // 선납 확정으로 chargedMemberIds 가 바뀌므로 함께 갱신(완납 세션 재노출 방지)
		]);
		const [sessionTxns, txAllocations] = await Promise.all([
			fetchSessionTxns(useDuesStore.getState().monthSessions.map((x) => x.id)),
			fetchTxAllocations(bankTxns.map((t) => t.id)),
		]);
		useDuesStore.setState({ monthly, court, bankTxns, unpaidByMember, upcomingSessions, sessionTxns, txAllocations });
	},

	/**
	 * 거래만 바뀌는 뮤테이션(분류·세션지정·무시·환불연결·외부대관) 후 갱신 — 3쿼리.
	 * dues_charges 미변경이라 monthly/court/unpaid는 재조회 안 함(refreshMonth의 절반).
	 */
	async refreshTxns(ym: string) {
		const [bankTxns, sessionTxns] = await Promise.all([
			fetchBankTransactions(ym),
			fetchSessionTxns(useDuesStore.getState().monthSessions.map((x) => x.id)),
		]);
		const txAllocations = await fetchTxAllocations(bankTxns.map((t) => t.id));
		useDuesStore.setState({ bankTxns, sessionTxns, txAllocations });
	},

	/** 내 회비 탭: 본인 부과(대납 포함) + 클럽 계좌 + 실제 납부 이력. (클럽 회계는 loadMyLedger로 분리) */
	async loadMine(memberId: string) {
		useDuesStore.setState({ myLoading: true });
		const [myCharges, account, myPayments] = await Promise.all([
			fetchMyCharges(memberId),
			fetchClubAccount(),
			fetchMyPayments(),
		]);
		useDuesStore.setState({ myCharges, account, myPayments, myLoading: false });
	},

	/** 클럽 회계 탭: 선택 월의 공개 회계(당월 제외는 화면에서 가드). 같은 ym 캐시 + 경합 가드(마지막 요청만 반영). */
	async loadMyLedger(ym: string, force = false) {
		const s = useDuesStore.getState();
		if (!force && s.myLedgerYm === ym && !s.myLedgerLoading) return;
		const req = ++ledgerReq;
		useDuesStore.setState({ myLedgerLoading: true });
		const myLedger = await fetchPublicLedger(ym); // 오류 시 null
		if (req !== ledgerReq) return; // 더 최신 월 요청이 진행 중 → 이 결과는 버림(out-of-order 방지)
		useDuesStore.setState({ myLedger, myLedgerYm: ym, myLedgerLoading: false });
	},
};
