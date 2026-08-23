import { create } from "zustand";
import {
	type AdminMemberRow,
	fetchMembersForAdmin,
} from "../lib/supabase/adminMembers";
import {
	type BankTxnRow,
	type BatchRow,
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
	fetchManualBatchRows,
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
	ymRangeKst,
} from "../lib/supabase/dues";
import {
	type PendingDraftGroup,
	fetchPendingDrafts,
} from "../lib/supabase/chargeDrafts";
import {
	type ChargeSourceSession,
	type ManualBatch,
	fetchChargeSourceSessions,
	fetchManualBatches,
} from "../lib/supabase/manualCharges";
import { fetchLastParticipationByMember } from "../lib/supabase/members";
import { isoToDateKST } from "../lib/schedule/calendar";
import { shiftYm } from "../components/admin/dues/duesText";

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
	categories: TxnCategory[]; // 거래 분류 — 레거시(새 태그는 붙이지 않는다, 2026-08-23)
	/** 부과 묶음(영수증) = 회계 항목 축. 정산함 항목 칩·공개회계 항목이 이걸 쓴다. */
	batches: BatchRow[];
	unpaidByMember: Record<string, UnpaidCharge[]>; // 전체 미납(크로스먼스 배분용)
	txAllocations: Record<number, TxAllocation>; // 거래별 처리내역(라벨·세션)
	monthlyFee: number;
	courtFee: number;
	/** 발행 대기 부과 초안(운영진). 월과 무관 — 대기는 밀리면 안 되는 일이라 항상 전부 싣는다. */
	pendingDrafts: PendingDraftGroup[];

	// ── 내 회비(회원 본인) ──────────────────────────────────────────
	myLoading: boolean;
	myCharges: MyChargeRow[];
	myPayments: MyPayment[]; // 실제 납부 이력(부과 배분 + paid_by 카테고리)
	account: ClubAccount | null;
	myLedger: PublicLedger | null; // 클럽 공개 회계(항목별만) — 선택 월
	myLedgerYm: string | null; // myLedger가 담고 있는 월
	myLedgerLoading: boolean;

	// ── 수동 부과 탭(지연 로드) ─────────────────────────────────────
	// 정모·정산함·회계는 이 데이터를 쓰지 않는다 → loadMonth 를 무겁게 하지 않고 탭 진입 때만 조회한다.
	manualLoadedYm: string | null;
	manualLoading: boolean;
	/** 최근 6개월 배치(그 달 목록 + 필터의 '지난 명단' 재료를 한 쿼리로). */
	manualBatches: ManualBatch[];
	/** 그 달 열린 회차 + 참석행(식사 체크 포함) — 대상 후보의 재료. */
	chargeSessions: ChargeSourceSession[];
	/** 회원별 마지막 참석일(KST 'YYYY-MM-DD'). null=아직 안 불러옴. */
	lastAttendedOn: Map<string, string> | null;

	// ── 미납 진입 알림(UnpaidDuesAlert) ─────────────────────────────
	// 앱 진입 시 1회 조회하는 독립 스냅샷. /my-dues 의 myCharges/account 와 분리해
	// 두 화면의 로드 라이프사이클이 서로를 덮지 않게 한다.
	unpaidAlertCheckedFor: string | null; // 조회를 마친 memberId(중복 조회 가드)
	unpaidAlertCharges: MyChargeRow[]; // 본인 부과 전체(미납 판정은 화면에서 selectUnpaid)
	unpaidAlertAccount: ClubAccount | null;
	unpaidAlertDismissed: boolean; // 이번 앱 실행에서 닫음(영속 X → 다음에 앱을 열면 다시 뜬다)
}

