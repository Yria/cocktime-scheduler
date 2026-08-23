// 수동 부과 카드의 파생값 — 화면 두 곳([현황] 요약, [부과] 목록)이 **같은 계산**을 쓰게 모아 둔 곳.
//
// 카드가 말해야 하는 건 세션 카드와 같은 두 가지 판정이다:
//   ① 지출 연결 — 이 묶음으로 나간 돈이 통장 거래에 붙었나(안 붙으면 공개회계에서 '미분류'로 남는다)
//   ② 수납 완료 — 부과받은 사람이 다 냈나
// 그래서 '마감' 판정도 세션 카드와 같은 식이다(지출 연결 && 미납 0 → 마감).
//
// 알려진 한계: 지출 합계는 그 달 통장 거래(bankTxns)에서만 센다. 회식비 결제가 다음 달로 넘어가면
// 그 달 화면에선 '미연결'로 보인다(세션 카드의 코트지출 연결도 같은 성질).

import type { BankTxnRow, BatchRow } from "../../../lib/supabase/dues";
import type { ManualBatch } from "../../../lib/supabase/manualCharges";

export interface ManualCard {
	batch: ManualBatch;
	/** dues_batches.id — 통장 거래가 붙는 축. 아직 묶음 행이 없으면 null. */
	batchId: number | null;
	/** 엔빵 원본 총액(부과 시 입력한 것). 인당 직접 입력이면 null. */
	total: number | null;
	/** 이 묶음에 붙은 출금 합계(= 클럽이 실제로 낸 돈). */
	expense: number;
	/** 부과 없이 묶음에 직접 붙은 입금 합계(공구 모금처럼 부과를 거치지 않는 돈). */
	funded: number;
	/** 살아 있는 부과 건수(부과삭제·면제 제외) — 진행률의 분모. */
	liveCount: number;
	paidCount: number;
	/** 클럽이 부담한 차액(지출 − 부과합). 0 이하면 없음. */
	clubShare: number;
	/** 세션 카드와 같은 판정: 지출 연결 + 미납 0. */
	done: boolean;
}

export function buildManualCards(
	batches: ManualBatch[],
	batchRows: BatchRow[],
	txns: BankTxnRow[],
	ym: string,
): ManualCard[] {
	// dues_batches.key 는 'manual:{batch_key}' 다(부과의 batch_key 와 같은 이름공간).
	const rowByKey = new Map(
		batchRows.filter((r) => r.kind === "manual").map((r) => [r.key.replace(/^manual:/, ""), r]),
	);
	const outByBatch = new Map<number, number>();
	const inByBatch = new Map<number, number>();
	for (const t of txns) {
		if (t.batchId == null) continue;
		const m = t.direction === "out" ? outByBatch : inByBatch;
		m.set(t.batchId, (m.get(t.batchId) ?? 0) + t.amount);
	}

	return batches
		.filter((b) => b.chargedOn.slice(0, 7) === ym)
		.map((batch) => {
			const row = rowByKey.get(batch.batchKey) ?? null;
			const expense = row ? (outByBatch.get(row.id) ?? 0) : 0;
			const liveCount = Math.max(0, batch.head - batch.deadCount);
			return {
				batch,
				batchId: row?.id ?? null,
				total: row?.totalAmount ?? null,
				expense,
				funded: row ? (inByBatch.get(row.id) ?? 0) : 0,
				liveCount,
				paidCount: Math.max(0, liveCount - batch.unpaidCount),
				clubShare: Math.max(0, expense - batch.dueSum),
				done: expense > 0 && batch.unpaidCount === 0,
			} satisfies ManualCard;
		});
}
