import { useEffect, useMemo, useState } from "react";
import type { ManualBatch } from "../../../lib/supabase/manualCharges";
import { manualTypeLabel } from "../../../lib/supabase/manualCharges";
import { duesActions, useDuesStore } from "../../../store/duesStore";
import EmptyState from "../../shared/EmptyState";
import { fmtMD, won, ymLabel } from "./duesText";
import ManualChargeSheet from "./ManualChargeSheet";

/**
 * 수동 부과 탭 — 회식·공동구매처럼 **일정과 무관하게** 걷는 돈.
 *
 * 회비(월 진입 ensure)·대관비(세션 종료 트리거)와 달리 자동 생성 트리거가 없다. 대상 명단이 파생
 * 불가능하고 금액이 나중에 정해지기 때문 — 그래서 운영진이 여기서 직접 만든다.
 * 만들어진 부과는 회비·대관비와 **같은 테이블**에 들어가므로 회원의 [내 회비]·미납 알림·정산함
 * 입금 매칭에 자동으로 합류한다(§ dues_charges.batch_key).
 */
export default function ManualChargeHome({ ym }: { ym: string }) {
	const loading = useDuesStore((s) => s.manualLoading);
	const loadedYm = useDuesStore((s) => s.manualLoadedYm);
	const batches = useDuesStore((s) => s.manualBatches);
	const [sheet, setSheet] = useState<{ batch: ManualBatch | null } | null>(null);

	useEffect(() => {
		void duesActions.loadManual(ym);
	}, [ym]);

	// 배치는 6개월 창으로 받아 두고(필터의 '지난 명단' 재료) 목록은 그 달만 보여준다.
	const mine = useMemo(
		() => batches.filter((b) => b.chargedOn.slice(0, 7) === ym),
		[batches, ym],
	);
	const sum = useMemo(
		() => ({
			due: mine.reduce((s, b) => s + b.dueSum, 0),
			received: mine.reduce((s, b) => s + b.receivedSum, 0),
			unpaid: mine.reduce((s, b) => s + b.unpaidCount, 0),
		}),
		[mine],
	);

	const close = () => setSheet(null);
	const saved = () => {
		setSheet(null);
		void duesActions.refreshManual(ym);
	};

	return (
		<div className="flex flex-col gap-3">
			<button
				type="button"
				onClick={() => setSheet({ batch: null })}
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
				mine.map((b) => <BatchCard key={b.batchKey} b={b} onOpen={() => setSheet({ batch: b })} />)
			)}

			{sheet && (
				<ManualChargeSheet ym={ym} batch={sheet.batch} onClose={close} onSaved={saved} />
			)}
		</div>
	);
}

function BatchCard({ b, onOpen }: { b: ManualBatch; onOpen: () => void }) {
	const done = b.unpaidCount === 0;
	return (
		<button
			type="button"
			onClick={onOpen}
			className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]"
			style={{
				borderRadius: 12,
				padding: "11px 13px",
				width: "100%",
				textAlign: "left",
				cursor: "pointer",
				opacity: done ? 0.85 : 1,
			}}
		>
			<div className="flex items-center gap-2">
				<b className="text-strong truncate" style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>
					{b.label}
				</b>
				<span
					className="text-muted flex-shrink-0"
					style={{ fontSize: 11, fontWeight: 700, background: "rgba(120,120,128,0.12)", borderRadius: 6, padding: "2px 7px" }}
				>
					{manualTypeLabel(b.type)}
				</span>
				{done ? (
					<span className="text-[#1c8a3b] flex-shrink-0" style={{ fontSize: 11.5, fontWeight: 700 }}>
						마감 ✓
					</span>
				) : (
					<span style={{ fontSize: 11.5, fontWeight: 700, color: "#d1362c", flexShrink: 0 }}>
						미납 {b.unpaidCount}
					</span>
				)}
			</div>
			<div className="text-faint mt-1" style={{ fontSize: 12 }}>
				{fmtMD(`${b.chargedOn}T00:00:00+09:00`)} · {b.head}명 ×{" "}
				{b.mixedAmount ? `${won(b.perHead)}~` : won(b.perHead)} · 낼 돈 {won(b.dueSum)} · 받은 돈{" "}
				{won(b.receivedSum)}
				{b.deadCount > 0 ? ` · 부과삭제 ${b.deadCount}` : ""}
			</div>
		</button>
	);
}
