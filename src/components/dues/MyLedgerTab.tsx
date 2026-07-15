import { type ReactNode, useEffect, useState } from "react";
import { duesActions, useDuesStore } from "../../store/duesStore";
import EmptyState from "../shared/EmptyState";
import { currentYm, shiftYm, won, ymLabel } from "../admin/dues/duesText";
import { NetAmount } from "../admin/dues/duesUi";

// 클럽 회계 탭: 월 스테퍼(지난달부터, 당월/미래 제외) + 항목별 공개 회계(현금주의, 합=남은 돈).
export default function MyLedgerTab() {
	const lastMonth = shiftYm(currentYm(), -1); // 열람 가능한 최신 = 지난달(당월은 정산 중이라 비공개)
	const [ym, setYm] = useState(lastMonth);
	const loading = useDuesStore((s) => s.myLedgerLoading);
	const shownYm = useDuesStore((s) => s.myLedgerYm);
	const ledger = useDuesStore((s) => s.myLedger);

	useEffect(() => {
		void duesActions.loadMyLedger(ym);
	}, [ym]);

	const canForward = ym < lastMonth; // 당월/미래로는 못 감
	const loaded = !loading && shownYm === ym; // 이 달 로드 완료(성공/오류 무관)
	const empty = loaded && ledger != null && !(ledger.feeCollected > 0 || ledger.sessions.length > 0 || ledger.categories.length > 0 || ledger.refund > 0 || ledger.uncatIn > 0 || ledger.uncatOut > 0);

	return (
		<div className="flex flex-col gap-3">
			{/* 월 스테퍼 */}
			<div className="flex items-center justify-center gap-4">
				<button type="button" onClick={() => setYm((v) => shiftYm(v, -1))} className="text-[#0b84ff]" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: 4 }} aria-label="이전 달">‹</button>
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
					<p className="text-faint" style={{ fontSize: 12, lineHeight: 1.5 }}>클럽이 이 달 무엇으로 얼마를 걷고 썼는지. 개별 회원 내역은 운영진만 봐요.</p>
					<div className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)] flex flex-col gap-1.5" style={{ borderRadius: 12, padding: "12px 14px" }}>
						{ledger.feeCollected > 0 && <Row name="걷은 회비" right={<span className="text-[#1c8a3b]" style={{ fontWeight: 800 }}>+{won(ledger.feeCollected)}</span>} />}
						{ledger.sessions.map((s, i) => (
							<Row key={`sess${i}`} name={`${s.date} ${s.place ?? ""} 대관비`.trim()} right={<NetAmount n={s.net} />} />
						))}
						{ledger.categories.map((c, i) => (
							<Row key={`cat${i}`} name={c.name} right={<NetAmount n={c.net} />} />
						))}
						{ledger.refund > 0 && <Row name="환불" right={<span className="text-[#d1362c]" style={{ fontWeight: 800 }}>−{won(ledger.refund)}</span>} />}
						{(ledger.uncatIn > 0 || ledger.uncatOut > 0) && <Row name="미분류" nameColor="#9498a2" right={<NetAmount n={ledger.uncatIn - ledger.uncatOut} />} />}
						<div className="flex items-center gap-2" style={{ borderTop: "1px solid rgba(120,120,128,0.2)", paddingTop: 7, marginTop: 2 }}>
							<span className="text-strong" style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>이 달 남은 돈</span>
							<span className={ledger.net >= 0 ? "text-[#1c8a3b]" : "text-[#d1362c]"} style={{ fontSize: 15, fontWeight: 800 }}>{ledger.net >= 0 ? "+" : "−"}{won(Math.abs(ledger.net))}</span>
						</div>
					</div>
				</>
			)}
		</div>
	);
}

function Row({ name, nameColor, right }: { name: string; nameColor?: string; right: ReactNode }) {
	return (
		<div className="flex items-center gap-2" style={{ fontSize: 13.5 }}>
			<span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: nameColor }} className={nameColor ? undefined : "text-strong"}>{name}</span>
			{right}
		</div>
	);
}
