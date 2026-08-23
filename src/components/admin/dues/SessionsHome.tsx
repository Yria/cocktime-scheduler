import { type CSSProperties, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type SessionFeeRow, duesDeferCharge, duesSetChargeStatus, duesSettleDeferred, duesUndeferCharge } from "../../../lib/supabase/dues";
import { duesActions, useDuesStore } from "../../../store/duesStore";
import { toast } from "../../../store/toastStore";
import ConfirmDialog from "../../common/ConfirmDialog";
import EmptyState from "../../shared/EmptyState";
import BirthYearTag from "../../shared/BirthYearTag";
import ManualBatchCard from "./ManualBatchCard";
import { Meter, MoreLink } from "./duesCardBits";
import { CARD_CLASS, cardBox, mark, pill } from "./duesCardStyles";
import { remaining, sessionLabel, won, ymLabel } from "./duesText";
import { buildManualCards } from "./manualCards";
import PendingDraftsSheet from "./PendingDraftsSheet";
import SessionSettleSheet from "./SessionSettleSheet";
import { type SessionSettle, buildSessionSettle } from "./sessionSettle";

/** 회비 미납 1행 — 열람 + [이월]. (대관비 미납은 세션별 [정산 대조] 시트가 담당) */
interface FeeUnpaidRow {
	chargeId: number;
	name: string;
	/** 이름 뒤 년생 표기용(동명이인 구분). */
	birthYear: number | null;
	remain: number;
}
interface SessionCard {
	id: number;
	label: string;
	scheduledAt: string | null;
	courtLinked: boolean; // 코트대관 지출이 세션에 연결됨
	expense: number;
	paidCount: number;
	totalCount: number;
	outstanding: number; // 미납(일반) + 사유없는 당일취소
	status: "settled" | "open" | "none"; // 마감 / 정산 미완 / 대상 없음
	session: SessionFeeRow; // 정산 대조 시트 입력(참석행·엔빵 총액)
	settle: SessionSettle; // 정산 대조 — 카드는 요약·⚠배지, 명단·조작은 시트에서
}

