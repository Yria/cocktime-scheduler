/**
 * Claude Design 프리뷰 런타임. 카드가 **실제 컴포넌트**를 실제처럼 렌더하도록 두 가지를
 * 제공한다 — 앱 소스는 건드리지 않는다(이 파일은 앱 런타임에 포함되지 않는다).
 *
 * 1. `duesFixture` — 회비 화면이 받는 `AccountingData` 표본. e2e 픽스처와 같은 모양이며
 *    금액·이름·날짜가 실제 정모 운영을 닮게 골랐다(`foo`/`test` 없음).
 * 2. `DuesPreview` — provider. 라우터(정산함 경로)와 Supabase RPC 스텁을 깐다. 스텁이
 *    없으면 인라인 정산의 프리뷰 요청이 네트워크에서 실패해 확정 버튼이 영구 비활성으로
 *    보이고, 장부 카드는 오류 상태만 남는다.
 */
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AccountingData } from "../src/lib/dues/v2/types";
import { useAuthStore } from "../src/store/authStore";
import { useAccountingStore } from "../src/store/accountingV2Store";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";
const D = "00000000-0000-4000-8000-000000000004";

const GROUP_FEE = "10000000-0000-4000-8000-000000000001";
const GROUP_COURT = "10000000-0000-4000-8000-000000000002";
const GROUP_MEAL = "10000000-0000-4000-8000-000000000003";

const CH = (n: number) => `20000000-0000-4000-8000-00000000000${n}`;
const DU = (n: number) => `30000000-0000-4000-8000-00000000000${n}`;
const PO = (n: number) => `40000000-0000-4000-8000-00000000000${n}`;
const AL = (n: number) => `50000000-0000-4000-8000-00000000000${n}`;

