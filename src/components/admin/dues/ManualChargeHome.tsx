import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { duesActions, useDuesStore } from "../../../store/duesStore";
import EmptyState from "../../shared/EmptyState";
import ManualBatchCard from "./ManualBatchCard";
import ManualChargeSheet from "./ManualChargeSheet";
import { won, ymLabel } from "./duesText";
import { buildManualCards } from "./manualCards";

/**
 * 수동 부과 탭 — 회식·공동구매처럼 **일정과 무관하게** 걷는 돈.
 *
 * 회비(월 진입 ensure)·대관비(세션 종료 트리거)와 달리 자동 생성 트리거가 없다. 대상 명단이 파생
 * 불가능하고 금액이 나중에 정해지기 때문 — 그래서 운영진이 여기서 직접 만든다.
 * 만들어진 부과는 회비·대관비와 **같은 테이블**에 들어가므로 회원의 [내 회비]·미납 알림·정산함
 * 입금 매칭에 자동으로 합류한다(§ dues_charges.batch_key).
 *
 * 카드 모양은 [현황]의 회비·대관비 카드와 공유한다(ManualBatchCard) — 같은 부과인데 탭마다 다르게
 * 보이던 것을 없앴다(2026-08-23).
 */
export default function ManualChargeHome({ ym }: { ym: string }) {
	const loading = useDuesStore((s) => s.manualLoading);
	const loadedYm = useDuesStore((s) => s.manualLoadedYm);
	const batches = useDuesStore((s) => s.manualBatches);
	const batchRows = useDuesStore((s) => s.batches);
	const bankTxns = useDuesStore((s) => s.bankTxns);

	// '새 부과' 시트는 **URL 이 진실**이다(`?open=new`) — 효과 안에서 setState 로 시트를 열지 않아도
	// 되고 딥링크가 된다. 기존 배치의 대조·편집 시트는 카드(ManualBatchCard)가 직접 들고 있다.
	const [sp, setSp] = useSearchParams();
	const newOpen = sp.get("open") === "new";
	const setNewOpen = (on: boolean) => setSp(on ? { open: "new" } : {}, { replace: true });

	useEffect(() => {
		void duesActions.loadManual(ym);
	}, [ym]);

	// 배치는 6개월 창으로 받아 두고(필터의 '지난 명단' 재료) 목록은 그 달만 보여준다.
	const mine = useMemo(
		() => buildManualCards(batches, batchRows, bankTxns, ym),
		[batches, batchRows, bankTxns, ym],
	);
	const sum = useMemo(
		() => ({
			due: mine.reduce((s, c) => s + c.batch.dueSum, 0),
			received: mine.reduce((s, c) => s + c.batch.receivedSum, 0),
			unpaid: mine.reduce((s, c) => s + c.batch.unpaidCount, 0),
		}),
		[mine],
	);

	return (
		<div className="flex flex-col gap-3">
			<button
				type="button"
				onClick={() => setNewOpen(true)}
				className="flex items-center gap-2 bg-[rgba(11,132,255,0.08)] border border-[rgba(11,132,255,0.2)]"
				style={{ borderRadius: 11, padding: "11px 13px", cursor: "pointer", width: "100%", textAlign: "left" }}
			>
				<span style={{ fontSize: 15 }}>➕</span>
				<span className="text-[#0b84ff]" style={{ fontSize: 13.5, fontWeight: 700 }}>
					새 부과 만들기
				</span>
				<span style={{ flex: 1 }} />
				<span className="text-faint" style={{ fontSize: 12 }}>›</span>
			</button>

			{mine.length > 0 && (
				<div className="flex items-baseline gap-2 px-1">
					<span className="text-strong" style={{ fontSize: 13.5, fontWeight: 700 }}>
						{ymLabel(ym)} 부과 {won(sum.due)}
					</span>
					<span className="text-faint" style={{ fontSize: 12 }}>
						받은 돈 {won(sum.received)}
						{sum.unpaid > 0 ? ` · 미납 ${sum.unpaid}명` : ""}
					</span>
				</div>
			)}

			{loading && loadedYm !== ym ? (
				<EmptyState>불러오는 중…</EmptyState>
			) : mine.length === 0 ? (
				<EmptyState>
					이 달 수동 부과가 없어요. 회식비·공동구매처럼 일정과 무관하게 걷는 돈을 여기서 만듭니다.
				</EmptyState>
			) : (
				mine.map((c) => (
					<ManualBatchCard key={c.batch.batchKey} card={c} ym={ym} showMoney />
				))
			)}

			{newOpen && (
				<ManualChargeSheet
					ym={ym}
					batch={null}
					onClose={() => setNewOpen(false)}
					onSaved={() => {
						setNewOpen(false);
						void duesActions.refreshManual(ym);
					}}
				/>
			)}
		</div>
	);
}
