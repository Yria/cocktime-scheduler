import { useEffect, useState } from "react";
import { duesActions, useDuesStore } from "../../store/duesStore";
import EmptyState from "../shared/EmptyState";
import { SERVICE_START_YM, moneyClass, publicLedgerMaxYm, shiftYm, signed, won, ymLabel } from "../admin/dues/duesText";
import { LedgerRow, NetAmount } from "../admin/dues/duesUi";

// 클럽 회계 탭: 월 스테퍼(서비스 시작 월 ~ 지난달) + 항목별 공개 회계(현금주의, 합=남은 돈).
// 운영진 [회계]의 '항목별 정산'과 같은 데이터·같은 행 컴포넌트 — 항목마다 들어온/나간 돈까지 보여준다.
export default function MyLedgerTab() {
	const maxYm = publicLedgerMaxYm(); // 열람 가능한 최신 = 지난달(당월은 정산 중이라 비공개)
	const [ym, setYm] = useState(maxYm);
	const loading = useDuesStore((s) => s.myLedgerLoading);
	const shownYm = useDuesStore((s) => s.myLedgerYm);
	const ledger = useDuesStore((s) => s.myLedger);

	useEffect(() => {
		void duesActions.loadMyLedger(ym);
	}, [ym]);

	const canBack = ym > SERVICE_START_YM; // 서비스 시작(2026년 7월) 이전은 데이터가 없어 안 내려감
	const canForward = ym < maxYm; // 당월/미래로는 못 감
	const loaded = !loading && shownYm === ym; // 이 달 로드 완료(성공/오류 무관)
	const empty = loaded && ledger != null && !(ledger.income > 0 || ledger.expense > 0 || ledger.feeCollected > 0 || ledger.sessions.length > 0 || ledger.categories.length > 0 || ledger.refund > 0 || ledger.uncatIn !== 0 || ledger.uncatOut > 0);

	return (
		<div className="flex flex-col gap-3">
			{/* 월 스테퍼 */}
			<div className="flex items-center justify-center gap-4">
				<button
					type="button"
					onClick={() => canBack && setYm((v) => shiftYm(v, -1))}
					disabled={!canBack}
					className={canBack ? "text-[#0b84ff]" : "text-[rgba(120,120,128,0.4)]"}
					style={{ background: "none", border: "none", cursor: canBack ? "pointer" : "default", fontSize: 22, lineHeight: 1, padding: 4 }}
					aria-label="이전 달"
				>
					‹
				</button>
				<span className="text-strong" style={{ fontSize: 16, fontWeight: 800, minWidth: 120, textAlign: "center" }}>{ymLabel(ym)}</span>
				<button
					type="button"
					onClick={() => canForward && setYm((v) => shiftYm(v, 1))}
					disabled={!canForward}
					className={canForward ? "text-[#0b84ff]" : "text-[rgba(120,120,128,0.4)]"}
					style={{ background: "none", border: "none", cursor: canForward ? "pointer" : "default", fontSize: 22, lineHeight: 1, padding: 4 }}
					aria-label="다음 달"
				>
					›
				</button>
			</div>

			{!loaded ? (
				<EmptyState loading style={{ padding: "2rem 0" }} />
			) : ledger == null ? (
				<p className="text-faint" style={{ fontSize: 13, textAlign: "center", padding: "1.5rem 0" }}>회계를 불러오지 못했어요. 위 새로고침을 눌러 주세요.</p>
			) : empty ? (
				<p className="text-faint" style={{ fontSize: 13, textAlign: "center", padding: "1.5rem 0" }}>이 달은 회계 내역이 없어요.</p>
			) : (
				<>
					<p className="text-faint" style={{ fontSize: 12, lineHeight: 1.5 }}>클럽이 이 달 무엇으로 얼마를 걷고 썼는지. 항목에 들어온 돈·나간 돈이 다 있으면 옆에 나눠서 보여줘요. 개별 회원 내역은 운영진만 봐요.</p>
					<div className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)] flex flex-col gap-1.5" style={{ borderRadius: 12, padding: "12px 14px" }}>
						{ledger.feeCollected > 0 && <LedgerRow name="걷은 회비" right={<span className="text-[#1c8a3b]" style={{ fontWeight: 800 }}>+{won(ledger.feeCollected)}</span>} />}
						{ledger.sessions.map((s, i) => (
							<LedgerRow key={`sess${i}`} name={`${s.date} ${s.place ?? ""} 대관비`.trim()} inAmt={s.income} outAmt={s.expense} right={<NetAmount n={s.net} />} />
						))}
						{ledger.categories.map((c, i) => (
							<LedgerRow key={`cat${i}`} name={c.name} inAmt={c.in} outAmt={c.out} right={<NetAmount n={c.net} />} />
						))}
						{ledger.refund > 0 && <LedgerRow name="환불" right={<span className="text-[#d1362c]" style={{ fontWeight: 800 }}>−{won(ledger.refund)}</span>} />}
						{(ledger.uncatIn !== 0 || ledger.uncatOut > 0) && <LedgerRow name="미분류" nameColor="#9498a2" inAmt={ledger.uncatIn} outAmt={ledger.uncatOut} right={<NetAmount n={ledger.uncatIn - ledger.uncatOut} />} />}

						{/* 합계는 항목 순액 합과 정확히 같다(현금주의 불변식) — 통장 총수입/총지출은 환불 상쇄분만큼 항목 합과 어긋나므로 여기 안 띄운다. */}
						<div className="flex items-center gap-2" style={{ borderTop: "1px solid rgba(120,120,128,0.2)", paddingTop: 7, marginTop: 2 }}>
							<span className="text-strong" style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>이 달 남은 돈</span>
							<span className={moneyClass(ledger.net >= 0)} style={{ fontSize: 15, fontWeight: 800 }}>{signed(ledger.net)}</span>
						</div>
					</div>
				</>
			)}
		</div>
	);
}