/** 회비 화면 프리뷰의 표본 데이터. */
export const duesFixture: AccountingData = {
	mode: {
		available: true,
		enabled: true,
		paused: false,
		revision: 42,
		epoch: "2026-09-01T00:00:00+09:00",
	},
	groups: [
		{
			id: GROUP_FEE,
			source_key: "monthly:2026-09",
			kind: "monthly",
			label: "2026-09 회비",
			occurred_on: "2026-09-01",
			session_id: null,
			basis: {},
		},
		{
			id: GROUP_COURT,
			source_key: "court:12",
			kind: "court",
			label: "2026-09-06 · 에이트민턴 · 19:00–22:00",
			occurred_on: "2026-09-06",
			session_id: 12,
			basis: {},
		},
		{
			id: GROUP_MEAL,
			source_key: "manual:meal-0906",
			kind: "manual",
			label: "9/6 회식",
			occurred_on: "2026-09-06",
			session_id: null,
			basis: {},
		},
	],
	charges: [
		{
			id: CH(1),
			legacy_id: null,
			group_id: GROUP_COURT,
			member_id: A,
			amount: 6500,
			state: "live",
			previous_id: null,
			payer_hint: null,
			issued_at: "2026-09-06T22:10:00+09:00",
		},
		{
			id: CH(2),
			legacy_id: null,
			group_id: GROUP_FEE,
			member_id: B,
			amount: 12000,
			state: "live",
			previous_id: null,
			payer_hint: null,
			issued_at: "2026-09-01T09:00:00+09:00",
		},
		{
			id: CH(3),
			legacy_id: null,
			group_id: GROUP_FEE,
			member_id: C,
			amount: 12000,
			state: "live",
			previous_id: null,
			payer_hint: null,
			issued_at: "2026-09-01T09:00:00+09:00",
		},
		{
			id: CH(4),
			legacy_id: null,
			group_id: GROUP_MEAL,
			member_id: D,
			amount: 24000,
			state: "live",
			previous_id: null,
			payer_hint: null,
			issued_at: "2026-09-06T23:40:00+09:00",
		},
		{
			id: CH(5),
			legacy_id: null,
			group_id: GROUP_FEE,
			member_id: A,
			amount: 12000,
			state: "live",
			previous_id: null,
			payer_hint: null,
			issued_at: "2026-09-01T09:00:00+09:00",
		},
	],
	due: [
		{ id: DU(1), charge_id: CH(1), due_ym: "2026-09", remaining: 6500 },
		{ id: DU(2), charge_id: CH(2), due_ym: "2026-09", remaining: 12000 },
		{ id: DU(3), charge_id: CH(3), due_ym: "2026-09", remaining: 5000 },
		{ id: DU(4), charge_id: CH(4), due_ym: "2026-10", remaining: 24000 },
		{ id: DU(5), charge_id: CH(5), due_ym: "2026-09", remaining: 0 },
	],
	positions: [
		{
			id: PO(1),
			bank_tx_id: 90,
			owner_id: null,
			amount: 6500,
			purpose: "unassigned",
			available_ym: null,
			group_id: null,
		},
		{
			id: PO(2),
			bank_tx_id: 91,
			owner_id: B,
			amount: 15000,
			purpose: "member_pending",
			available_ym: null,
			group_id: null,
		},
		{
			id: PO(3),
			bank_tx_id: 88,
			owner_id: C,
			amount: 2000,
			purpose: "carry",
			available_ym: "2026-10",
			group_id: null,
		},
	],
	allocations: [
		{
			id: AL(1),
			bank_tx_id: 87,
			owner_id: A,
			charge_id: CH(5),
			due_id: DU(5),
			amount: 12000,
			reversed: 0,
			created_at: "2026-09-03T10:12:00+09:00",
		},
		{
			id: AL(2),
			bank_tx_id: 89,
			owner_id: C,
			charge_id: CH(3),
			due_id: DU(3),
			amount: 7000,
			reversed: 0,
			created_at: "2026-09-05T20:41:00+09:00",
		},
	],
	refunds: [],
	expenses: [{ bank_tx_id: 95, group_id: GROUP_COURT }],
	bank: [
		{
			id: 90,
			amount: 6500,
			direction: "in",
			occurred_at: "2026-09-07T12:04:00+09:00",
			name: "박민준0906",
		},
		{
			id: 91,
			amount: 15000,
			direction: "in",
			occurred_at: "2026-09-06T21:30:00+09:00",
			name: "김지훈9월회비",
		},
		{
			id: 95,
			amount: 234000,
			direction: "out",
			occurred_at: "2026-09-06T22:02:00+09:00",
			name: "에이트민턴 대관료",
		},
		{
			id: 89,
			amount: 7000,
			direction: "in",
			occurred_at: "2026-09-05T20:40:00+09:00",
			name: "이서연",
		},
		{
			id: 87,
			amount: 12000,
			direction: "in",
			occurred_at: "2026-09-03T10:11:00+09:00",
			name: "박민준",
		},
		{
			id: 96,
			amount: 6000,
			direction: "out",
			occurred_at: "2026-09-02T18:20:00+09:00",
			name: "공구 배송비",
		},
		{
			id: 97,
			amount: 6000,
			direction: "out",
			occurred_at: "2026-09-07T19:15:00+09:00",
			name: "김지훈",
		},
	],
	members: [
		{
			id: A,
			name: "박민준",
			guest: false,
			active: true,
			gender: "M",
			birth_year: 1995,
		},
		{
			id: B,
			name: "김지훈",
			guest: false,
			active: true,
			gender: "M",
			birth_year: 1996,
		},
		{
			id: C,
			name: "이서연",
			guest: false,
			active: true,
			gender: "F",
			birth_year: 2002,
		},
		{
			id: D,
			name: "최유진",
			guest: true,
			active: true,
			gender: "F",
			birth_year: null,
		},
	],
	operations: [
		{
			id: 812,
			action: "pay",
			reason: "정산함 · 박민준 · 납부 확인",
			created_at: "2026-09-03T10:12:00+09:00",
			reverted_at: null,
			result: {} as never,
		},
		{
			id: 811,
			action: "issue",
			reason: "9월 6일 대관비 발행",
			created_at: "2026-09-06T22:10:00+09:00",
			reverted_at: null,
			result: {} as never,
		},
	],
	drafts: [
		{
			source_key: "monthly:2026-10",
			payload: {
				action: "issue",
				reason: "",
				kind: "monthly",
				label: "2026-10 회비",
				ym: "2026-10",
				lines: [],
			} as never,
			hold_reason: "head_count_jump",
		},
	],
};