// 정모(메인): 각 세션이 정산 단위로 잘 됐는지(①코트지출 연결 ②수납 완료 → 마감/미완) + 회비 진행 + 정산함 진입.
// 월 순액 헤드라인 없음(그건 회계).
//
// 미납 푸시 발송은 폐기했다(2026-08): 미납자가 앱을 열면 UnpaidDuesAlert(§3.5)가 낼 금액·계좌를
// 먼저 보여주므로 운영진이 골라 보내는 경로가 중복이었다. 그래서 세션 카드의 '대관비 수납' 펼침
// (취사선택 + 발송 + 당일취소 부과삭제)도 없애고, 그 자리를 [정산 대조] 시트 진입 버튼 하나로 바꿨다.
// 명단 열람과 당일취소 부과삭제/되돌리기는 그 시트가 이어받는다.
export default function SessionsHome({ ym }: { ym: string }) {
	const navigate = useNavigate();
	const loading = useDuesStore((s) => s.monthLoading);
	const members = useDuesStore((s) => s.members);
	const monthly = useDuesStore((s) => s.monthly);
	const court = useDuesStore((s) => s.court);
	const monthSessions = useDuesStore((s) => s.monthSessions);
	const upcomingSessions = useDuesStore((s) => s.upcomingSessions); // 예정(open) 세션 — 선납만 존재하는 미개장 세션 카드용
	const sessionTxns = useDuesStore((s) => s.sessionTxns);
	const bankTxns = useDuesStore((s) => s.bankTxns);
	const courtFeeDefault = useDuesStore((s) => s.courtFee); // 정액 기본액 — 대조의 인당 금액
	// 발행 대기 초안 — 규칙이 이상하다고 판단해 회원에게 보내지 않고 세워둔 부과(§ 부과 재설계).
	const pendingDrafts = useDuesStore((s) => s.pendingDrafts);
	// 수동 부과(회식·공동구매) — 회비·대관비는 이 화면에 있는데 이것만 [부과] 탭에 갇혀 있었다.
	// 그 달 것을 **다른 부과와 같은 카드**로 세운다(ManualBatchCard — [부과] 탭과 같은 컴포넌트).
	// 명단·수정은 [부과] 탭의 시트가 맡는다(그 배치를 열고 들어간다).
	const manualBatches = useDuesStore((s) => s.manualBatches);
	const batchRows = useDuesStore((s) => s.batches); // 묶음 행 — 통장 출금이 붙는 축(수동 부과의 '지출 연결' 판정)

	const [feeOpen, setFeeOpen] = useState(false); // 회비 미납 명단 펼침
	const [voidReq, setVoidReq] = useState<{ chargeId: number; name: string; label: string } | null>(null); // 당일취소 부과삭제 확인
	const [settleId, setSettleId] = useState<number | null>(null); // 정산 대조 시트를 연 세션
	const [draftsOpen, setDraftsOpen] = useState(false); // 발행 대기 초안 검토 시트
	const [busy, setBusy] = useState(false);

	const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

	// 수동 부과 카드 — 계산은 [부과] 탭과 공유(manualCards.buildManualCards).
	const manualCards = useMemo(
		() => buildManualCards(manualBatches, batchRows, bankTxns, ym),
		[manualBatches, batchRows, bankTxns, ym],
	);

	// 회비 진행 — 원 월(period_ym=ym) 기준. 이월된(deferred_to set) 건은 '낸 것처럼' 해결로 카운트.
	// 분모·분자 모두 **이번 달 실제 부과 행**에서만 나온다. 회원 명단을 훑고 부과를 찾아 붙이는 게 아니다.
	//   종전에는 활성·비운영진·비게스트·비명예 회원만 훑었고, 그래서 회원을 비활성화하는 순간
	//   그 사람의 그 달 회비가 납부분까지 통째로 화면에서 사라졌다(부과 행은 DB에 그대로인데 미납이
	//   집계에서 빠져 "다 걷힌" 것처럼 보였다). 중도 탈퇴자도 그 달 회비는 내야 하므로 명단이 아니라
	//   부과가 기준이어야 맞다.
	//   부과 자격 판정은 이미 서버(dues_generate_monthly: 활성·비게스트·비명예·비운영진)가 했으므로
	//   여기서 다시 거를 이유도 없다. 부과가 없는 신규 유예 회원과 waived·void 건이 분모에서 빠지는
	//   성질은 그대로다 — 애초에 부과 행이 없거나 아래 분기에서 어느 쪽에도 담기지 않는다.
	const fee = useMemo(() => {
		let paid = 0;
		const unpaid: FeeUnpaidRow[] = [];
		for (const c of monthly) {
			if (c.periodYm !== ym) continue;
			const m = memberById.get(c.memberId);
			if (c.deferredTo != null) paid++; // 이월 = 해결로 취급
			else if (c.status === "paid" || c.status === "overpaid") paid++;
			else if (c.status === "unpaid" || c.status === "partial") unpaid.push({ chargeId: c.id, name: m?.name ?? "회원", birthYear: m?.birthYear ?? null, remain: remaining(c.amountDue, c.amountPaid) });
			// waived·void 는 paid·unpaid 어디에도 넣지 않음 → 아래 total(분모)에서도 자연히 제외됨.
			//   정지로 인한 미부과는 부과 행 자체가 지워지므로(trg_members_uncharge_dues_on_deactivate)
			//   여기 걸릴 waived 는 이월정산·수동 처리분뿐이다 → 별도 목록을 두지 않는다.
		}
		unpaid.sort((a, b) => a.name.localeCompare(b.name));
		// 다른 달에서 이월돼 온 회비(이번 달 미정산 대상).
		// settled(=waived)는 [정산]으로 미납만 해제한 상태(금액 기록 없음)다 — 현금으로 받은 건과
		// 안 걷기로 한 건이 DB에서 같아 라벨로 단정할 수 없다.
		const carried = monthly
			.filter((c) => c.deferredTo === ym)
			.map((c) => ({ chargeId: c.id, name: memberById.get(c.memberId)?.name ?? "회원", birthYear: memberById.get(c.memberId)?.birthYear ?? null, settled: c.status === "waived", fromYm: c.periodYm }))
			.sort((a, b) => a.name.localeCompare(b.name));
		return { paid, total: paid + unpaid.length, unpaid, carried };
	}, [monthly, ym, memberById]);

	// 세션별 정산 상태
	const sessionCards = useMemo<SessionCard[]>(() => {
		const expenseBySession = new Map<number, number>();
		const incomeBySession = new Map<number, number>();
		const txnsBySession = new Map<number, { direction: "in" | "out"; amount: number }[]>();
		for (const t of sessionTxns) {
			if (t.direction === "out") expenseBySession.set(t.sessionId, (expenseBySession.get(t.sessionId) ?? 0) + t.amount);
			else incomeBySession.set(t.sessionId, (incomeBySession.get(t.sessionId) ?? 0) + t.amount);
			const arr = txnsBySession.get(t.sessionId) ?? [];
			arr.push({ direction: t.direction, amount: t.amount });
			txnsBySession.set(t.sessionId, arr);
		}
		const chargesBySession = new Map<number, typeof court>();
		for (const c of court) {
			const arr = chargesBySession.get(c.sessionId) ?? [];
			arr.push(c);
			chargesBySession.set(c.sessionId, arr);
		}
		return monthSessions
			.map((s): SessionCard => {
				const charges = chargesBySession.get(s.id) ?? [];
				// court_fee 부과 = 참석 머릿수 1인 1행(게스트도 개별 행). void·waived·당일취소·운영진(대관비 면제)은 제외.
				const regular = charges.filter(
					(c) => !c.isDayCancel && c.status !== "void" && c.status !== "waived" && !memberById.get(c.memberId)?.isAdmin,
				);
				const unpaidCount = regular.filter((c) => remaining(c.amountDue, c.amountPaid) > 0).length;
				// 당일취소 부과(정액) 중 아직 사유 없이 살아 있는 것 — void(부과삭제)·납부분은 미납이 아니다.
				const activeDayCancel = charges.filter((c) => c.isDayCancel && c.amountPaid === 0 && c.status !== "void").length;
				// 운영진은 회비·대관비를 걷지 않음 → 확정 참석 인원(attendeeIds)만큼 정산 완료로 분자·분모에 포함.
				const adminCount = s.attendeeIds.filter((id) => memberById.get(id)?.isAdmin).length;
				const expense = expenseBySession.get(s.id) ?? 0;
				const income = incomeBySession.get(s.id) ?? 0;
				const courtLinked = expense > 0;
				// N(정산완료)=비운영진 납부 머릿수+운영진. M(전체)=비운영진 부과 머릿수+운영진 참석+사유없는 당일취소. 미납=M−N.
				const paidCount = regular.length - unpaidCount + adminCount;
				const totalCount = regular.length + adminCount + activeDayCancel;
				const hasSomething = charges.length > 0 || expense > 0 || income > 0;
				const outstanding = unpaidCount + activeDayCancel;
				const status: SessionCard["status"] = !hasSomething ? "none" : courtLinked && outstanding === 0 ? "settled" : "open";
				// 정산 대조(부과 대상 재현) — 카드는 요약·⚠배지, 명단·조작은 시트에서.
				const settle = buildSessionSettle(s, charges, memberById, courtFeeDefault, txnsBySession.get(s.id) ?? []);
				return { id: s.id, label: sessionLabel(s), scheduledAt: s.scheduledAt, courtLinked, expense, paidCount, totalCount, outstanding, status, session: s, settle };
			})
			// 실제로 열리지 않은 세션(부과·지출·수입 전무)은 정산 대상이 아니므로 숨김.
			.filter((c) => c.status !== "none")
			.sort((a, b) => (b.scheduledAt ?? "").localeCompare(a.scheduledAt ?? ""));
	}, [monthSessions, court, sessionTxns, memberById, courtFeeDefault]);

	// 예정(선납) 세션: 아직 안 열린(경기기록 없어 monthSessions에 없는) 세션인데 대관비가 선납된 것.
	// 전체 참가자 부과는 세션 종료 시 생성되므로 진행률(N/전체)은 무의미 → '몇 명 선납'으로만 표시.
	const upcomingCards = useMemo(() => {
		const monthIds = new Set(monthSessions.map((s) => s.id));
		const labelById = new Map(upcomingSessions.map((s) => [s.id, s]));
		const bySession = new Map<number, typeof court>();
		for (const c of court) {
			if (monthIds.has(c.sessionId)) continue; // 열린 세션은 아래 정상 카드에서 처리
			const arr = bySession.get(c.sessionId) ?? [];
			arr.push(c);
			bySession.set(c.sessionId, arr);
		}
		return [...bySession.entries()]
			.map(([sid, charges]) => {
				const s = labelById.get(sid);
				const payers = new Set(charges.map((c) => c.payerHint ?? c.memberId)); // 대납자 기준 인원
				const paid = charges.reduce((sum, c) => sum + c.amountPaid, 0);
				// open 세션에 있으면 진짜 예정. 아니면(취소·무산인데 선납만 남음) 환불 확인 대상 — '예정'으로 오표기 금지.
				return { id: sid, upcoming: !!s, label: s ? sessionLabel(s) : `세션 #${sid}`, scheduledAt: s?.scheduledAt ?? null, payerCount: payers.size, paid };
			})
			.sort((a, b) => (b.scheduledAt ?? "").localeCompare(a.scheduledAt ?? ""));
	}, [court, monthSessions, upcomingSessions]);

	// 열린 대조 시트의 세션(재로드로 카드가 갱신돼도 같은 세션을 계속 가리킨다)
	const settleCard = useMemo(() => sessionCards.find((c) => c.id === settleId) ?? null, [sessionCards, settleId]);

	// 정산함 미처리 입금 수(진입 배지)
	const pendingIn = useMemo(() => bankTxns.filter((t) => t.direction === "in" && t.categoryId == null && (t.status === "unmatched" || t.status === "proposed")).length, [bankTxns]);

	// 회비 이월/정산/취소 · 당일취소 부과삭제/되돌리기 — charge 변경이라 전체 재로드.
	// 대조 시트는 열린 채로 둔다(settleId 유지 → 재계산된 카드를 다시 집어 즉시 갱신).
	const runCharge = async (fn: () => Promise<{ ok: boolean; error?: string }>, errMsg: string) => {
		if (busy) return;
		setBusy(true);
		const res = await fn();
		setBusy(false);
		if (res.ok) await duesActions.loadMonth(ym, true);
		else toast(errMsg, { variant: "error" });
	};

	if (loading) return <EmptyState loading style={{ padding: "2.5rem 0" }} />;

	return (
		<div className="flex flex-col gap-3">
			{/* 발행 대기 — 회원에게 아직 안 보이는 부과. 밀리면 누군가 낼 돈을 모르고 지나가므로 맨 위에. */}
			{pendingDrafts.length > 0 && (
				<button
					type="button"
					onClick={() => setDraftsOpen(true)}
					className="flex items-center gap-2 bg-[rgba(194,103,10,0.1)] border border-[rgba(194,103,10,0.28)]"
					style={{ borderRadius: 11, padding: "11px 13px", cursor: "pointer", width: "100%", textAlign: "left" }}
				>
					<span style={{ fontSize: 15 }}>⚠️</span>
					<span className="text-[#c2670a]" style={{ fontSize: 13.5, fontWeight: 700 }}>
						발행 대기 {pendingDrafts.length}건 · 확인이 필요한 부과
					</span>
					<span style={{ flex: 1 }} />
					<span className="text-faint" style={{ fontSize: 12 }}>›</span>
				</button>
			)}

			{/* 정산함 진입 */}
			<button
				type="button"
				onClick={() => navigate(`/dues/${ym}/inbox`)}
				className="flex items-center gap-2 bg-[rgba(11,132,255,0.08)] border border-[rgba(11,132,255,0.2)]"
				style={{ borderRadius: 11, padding: "11px 13px", cursor: "pointer", width: "100%", textAlign: "left" }}
			>
				<span style={{ fontSize: 15 }}>📥</span>
				<span className="text-[#0b84ff]" style={{ fontSize: 13.5, fontWeight: 700 }}>정산함 · 통장 거래 처리</span>
				<span style={{ flex: 1 }} />
				{pendingIn > 0 ? (
					<span style={{ background: "#ff3b30", color: "#fff", fontSize: 11.5, fontWeight: 800, borderRadius: 999, padding: "1px 8px" }}>미처리 {pendingIn}</span>
				) : (
					<span className="text-faint" style={{ fontSize: 12 }}>›</span>
				)}
			</button>

			{/* 회비 진행 — 미납 명단은 열람 + [이월]만(발송 없음).
			    회원을 비활성화하면 그 달 미납 회비는 **미부과**로 사라진다(부과 행 삭제, 감사 로그만 남음) —
			    운영진이 화면에서 따로 처리할 게 없어 면제 버튼·면제 목록을 두지 않는다. */}
			<FeeGroup
				title={`${ymLabel(ym)} 회비`}
				subtitle={`납부 ${fee.paid}/${fee.total}`}
				meter={fee.total > 0 ? fee.paid / fee.total : 1}
				unpaid={fee.unpaid}
				open={feeOpen}
				onToggle={() => setFeeOpen((v) => !v)}
				busy={busy}
				onDefer={(chargeId) => runCharge(() => duesDeferCharge(chargeId), "이월 실패")}
			/>

			{/* 이월돼 온 회비(다른 달 → 이번 달 미정산) */}
			{fee.carried.length > 0 && (
				<div className={CARD_CLASS} style={cardBox()}>
					<b className="text-strong" style={{ fontSize: 13, display: "block", marginBottom: 6 }}>이월된 회비 <span className="text-faint" style={{ fontSize: 11, fontWeight: 600 }}>· 지난달에서 미룬 것</span></b>
					<div className="flex flex-col gap-1.5">
						{fee.carried.map((c) => (
							<div key={c.chargeId} className="flex items-center gap-2" style={{ fontSize: 13 }}>
								<span className="text-strong" style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{c.name}<BirthYearTag birthYear={c.birthYear} size={11} /><span className="text-faint" style={{ fontSize: 11, fontWeight: 500, marginLeft: 5 }}>{c.fromYm} 회비</span></span>
								{c.settled ? (
									<>
										{/* [정산]은 status='waived' 만 세우고 금액을 기록하지 않는다 — 현금으로 받은 건과 안 걷기로 한 건이
										    DB에서 같다. 초록 '정산됨'(입금 있었던 것처럼)도 '면제'(안 받은 것처럼)도 단정이라, 중립색으로
										    사실만 적는다. */}
										<span className="text-[#64748b]" style={{ fontSize: 12, fontWeight: 700 }}>정산 · 금액 미기록</span>
										<button type="button" onClick={() => runCharge(() => duesUndeferCharge(c.chargeId), "취소 실패")} disabled={busy} className="text-faint" style={{ fontSize: 11.5, background: "none", cursor: "pointer" }}>이월 취소</button>
									</>
								) : (
									<>
										<button type="button" onClick={() => runCharge(() => duesSettleDeferred(c.chargeId), "정산 실패")} disabled={busy} className="rounded-[7px]" style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "#1c8a3b", padding: "3px 10px", border: "none", cursor: "pointer" }}>정산</button>
										<button type="button" onClick={() => runCharge(() => duesUndeferCharge(c.chargeId), "취소 실패")} disabled={busy} className="text-faint" style={{ fontSize: 11.5, background: "none", cursor: "pointer" }}>취소</button>
									</>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{/* 수동 부과 — 회식·공동구매 등. 회비·대관비 카드와 **같은 언어**로 그린다(제목+배지 → 판정
			    두 줄 → 진행 막대). 상세·수정은 [부과] 탭의 시트가 맡는다(그 배치를 열고 들어간다). */}
			{manualCards.map((c) => (
				<ManualBatchCard
					key={c.batch.batchKey}
					card={c}
					actionLabel="명단·수정"
					onAction={() => navigate(`/dues/${ym}/charge?open=${encodeURIComponent(c.batch.batchKey)}`)}
				/>
			))}

			{/* 예정(선납) 세션 — 아직 안 열렸는데 대관비 선납된 것. 진행률 대신 '몇 명 선납'.
			    open이 아니면(취소·무산인데 선납만 묶임) '확인 필요'로 — 환불 대상임을 알림. */}
			{upcomingCards.map((c) => (
				<div key={`up${c.id}`} className={CARD_CLASS} style={cardBox()}>
					<div className="flex items-center gap-2">
						<b className="text-strong" style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>{c.label}</b>
						<span style={pill(c.upcoming ? "info" : "warn")}>{c.upcoming ? "예정" : "확인 필요"}</span>
					</div>
					<div className="flex items-center gap-1.5" style={{ fontSize: 12, marginTop: 8 }}>
						<span className="text-muted">선납 {c.payerCount}명 · {won(c.paid)}</span>
						<span style={{ flex: 1 }} />
						<span className={c.upcoming ? "text-faint" : "text-[#c2670a]"} style={{ fontSize: 11.5 }}>{c.upcoming ? "세션 종료 후 나머지 부과 생성" : "세션 미개장·취소 — 환불 확인"}</span>
					</div>
				</div>
			))}

			{/* 세션별 정산 상태 */}
			{sessionCards.length === 0 && upcomingCards.length === 0 ? (
				<EmptyState style={{ fontSize: 14, padding: "2rem 0" }}>이 달 정산할 대관 세션이 없어요.</EmptyState>
			) : (
				sessionCards.map((c) => {
					const done = c.status === "settled";
					const flagged = c.settle.flaggedCount; // 시트 헤더 ⚠확인과 같은 단일 소스
					return (
						<div key={c.id} className={CARD_CLASS} style={cardBox(done)}>
							<div className="flex items-center gap-2">
								<b className="text-strong" style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>{c.label}</b>
								{/* 참석↔부과 불일치(누락 + 살아 있는 규칙 위반 부과)는 마감 판정(지출연결+미납0)에
								    걸리지 않아 '마감 ✓'인 세션에도 숨는다 → 배지로 따로 세운다.
								    이미 void 처리한 건·참석 기록 없는 건은 세지 않는다(늑대소년 방지). */}
								{flagged > 0 && <span style={pill("bad")}>⚠ 확인 {flagged}</span>}
								<span style={pill(done ? "ok" : "warn")}>{done ? "마감 ✓" : "정산 미완"}</span>
							</div>
							<div className="flex flex-col gap-2" style={{ marginTop: 8 }}>
								{/* 코트지출 연결 */}
								<div className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
									<span style={mark(c.courtLinked)}>{c.courtLinked ? "✓" : "!"}</span>
									<span className={c.courtLinked ? "text-muted" : "text-[#c2670a]"}>코트지출 {c.courtLinked ? `연결 · ${won(c.expense)}` : "미연결 · 정산함에서 출금→세션 지정"}</span>
								</div>
								{/* 대관비 수납 — 요약 + [정산 대조] 시트 진입.
								    옛 펼침(취사선택·발송)은 폐기: 명단 열람·당일취소 부과삭제는 전부 시트가 맡는다. */}
								<div className="flex flex-col gap-1">
									<div className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
										<span style={mark(c.outstanding === 0)}>{c.outstanding === 0 ? "✓" : "!"}</span>
										<span className={c.outstanding === 0 ? "text-muted" : "text-[#c2670a]"}>대관비 수납</span>
										{c.totalCount > 0 && (
											<span className="text-muted" style={{ fontSize: 11.5 }}>{c.paidCount}/{c.totalCount}{c.outstanding > 0 ? ` · 미납 ${c.outstanding}` : ""}</span>
										)}
										<span style={{ flex: 1 }} />
										<MoreLink label="정산 대조" onClick={() => setSettleId(c.id)} />
									</div>
									{c.totalCount > 0 && <Meter ratio={c.paidCount / c.totalCount} done={c.outstanding === 0} />}
								</div>
							</div>
						</div>
					);
				})
			)}

			{draftsOpen && <PendingDraftsSheet ym={ym} onClose={() => setDraftsOpen(false)} />}

			{/* 정산 대조 시트 — 명단 열람 + 당일취소 부과삭제/되돌리기 */}
			{settleCard && (
				<SessionSettleSheet
					session={settleCard.session}
					settle={settleCard.settle}
					settled={settleCard.status === "settled"}
					courtLinked={settleCard.courtLinked}
					busy={busy}
					onVoidRequest={(chargeId, name) => setVoidReq({ chargeId, name, label: settleCard.label })}
					onReset={(chargeId) => runCharge(() => duesSetChargeStatus(chargeId, "reset"), "되돌리기 실패")}
					onClose={() => setSettleId(null)}
				/>
			)}

			{/* 부과삭제 확인 — 대조 시트(zIndex 50/51) 위에 겹쳐 뜬다. */}
			{voidReq && (
				<ConfirmDialog
					title="당일취소 부과 삭제"
					message={`${voidReq.name}님의 '${voidReq.label}' 당일취소 대관비 부과를 삭제할까요? 명단에 취소선으로 남고 누가 삭제했는지 기록돼요(되돌리기 가능).`}
					confirmLabel="부과삭제"
					tone="danger"
					maxWidth="xs"
					zIndex={70}
					onCancel={() => setVoidReq(null)}
					onDismiss={() => setVoidReq(null)}
					onConfirm={() => {
						const r = voidReq;
						setVoidReq(null);
						void runCharge(() => duesSetChargeStatus(r.chargeId, "void"), "부과삭제 실패");
					}}
				/>
			)}
		</div>
	);
}

// 회비 카드: 진행 막대 + (미납 있으면) 미납 명단 펼침. 명단은 열람 + [이월]만 — 푸시 발송은 폐기(§3.5 진입 모달이 대체).
function FeeGroup({ title, subtitle, meter, unpaid, open, onToggle, busy, onDefer }: {
	title: string;
	subtitle: string;
	meter: number;
	unpaid: FeeUnpaidRow[];
	open: boolean;
	onToggle: () => void;
	busy: boolean;
	onDefer: (chargeId: number) => void; // 다음 달로 이월
}) {
	return (
		<div className={CARD_CLASS} style={cardBox()}>
			<div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
				<b className="text-strong" style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>{title}</b>
				<span className="text-muted" style={{ fontSize: 12 }}>{subtitle}</span>
			</div>
			<Meter ratio={meter} done={unpaid.length === 0} />
			{unpaid.length > 0 && (
				<div style={{ marginTop: 8 }}>
					<button
						type="button"
						onClick={onToggle}
						aria-expanded={open}
						className="flex items-center rounded-[8px]"
						style={{ gap: 5, fontSize: 12, fontWeight: 700, color: "#c2670a", padding: "5px 11px", border: "none", background: "rgba(194,103,10,0.14)", cursor: "pointer" }}
					>
						미납 {unpaid.length}명
						<span style={{ opacity: 0.7, fontWeight: 800 }}>{open ? "\u25b2" : "\u25bc"}</span>
					</button>
					{open && (
						<div className="flex flex-col" style={{ gap: 2, marginTop: 8, background: "rgba(120,120,128,0.06)", borderRadius: 10, padding: "9px 10px" }}>
							<p className="text-faint" style={{ fontSize: 11, marginBottom: 2 }}>이월 = 다음 달로 미룸</p>
							{unpaid.map((r) => (
								<div key={r.chargeId} className="flex items-center gap-2" style={{ fontSize: 13, padding: "2px 0" }}>
									<span className="text-strong" style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{r.name}<BirthYearTag birthYear={r.birthYear} size={11} /></span>
									<span className="text-[#d1362c]" style={{ fontWeight: 700, flexShrink: 0 }}>{won(r.remain)}</span>
									<button type="button" onClick={() => onDefer(r.chargeId)} disabled={busy} className="text-[#0b84ff]" style={feeActionBtn("rgba(11,132,255,0.1)")}>이월</button>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

/** 명단 행 끝 조작 버튼(이월) 공용 스타일. SessionSettleSheet 의 actionBtn 과 같은 값 —
    두 화면의 행 조작 버튼이 같아 보여야 하는데, 공용 모듈로 뽑을 만큼 커지진 않아 값만 맞춰 둔다. */
const feeActionBtn = (bg: string): CSSProperties => ({
	fontSize: 11.5,
	fontWeight: 700,
	background: bg,
	border: "none",
	borderRadius: 7,
	padding: "3px 8px",
	cursor: "pointer",
	flexShrink: 0,
});
