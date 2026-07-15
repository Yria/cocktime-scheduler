import { useDuesStore } from "../../../store/duesStore";
import EmptyState from "../../shared/EmptyState";
import LedgerBreakdown from "./LedgerBreakdown";
import LedgerSummary from "./LedgerSummary";
import LedgerTxnList from "./LedgerTxnList";

// 회계: 은행 입출금 기반 장부. 요약(수입/지출/남은 돈) + 항목별 정산(월 통장 기준) + 거래 내역(러닝 잔액).
// 세 섹션은 각자 필요한 스토어 슬라이스만 구독 — 리렌더를 서로 격리(§11).
export default function LedgerView({ ym }: { ym: string }) {
	const loading = useDuesStore((s) => s.monthLoading);
	if (loading) return <EmptyState loading style={{ padding: "2.5rem 0" }} />;
	return (
		<div className="flex flex-col gap-4">
			<LedgerSummary />
			<LedgerBreakdown ym={ym} />
			<LedgerTxnList ym={ym} />
		</div>
	);
}