export const useDuesStore = create<DuesState>(() => ({
	loadedYm: null,
	monthLoading: true,
	members: [],
	monthly: [],
	court: [],
	bankTxns: [],
	monthSessions: [],
	batches: [],
	pendingDrafts: [],
	manualLoadedYm: null,
	manualLoading: false,
	manualBatches: [],
	chargeSessions: [],
	lastAttendedOn: null,
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
	unpaidAlertCheckedFor: null,
	unpaidAlertCharges: [],
	unpaidAlertAccount: null,
	unpaidAlertDismissed: false,
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
		const [members, monthly, court, bankTxns, ledgerSessions, categories, settings, unpaidByMember, upcomingSessions, pendingDrafts, batches, manualBatches] = await Promise.all([
			fetchMembersForAdmin(true), // 게스트 포함 — 대관비 입금 매칭용
			fetchMonthlyCharges(ym),
			fetchCourtCharges(ym),
			fetchBankTransactions(ym),
			fetchLedgerSessions(ym),
			fetchCategories(),
			fetchDuesSettings(),
			fetchUnpaidByMember(),
			fetchUpcomingParticipating(), // now 기준 참가 예정 세션(ym 무관)
			fetchPendingDrafts(), // 발행 대기 초안(ym 무관 — 밀린 대기를 어느 달에서든 본다)
			fetchManualBatchRows(), // 항목 칩용 묶음(최근순)
			// 수동 부과 배치 — [부과] 탭뿐 아니라 **현황탭 요약**도 쓰므로 월 공통 로드에 둔다.
			fetchManualBatches(`${shiftYm(ym, -5)}-01`, `${shiftYm(ym, 1)}-01`),
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
			pendingDrafts,
			batches,
			manualBatches,
			loadedYm: ym,
			monthLoading: false,
		});
	},

	/**
	 * 월 캐시 무효화 — 다른 화면(일정 관리의 총액 재발행 등)이 부과를 흔들었을 때 부른다.
	 * `loadedYm` 만 지우면 다음 진입에서 loadMonth 가 실제로 다시 읽는다(즉시 조회는 하지 않아
	 * 지금 보고 있는 화면이 깜빡이지 않는다).
	 */
	invalidateMonth() {
		useDuesStore.setState({ loadedYm: null, manualLoadedYm: null });
	},

	/**
	 * 수동 부과 탭 데이터(지연). 배치는 6개월 창으로 한 번에 받아 그 달 목록과 '지난 명단' 필터가
	 * 같은 배열을 쓴다. 회원 명단은 loadMonth 가 이미 채워두므로 여기서 다시 받지 않는다.
	 */
	async loadManual(ym: string, force = false) {
		const s = useDuesStore.getState();
		if (!force && s.manualLoadedYm === ym && !s.manualLoading) return; // 캐시 히트
		useDuesStore.setState({ manualLoading: true });
		const { start, end } = ymRangeKst(ym);
		// manualBatches 는 loadMonth 가 이미 채웠다(현황탭과 공유) → 여기선 피커 전용 데이터만.
		const [sessions, lastIso] = await Promise.all([
			fetchChargeSourceSessions(start, end),
			fetchLastParticipationByMember(100),
		]);
		// 필터는 KST 날짜 문자열끼리 비교하므로(시간대 함정 회피) 여기서 한 번 변환해 둔다.
		const lastAttendedOn = new Map<string, string>();
		for (const [id, iso] of lastIso) lastAttendedOn.set(id, isoToDateKST(iso));
		useDuesStore.setState({
			chargeSessions: sessions,
			lastAttendedOn,
			manualLoadedYm: ym,
			manualLoading: false,
		});
	},

	/** 배치 생성·삭제 후 목록만 갱신(로딩 플래그 없이 — 목록이 깜빡이지 않게). */
	async refreshManual(ym: string) {
		const batches = await fetchManualBatches(`${shiftYm(ym, -5)}-01`, `${shiftYm(ym, 1)}-01`);
		useDuesStore.setState({ manualBatches: batches });
	},

	/**
	 * 뮤테이션 후 가변 슬라이스만 갱신(§11). 정적(회원·세션·카테고리·설정)은 재조회 안 함 → triage 중 왕복 절반.
	 * 로딩 플래그를 켜지 않아 목록이 깜빡이지 않음. 카테고리 추가/삭제는 loadMonth(force)로.
	 * charge를 바꾸는 뮤테이션(입금확인·대사취소)용. tx만 바꾸는 건 refreshTxns.
	 */
	async refreshMonth(ym: string) {
		const [monthly, court, bankTxns, unpaidByMember, upcomingSessions, pendingDrafts] = await Promise.all([
			fetchMonthlyCharges(ym),
			fetchCourtCharges(ym),
			fetchBankTransactions(ym),
			fetchUnpaidByMember(),
			fetchUpcomingParticipating(), // 선납 확정으로 chargedMemberIds 가 바뀌므로 함께 갱신(완납 세션 재노출 방지)
			fetchPendingDrafts(), // 발행/폐기 직후 배지가 바로 사라지게
		]);
		const [sessionTxns, txAllocations] = await Promise.all([
			fetchSessionTxns(useDuesStore.getState().monthSessions.map((x) => x.id)),
			fetchTxAllocations(bankTxns.map((t) => t.id)),
		]);
		useDuesStore.setState({ monthly, court, bankTxns, unpaidByMember, upcomingSessions, sessionTxns, txAllocations, pendingDrafts });
	},

	/**
	 * 거래만 바뀌는 뮤테이션(분류·세션지정·무시·환불연결·외부대관) 후 갱신 — 3쿼리.
	 * dues_charges 미변경이라 monthly/court/unpaid는 재조회 안 함(refreshMonth의 절반).
	 */
	async refreshTxns(ym: string) {
		const [bankTxns, sessionTxns, batches] = await Promise.all([
			fetchBankTransactions(ym),
			fetchSessionTxns(useDuesStore.getState().monthSessions.map((x) => x.id)),
			fetchManualBatchRows(), // 정산함에서 만든 새 묶음이 즉시 칩으로 뜨게
		]);
		const txAllocations = await fetchTxAllocations(bankTxns.map((t) => t.id));
		useDuesStore.setState({ bankTxns, sessionTxns, txAllocations, batches });
	},

	/** 회원 슬라이스만 재조회(명예회원 지정/해제 등 members 필드 변경 후). 로딩 플래그 안 켬(깜빡임 없음). */
	async refreshMembers() {
		const members = await fetchMembersForAdmin(true);
		useDuesStore.setState({ members });
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

	/**
	 * 미납 진입 알림용 조회 — 앱을 열 때(회원 확정 시) 1회. 같은 memberId 로는 다시 조회하지 않는다.
	 * 판정(미납 여부)은 화면(UnpaidDuesAlert)이 하고, 여기선 데이터만 채운다.
	 * 계좌는 단일행 RPC라 미납 유무와 무관하게 같이 받는다(왕복 1회 절약).
	 */
	async checkUnpaidAlert(memberId: string) {
		if (useDuesStore.getState().unpaidAlertCheckedFor === memberId) return;
		// 조회 시작 시점에 마킹 — 같은 실행에서 effect 가 두 번 뛰어도 중복 요청이 안 나가게.
		useDuesStore.setState({ unpaidAlertCheckedFor: memberId });
		const [charges, account] = await Promise.all([
			fetchMyCharges(memberId),
			fetchClubAccount(),
		]);
		useDuesStore.setState({
			unpaidAlertCharges: charges,
			unpaidAlertAccount: account,
		});
	},

	/** 미납 알림 닫기 — 이번 앱 실행에만 유효(localStorage 미사용). 다음에 앱을 열면 미납이 남아있는 한 다시 뜬다. */
	dismissUnpaidAlert() {
		useDuesStore.setState({ unpaidAlertDismissed: true });
	},

	/** 로그아웃/계정 전환 — 알림 스냅샷 폐기(다른 회원의 미납이 남아 보이지 않게). */
	resetUnpaidAlert() {
		useDuesStore.setState({
			unpaidAlertCheckedFor: null,
			unpaidAlertCharges: [],
			unpaidAlertAccount: null,
			unpaidAlertDismissed: false,
		});
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