/** RPC 이름별 스텁 응답. 프리뷰가 네트워크 오류 화면으로 굳는 것을 막는다. */
const RPC_STUB: Record<string, unknown> = {
	dues_v2_mode: duesFixture.mode,
	dues_v2_read: duesFixture,
	dues_v2_preview: {
		outstanding_before: 84000,
		outstanding_after: 77500,
		member_balance_before: 42000,
		member_balance_after: 42000,
		auto_applied: 0,
		reused: null,
	},
	dues_v2_command: { ok: true },
	dues_v2_ledger: {
		ym: "2026-09",
		income: 40500,
		expense: 240000,
		lines: [
			{ group_id: "10000000-0000-4000-8000-000000000001", label: "2026-09 회비", income: 19000, expense: 0 },
			{ group_id: "10000000-0000-4000-8000-000000000002", label: "2026-09-06 · 에이트민턴", income: 21500, expense: 234000 },
			{ group_id: null, label: "미분류", income: 0, expense: 6000 },
		],
	},
	dues_v2_participation: {},
	dues_v2_sessions: [],
	bank_transactions: [],
};

/**
 * 화면 단위 컴포넌트(AccountingAdmin·AccountingMember)는 스토어에서 로그인 회원과
 * 회계 모드를 읽는다. 프리뷰에는 세션이 없으니 표본으로 채워 준다 — 그러지 않으면
 * 카드가 '불러오는 중…' 한 줄로 굳는다.
 */
function seedStores() {
	useAuthStore.setState({
		ready: true,
		memberLoaded: true,
		memberId: A,
		isAdmin: true,
	});
	useAccountingStore.setState({
		mode: duesFixture.mode,
		modeError: null,
		data: duesFixture,
		owner: A,
		loading: false,
		error: null,
	});
}

let installed = false;
function installRpcStub() {
	if (installed || typeof window === "undefined") return;
	installed = true;
	const real = window.fetch?.bind(window);
	window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(typeof input === "string" ? input : (input as Request).url ?? input);
		const rpc = /\/rest\/v1\/rpc\/([a-z0-9_]+)/i.exec(url);
		const table = /\/rest\/v1\/([a-z0-9_]+)/i.exec(url);
		const key = rpc?.[1] ?? table?.[1];
		if (key && key in RPC_STUB) {
			return new Response(JSON.stringify(RPC_STUB[key]), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (/supabase|\/rest\/v1|\/auth\/v1/i.test(url)) {
			return new Response("[]", {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		return real ? real(input, init) : new Response("", { status: 204 });
	}) as typeof window.fetch;
}

/**
 * 프리뷰 provider. 라우터와 RPC 스텁을 깔고 회비 화면의 스타일 스코프(`accounting-screen`)를
 * 씌운다 — 토큰이 그 스코프에 선언되어 있어 없으면 카드가 전역 기본 스타일로 렌더된다.
 */
export function DuesPreview({ children }: { children?: ReactNode }) {
	installRpcStub();
	seedStores();
	// 라우트를 실제로 물려야 useParams 가 채워진다. 없으면 화면 단위 컴포넌트가
	// currentYm() 으로 떨어져 픽스처가 없는 달을 열고 0원짜리 빈 화면이 된다.
	const body = (
		<div className="accounting-screen" style={{ padding: 16 }}>
			{children}
		</div>
	);
	return (
		<MemoryRouter initialEntries={["/dues/2026-09/inbox"]}>
			<Routes>
				<Route path="/dues/:ym/:page" element={body} />
				<Route path="*" element={body} />
			</Routes>
		</MemoryRouter>
	);
}
