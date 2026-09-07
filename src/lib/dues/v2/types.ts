export interface AccountingMode {
	available: boolean;
	enabled: boolean;
	paused: boolean;
	revision: number;
	epoch: string;
}
export interface BillingGroup {
	id: string;
	source_key: string;
	kind: "monthly" | "court" | "manual";
	label: string;
	occurred_on: string;
	session_id: number | null;
	basis: Record<string, unknown>;
}
export interface Charge {
	id: string;
	legacy_id: number | null;
	group_id: string;
	member_id: string;
	amount: number;
	state: "live" | "cancelled" | "waived";
	previous_id: string | null;
	payer_hint: string | null;
	issued_at: string;
}
export interface DueSlice {
	id: string;
	charge_id: string;
	due_ym: string;
	remaining: number;
}
export type FundPurpose =
	| "unassigned"
	| "member_pending"
	| "carry"
	| "refund_pending"
	| "club";
export interface FundPosition {
	id: string;
	bank_tx_id: number;
	owner_id: string | null;
	amount: number;
	purpose: FundPurpose;
	available_ym: string | null;
	group_id: string | null;
}
export interface Allocation {
	id: string;
	bank_tx_id: number;
	owner_id: string;
	charge_id: string;
	due_id: string;
	amount: number;
	reversed: number;
	created_at: string;
}
export interface Refund {
	out_tx_id: number;
	in_tx_id: number;
	owner_id: string | null;
	amount: number;
}
export interface BankTransaction {
	id: number;
	amount: number;
	direction: "in" | "out";
	occurred_at: string;
	name: string | null;
}
export interface AccountingMember {
	id: string;
	name: string;
	guest: boolean;
	active: boolean;
	gender: string | null;
	birth_year: number | null;
}
export interface Operation {
	id: number;
	action: string;
	reason: string;
	created_at: string;
	reverted_at: string | null;
	result: OperationResult;
}
export interface AccountingData {
	mode: AccountingMode;
	groups: BillingGroup[];
	charges: Charge[];
	due: DueSlice[];
	positions: FundPosition[];
	allocations: Allocation[];
	refunds: Refund[];
	expenses: { bank_tx_id: number; group_id: string | null }[];
	bank: BankTransaction[];
	members: AccountingMember[];
	operations: Operation[];
	active_operations: number;
	drafts: {
		source_key: string;
		payload: AccountingCommand;
		hold_reason: string;
	}[];
}
export interface CashLedger {
	ym: string;
	income: number;
	expense: number;
	lines: {
		group_id: string | null;
		label: string;
		income: number;
		expense: number;
	}[];
}
export type Action =
	| "issue"
	| "replace"
	| "carry"
	| "position"
	| "pay"
	| "reverse_payment"
	| "refund"
	| "reverse_refund"
	| "expense"
	| "waive"
	| "apply";
export interface AccountingCommand {
	action: Action;
	reason: string;
	[key: string]: unknown;
}
export interface OperationResult {
	operation_id: number;
	revision: number;
	auto_applied: number;
	reused?: number;
	paid?: number;
	refunded?: number;
	outstanding_before: number;
	outstanding_after: number;
	member_balance_before: number;
	member_balance_after: number;
}
export type ManagementAction =
	| "activate"
	| "pause"
	| "resume"
	| "undo"
	| "rollback";

export const purposeLabel: Record<FundPurpose, string> = {
	unassigned: "미귀속",
	member_pending: "회원 잔액",
	carry: "이월 입금",
	refund_pending: "환불 대기",
	club: "클럽 직접 수입",
};
export const actionLabel: Record<string, string> = {
	issue: "부과 발행",
	replace: "부과 취소·발행",
	carry: "이월",
	position: "입금 용도 지정",
	pay: "납부 확인",
	reverse_payment: "납부 연결 해제",
	refund: "환불 연결",
	reverse_refund: "환불 연결 해제",
	expense: "지출 귀속",
	waive: "미납 면제",
	apply: "이월금 적용",
	activate: "새 부과 시작",
	pause: "처리 일시 중지",
	resume: "처리 재개",
	undo: "직전 처리 되돌리기",
	rollback: "기존 부과로 복귀",
};
