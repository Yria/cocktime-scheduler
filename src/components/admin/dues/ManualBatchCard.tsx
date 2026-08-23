// 수동 부과 카드 한 장 — [현황] 과 [부과] 두 탭이 같은 컴포넌트를 쓴다.
//
// 원래 둘이 각자 그렸고(현황=한 줄 요약, 부과=자기만의 카드) 그래서 같은 화면의 회비·대관비 카드와
// 다르게 보였다. 세션 카드의 언어를 그대로 따른다: 제목 + 상태 배지 → 판정 두 줄(✓/!) → 진행 막대.
//
// **누르면 정산 대조**(세션 카드의 [정산 대조]와 같은 자리), 그 시트에서 [수정]을 한 번 더 누르면
// 편집 시트로 간다(2026-08-23 요청). 두 시트를 카드가 직접 들고 있는 이유: 두 화면이 각자 같은
// 상태(어느 배치를 열었나 · 대조냐 편집이냐)를 복사하면 동작이 갈리기 때문. 카드가 하나만 갖는다.
//
// 카드 전체가 버튼이다 — 조작이 '정산 대조' 하나뿐이라 탭 영역을 카드 전체로 준다(button 안에
// button 을 넣지 않으려고 '정산 대조 ›' 는 글자만 놓는다).

import { useState } from "react";
import { manualTypeLabel } from "../../../lib/supabase/manualCharges";
import { duesActions } from "../../../store/duesStore";
import ManualChargeSheet from "./ManualChargeSheet";
import ManualSettleSheet from "./ManualSettleSheet";
import { Meter, MoreHint } from "./duesCardBits";
import { CARD_CLASS, cardBox, mark, pill } from "./duesCardStyles";
import { fmtMD, won } from "./duesText";
import type { ManualCard } from "./manualCards";

export default function ManualBatchCard({
	card,
	ym,
	showMoney = false,
}: {
	card: ManualCard;
	ym: string;
	/**
	 * 카드 아래 금액 줄(날짜·인원·부과합·받은 돈)을 보일지. [현황]은 끈다 — 판정·진행률만 보고
	 * 숫자는 대조 시트에서 본다는 요청(2026-08-23). [부과] 탭은 그 자체가 부과 목록이라 켠다.
	 */
	showMoney?: boolean;
}) {
	const [settleOpen, setSettleOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);

	const { batch: b, done, expense, liveCount, paidCount, clubShare, funded } = card;
	const paidUp = b.unpaidCount === 0;
	const linked = expense > 0;

	return (
		<>
			<button
				type="button"
				onClick={() => setSettleOpen(true)}
				className={`${CARD_CLASS} transition active:opacity-70`}
				style={{ ...cardBox(done), width: "100%", textAlign: "left", cursor: "pointer" }}
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

					{/* ② 수납 — 요약 + 대조 진입 + 진행 막대. */}
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
							<MoreHint label="정산 대조" />
						</div>
						{liveCount > 0 && <Meter ratio={paidCount / liveCount} done={paidUp} />}
					</div>

					{/* 금액 사실 — 판정이 아니므로 마크 없이. [현황]에서는 감춘다(대조 시트에 있다). */}
					{showMoney && (
						<div className="text-faint flex flex-col" style={{ fontSize: 11.5, gap: 1 }}>
							<span>
								{/* 인원은 '부과 대상'(무효 제외) — 아래 '부과' 합계와 곱셈이 맞아야 하고,
								    눌러서 열리는 대조 시트도 같은 수를 말한다. */}
								{fmtMD(`${b.chargedOn}T00:00:00+09:00`)} · {liveCount}명 × 인당{" "}
								{b.mixedAmount ? `${won(b.perHead)}~` : won(b.perHead)}
							</span>
							<span>
								낼 돈 {won(b.dueSum)} · 받은 돈 {won(b.receivedSum)}
								{/* 지출이 부과합보다 크면 그 차액은 클럽이 낸 것 — 의도된 경우가 많아 경고가 아니다. */}
								{clubShare > 0 ? ` · 클럽 부담 ${won(clubShare)}` : ""}
								{funded > 0 ? ` · 묶음 직접 입금 ${won(funded)}` : ""}
							</span>
						</div>
					)}
				</div>
			</button>

			{/* 대조 → [수정] → 편집. 편집 중에는 대조를 내려 두 시트가 같은 층에 겹치지 않게 하고,
			    편집을 닫으면 대조로 돌아온다(뒤로 가기처럼 읽히게). */}
			{settleOpen && !editOpen && (
				<ManualSettleSheet
					card={card}
					onEdit={() => {
						// 편집 시트의 회차 선택·참석 기반 필터는 loadManual 이 채우는 슬라이스를 읽는다.
						// [부과] 탭을 안 거치고 [현황]에서 바로 열면 그게 비어 있다(캐시 가드가 있어 중복 호출은 no-op).
						void duesActions.loadManual(ym);
						setEditOpen(true);
					}}
					onClose={() => setSettleOpen(false)}
				/>
			)}
			{editOpen && (
				<ManualChargeSheet
					ym={ym}
					batch={b}
					// ✕·백드롭·Escape 는 라벨대로 '닫기' 다 — 대조까지 함께 닫는다(반쯤 닫히면 뭘 눌렀는지 헷갈린다).
					onClose={() => {
						setEditOpen(false);
						setSettleOpen(false);
					}}
					onSaved={(info) => {
						// 삭제로 배치가 사라졌으면 돌아갈 대조가 없다.
						if (info?.deleted) {
							setEditOpen(false);
							setSettleOpen(false);
							void duesActions.refreshManual(ym);
							return;
						}
						// 갱신이 끝난 뒤 편집을 닫는다 — 먼저 닫으면 대조 시트가 저장 이전 숫자로 잠깐 뜬다.
						void duesActions.refreshManual(ym).finally(() => setEditOpen(false));
					}}
				/>
			)}
		</>
	);
}
