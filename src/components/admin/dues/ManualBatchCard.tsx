// 수동 부과 카드 한 장 — [현황] 요약과 [부과] 목록이 **같은 컴포넌트**를 쓴다.
//
// 원래 둘이 각자 그렸고(현황=한 줄 요약, 부과=자기만의 카드) 그래서 같은 화면의 회비·대관비 카드와
// 다르게 보였다. 세션 카드의 언어를 그대로 따른다: 제목 + 상태 배지 → 판정 두 줄(✓/!) → 진행 막대
// → 금액 사실. 판정은 duesCardBits 의 mark/pill/Meter 로, 계산은 manualCards.buildManualCards 로.

import { manualTypeLabel } from "../../../lib/supabase/manualCharges";
import { Meter, MoreLink } from "./duesCardBits";
import { CARD_CLASS, cardBox, mark, pill } from "./duesCardStyles";
import { fmtMD, won } from "./duesText";
import type { ManualCard } from "./manualCards";

export default function ManualBatchCard({
	card,
	actionLabel,
	onAction,
}: {
	card: ManualCard;
	/** 상세로 들어가는 링크 문구([현황]은 부과 탭으로, [부과]는 그 자리에서 수정 시트로). */
	actionLabel: string;
	onAction: () => void;
}) {
	const { batch: b, done, expense, liveCount, paidCount, clubShare, funded } = card;
	const paidUp = b.unpaidCount === 0;
	const linked = expense > 0;

	return (
		<div className={CARD_CLASS} style={cardBox(done)}>
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
				{/* 부과삭제·면제된 건이 있으면 따로 세운다 — 진행률 분모에서 빠지므로 '마감 ✓'에 숨는다. */}
				{b.deadCount > 0 && <span style={pill("bad")}>부과삭제 {b.deadCount}</span>}
				<span style={pill(done ? "ok" : "warn")}>{done ? "마감 ✓" : "정산 미완"}</span>
			</div>

			<div className="flex flex-col gap-2" style={{ marginTop: 8 }}>
				{/* ① 지출 연결 — 세션 카드의 '코트지출 연결'과 같은 판정(안 붙으면 공개회계에서 미분류). */}
				<div className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
					<span style={mark(linked)}>{linked ? "✓" : "!"}</span>
					<span className={linked ? "text-muted" : "text-[#c2670a]"}>
						{linked ? `지출 연결 · ${won(expense)}` : "지출 미연결 · 정산함에서 출금→묶음 지정"}
					</span>
				</div>

				{/* ② 수납 — 요약 + 상세 진입 + 진행 막대. */}
				<div className="flex flex-col gap-1">
					<div className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
						<span style={mark(paidUp)}>{paidUp ? "✓" : "!"}</span>
						<span className={paidUp ? "text-muted" : "text-[#c2670a]"}>수납</span>
						{liveCount > 0 && (
							<span className="text-muted" style={{ fontSize: 11.5 }}>
								{paidCount}/{liveCount}
								{b.unpaidCount > 0 ? ` · 미납 ${b.unpaidCount}` : ""}
							</span>
						)}
						<span style={{ flex: 1 }} />
						<MoreLink label={actionLabel} onClick={onAction} />
					</div>
					{liveCount > 0 && <Meter ratio={paidCount / liveCount} done={paidUp} />}
				</div>

				{/* 금액 사실 — 판정이 아니므로 마크 없이. 두 줄로 갈라 모바일에서 읽히게 한다. */}
				<div className="text-faint flex flex-col" style={{ fontSize: 11.5, gap: 1 }}>
					<span>
						{fmtMD(`${b.chargedOn}T00:00:00+09:00`)} · {b.head}명 × 인당{" "}
						{b.mixedAmount ? `${won(b.perHead)}~` : won(b.perHead)}
					</span>
					<span>
						부과 {won(b.dueSum)} · 받은 돈 {won(b.receivedSum)}
						{/* 지출이 부과합보다 크면 그 차액은 클럽이 낸 것 — 회식 지원처럼 의도된 경우가 많아 경고가 아니다. */}
						{clubShare > 0 ? ` · 클럽 부담 ${won(clubShare)}` : ""}
						{funded > 0 ? ` · 묶음 직접 입금 ${won(funded)}` : ""}
					</span>
				</div>
			</div>
		</div>
	);
}
