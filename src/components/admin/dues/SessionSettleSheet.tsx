import { type CSSProperties, type ReactNode, useState } from "react";
import ModalSheet from "../../common/ModalSheet";
import BirthYearTag from "../../shared/BirthYearTag";
import { nameWithBirthYear } from "../../../lib/birthYear";
import { sessionLabel, statusChipClass, statusLabel, won } from "./duesText";
import { EXEMPT_LABEL, EXTRA_LABEL, type SessionSettle } from "./sessionSettle";
import type { SessionFeeRow } from "../../../lib/supabase/dues";

// 세션 정산 대조 시트(열람 전용).
//
// 왜 있나: 현황 카드는 '부과된 건'만 다뤄서 ①부과 명단 전체 ②참석했는데 부과가 없는 사람
// ③받은 돈·지출 총합을 한 화면에서 대조할 수 없었다. 특히 당일취소자에게도 정액이 부과되므로
// `참석 인원 × 6,000`이 통장과 어긋나는데, 그 차이를 화면이 설명하지 않아 운영진이 매번 손으로
// 다시 셌다. 이 시트는 **머릿수 → 부과 건수 → 돈** 을 한 줄씩 이어 그 갈림을 눈에 보이게 만든다.
//
// 조작 범위: **당일취소 부과삭제/되돌리기만**. 미납 푸시 발송은 폐기(UnpaidDuesAlert 가 대체)돼
// 카드 펼침이 없어졌으므로, 그 펼침에 있던 부과삭제를 이 시트가 이어받는다. 부과 누락은 클라에서
// 쓸 복구 RPC가 없어(즉석 생성은 정산함 입금확인 경로뿐) 안내 문구로 다음 행동만 가리킨다.

interface Props {
	session: SessionFeeRow;
	settle: SessionSettle;
	settled: boolean; // 마감(코트지출 연결 + 미납 0)
	courtLinked: boolean;
	busy: boolean;
	onVoidRequest: (chargeId: number, name: string) => void; // 당일취소 부과삭제(확인 다이얼로그)
	onReset: (chargeId: number) => void; // 부과삭제 되돌리기
	onClose: () => void;
}

export default function SessionSettleSheet({ session, settle, settled, courtLinked, busy, onVoidRequest, onReset, onClose }: Props) {
	const [rosterOpen, setRosterOpen] = useState(true);
	const s = settle;
	const split = s.mode === "split";
	// 부과액이 한 종류일 때만 `N건 × 단가` 곱셈이 성립(선납 시점이 달라 단가가 섞인 세션은 합계만).
	const uniform = s.dueAmounts.length === 1 ? s.dueAmounts[0] : null;
	const hasDayCancel = s.charged.some((c) => c.isDayCancel);

	const modeText = split
		? `엔빵 · 총액 ${won(s.total ?? 0)}`
		: `정액 ${won(s.perHead)}`;

	return (
		<ModalSheet
			position="bottom"
			onClose={onClose}
			closeOnEscape
			title={sessionLabel(session)}
			subtitle={`${modeText} · ${settled ? "마감" : "정산 미완"}`}
		>
			<div className="flex flex-col gap-4 px-5 pb-6">
				{/* ── ① 머릿수 → 부과 건수 : '참석 × 단가'가 안 맞는 이유를 항등식으로 닫는다 ── */}
				<Section title="인원 대조" hint="참석 머릿수가 부과 건수로 바뀌는 과정">
					<Row label="참석 확정" value={`${s.attendCount}명`} sub={split ? "운영진 포함 · 엔빵 분모" : undefined} />
					{!split && s.adminAttendCount > 0 && (
						<Row label="− 운영진" value={`${s.adminAttendCount}명`} tone="muted" sub="대관비를 걷지 않음" />
					)}
					{!split && s.targetDayCancelCount > 0 && (
						<Row label="+ 당일취소" value={`${s.targetDayCancelCount}명`} tone="warn" sub="자리·약속 비용이라 정액 부과" />
					)}
					{split && s.splitDayCancelCount > 0 && (
						<Row label="당일취소" value={`${s.splitDayCancelCount}명`} tone="muted" sub="코트를 쓰지 않아 엔빵 미부과" />
					)}
					{s.graceCount > 0 && (
						<Row label="확정 후 1시간 내 철회" value={`${s.graceCount}명`} tone="muted" sub="오조작으로 보고 미부과" />
					)}
					<Divider />
					<Row
						label="부과 대상"
						value={`${s.targetCount}명`}
						sub={split && s.total != null && s.attendCount > 0 ? `${s.total.toLocaleString("ko-KR")} ÷ ${s.attendCount}명 = 인당 ${won(s.perHead)} · 10원 버림` : undefined}
						strong
					/>
					{s.missing.length > 0 && <Row label="− 부과 누락" value={`${s.missing.length}명`} tone="out" indent />}
					{s.deadOnTargetCount > 0 && <Row label="− 부과삭제·면제" value={`${s.deadOnTargetCount}건`} tone="muted" indent />}
					{s.liveExtraCount > 0 && <Row label="+ 대상 아닌 부과" value={`${s.liveExtraCount}건`} tone="out" indent sub="규칙과 어긋난 잔재" />}
					{(s.missing.length > 0 || s.deadOnTargetCount > 0 || s.liveExtraCount > 0) && (
						<Row label="실제 부과" value={`${s.activeCount}건`} strong />
					)}
				</Section>

				{/* ── ② 돈 ─────────────────────────────────────────────────────── */}
				<Section title="금액 대조" hint="발생 기준(이 세션에 귀속된 돈 전부)">
					{/* 들여쓴 줄은 바로 위 줄의 '부분'만 둔다 — 미납 ⊂ 낼 돈. 받은 돈은 무효분에 붙은
					    선납·초과납도 포함해 '낼 돈'의 부분이 아니므로 같은 층에 세운다. */}
					<Row
						label="낼 돈"
						value={won(s.dueSum)}
						sub={uniform != null && s.activeCount > 0 ? `${s.activeCount}건 × ${uniform.toLocaleString("ko-KR")}원` : undefined}
						strong
					/>
					{s.unpaidSum > 0 && <Row label="미납" value={won(s.unpaidSum)} tone="warn" indent sub={`${s.unpaidCount}명`} />}
					{s.voidSum > 0 && <Row label="부과삭제·면제" value={won(s.voidSum)} tone="muted" sub="낼 돈에 안 들어감" />}
					<Row label="받은 돈" value={`+${won(s.received)}`} tone="in" />
					{s.externalIn > 0 && <Row label="비회원 입금" value={`+${won(s.externalIn)}`} tone="in" sub="회원 아닌 참가자" />}
					<Row
						label="코트 지출"
						value={courtLinked ? `−${won(s.expense)}` : "미연결"}
						tone={courtLinked ? "out" : "warn"}
						sub={courtLinked ? undefined : "정산함에서 출금 → 세션 지정"}
					/>
					<Divider />
					<Row label="현재 순액" value={signedWon(s.net)} tone={s.net >= 0 ? "in" : "out"} strong />
					{s.unpaidSum > 0 && <Row label="전원 완납 시" value={signedWon(s.expectedNet)} tone="muted" indent />}
				</Section>

				{/* ── ③ 통합 명단: 부과 있는 사람 + 누락 + 정상 면제를 한 목록에, 우측에 사유.
				     섹션을 쪼개면 "이 사람 어디 있지"를 세 곳에서 찾아야 해서 대조가 안 된다. ── */}
				<div>
					<button
						type="button"
						onClick={() => setRosterOpen((v) => !v)}
						aria-expanded={rosterOpen}
						className="flex w-full items-center gap-2"
						style={{ background: "none", border: "none", padding: "0 0 6px", cursor: "pointer", textAlign: "left" }}
					>
						<b className="text-strong" style={{ fontSize: 13.5, flexShrink: 0 }}>전체 명단 {s.roster.length}명</b>
						{/* 상태별 머릿수 — 다섯 칸이 서로 겹치지 않아 합 = 명단 수(확인필요 행은 완납·미납으로
						    이중 계상하지 않는다). 0은 생략. 좁은 화면에선 줄바꿈. */}
						<span className="flex flex-wrap items-center justify-end" style={{ gap: "1px 7px", flex: 1, minWidth: 0, fontSize: 11.5 }}>
							{s.rosterCounts.paid > 0 && <span className="text-[#1c8a3b]">완납 {s.rosterCounts.paid}</span>}
							{s.rosterCounts.unpaid > 0 && <span className="text-[#c2670a]" style={{ fontWeight: 700 }}>미납 {s.rosterCounts.unpaid}</span>}
							{s.rosterCounts.dead > 0 && <span className="text-faint">무효 {s.rosterCounts.dead}</span>}
							{s.rosterCounts.none > 0 && <span className="text-faint">부과없음 {s.rosterCounts.none}</span>}
							{s.flaggedCount > 0 && <span className="text-[#d1362c]" style={{ fontWeight: 700 }}>⚠ 확인 {s.flaggedCount}</span>}
						</span>
						<span className="text-faint" style={{ fontSize: 10, fontWeight: 800, flexShrink: 0 }}>{rosterOpen ? "▲" : "▼"}</span>
					</button>
					{rosterOpen && (
						<div className="flex flex-col" style={{ gap: 2, background: "rgba(120,120,128,0.06)", borderRadius: 10, padding: "8px 10px" }}>
							{s.roster.length === 0 && <p className="text-faint" style={{ fontSize: 12.5 }}>아직 부과가 없어요. 세션이 종료되면 자동 생성돼요.</p>}
							{hasDayCancel && (
								<p className="text-faint" style={{ fontSize: 11, lineHeight: 1.45, marginBottom: 2 }}>
									당일취소는 자리값이라 정액이 기본 부과돼요. 카풀 불발 등 사정이 있으면 [부과삭제]로 뺄 수 있어요(취소선·되돌리기).
								</p>
							)}
							{s.roster.map((r) => {
								const c = r.charge;
								const alert = r.kind === "missing" || r.kind === "stale"; // 우측 사유를 빨강으로
								const dim = c ? !c.live : r.kind === "exempt"; // 무효 부과·정상 면제는 흐리게
								// 우측 사유 — 누락은 모드에 따라 문구가 갈리고, 나머지는 라벨 테이블에서.
								// 같은 사유라도 부과가 있으면 "…인데 부과됨"(EXTRA), 없으면 "…미부과"(EXEMPT).
								const reasonText =
									r.kind === "missing"
										? split ? "참석했는데 부과 없음" : "참석·당일취소인데 부과 없음"
										: r.reason
											? c ? EXTRA_LABEL[r.reason] : EXEMPT_LABEL[r.reason]
											: null;
								return (
									<div key={r.key} className="flex items-center gap-2" style={{ fontSize: 13, padding: "2px 0" }}>
										<span
											className={dim ? "text-muted" : "text-strong"}
											style={{ fontWeight: alert ? 700 : 600, flexShrink: 0, opacity: dim ? 0.55 : 1, textDecoration: c && !c.live ? "line-through" : undefined }}
										>
											{r.name}
											<BirthYearTag birthYear={r.birthYear} size={11} />
										</span>
										<span className="flex min-w-0 flex-wrap items-center" style={{ gap: 4, flex: 1 }}>
											{c?.isDayCancel && <Tag tone="warn">당일취소</Tag>}
											{c?.payerName && <Tag tone="info">게스트 · {c.payerName} 대납</Tag>}
											{r.isAdmin && r.kind !== "exempt" && <Tag tone="muted">운영진</Tag>}
											{c?.voidedByName && <Tag tone="muted">삭제함 · {c.voidedByName}</Tag>}
										</span>
										{/* 우측: 사유 → 금액 → 상태칩. 부과 없는 사람은 사유만 놓여 자리가 비어 보이지 않는다. */}
										{reasonText && (
											<span className={alert ? "text-[#d1362c]" : "text-faint"} style={{ fontSize: 11, fontWeight: alert ? 700 : 500, flexShrink: 0, textAlign: "right" }}>
												{reasonText}
											</span>
										)}
										{c && (
											<>
												<span
													className="text-muted"
													style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0, opacity: c.live ? 1 : 0.45, textDecoration: c.live ? undefined : "line-through" }}
												>
													{c.amountDue.toLocaleString("ko-KR")}
												</span>
												<span className={`rounded-[6px] ${statusChipClass(c.status)}`} style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 6px", flexShrink: 0, minWidth: 38, textAlign: "center" }}>
													{c.status === "partial" ? `${c.remain.toLocaleString("ko-KR")} 남음` : statusLabel(c.status)}
												</span>
											</>
										)}
										{/* 당일취소 부과만 조작 대상 — 살아 있으면 [부과삭제], void 면 [되돌리기]. */}
										{c?.isDayCancel && c.status === "void" && (
											<button type="button" onClick={() => onReset(c.chargeId)} disabled={busy} className="text-[#0b84ff]" style={actionBtn("rgba(11,132,255,0.1)")}>되돌리기</button>
										)}
										{c?.isDayCancel && c.live && c.amountPaid === 0 && (
											<button type="button" onClick={() => onVoidRequest(c.chargeId, nameWithBirthYear(c.name, r.birthYear))} disabled={busy} className="text-[#d1362c]" style={actionBtn("rgba(209,54,44,0.1)")}>부과삭제</button>
										)}
									</div>
								);
							})}
						</div>
					)}
					{/* 확인 대상의 다음 행동 — 명단 아래 한 줄로. */}
					{(s.missing.length > 0 || s.staleCharges.length > 0 || s.orphanCharges.length > 0) && (
						<p className="text-faint" style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 6 }}>
							{s.missing.length > 0 && "부과 누락은 세션 종료 후 참석이 바뀐 경우예요. 정산함에서 그 회원 입금을 확인할 때 이 세션 대관비를 즉석 생성할 수 있어요. "}
							{s.staleCharges.length > 0 && "이미 낸 부과는 규칙이 바뀌어도 자동 정리되지 않아요(선납 보존). 환불·다음 세션 이월은 직접 판단해 주세요. "}
							{s.orphanCharges.length > 0 && `참석 기록 없는 부과 ${s.orphanCharges.length}건은 참석 데이터보다 부과가 먼저 있는 세션이라 대조할 수 없어요.`}
						</p>
					)}
				</div>
			</div>
		</ModalSheet>
	);
}

/** 명단 행 끝 조작 버튼(부과삭제·되돌리기) 공용 스타일. */
const actionBtn = (bg: string): CSSProperties => ({
	fontSize: 11.5,
	fontWeight: 700,
	background: bg,
	border: "none",
	borderRadius: 7,
	padding: "3px 8px",
	cursor: "pointer",
	flexShrink: 0,
});

/** +12,000원 / −12,000원 (0은 '0원'). duesText.signed 는 0을 +로 쓰므로 여기선 별도. */
function signedWon(n: number): string {
	if (n === 0) return "0원";
	return `${n > 0 ? "+" : "−"}${won(Math.abs(n))}`;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
	return (
		<div>
			<div className="flex items-baseline gap-1.5" style={{ marginBottom: 6 }}>
				<b className="text-strong" style={{ fontSize: 13.5 }}>{title}</b>
				{hint && <span className="text-faint" style={{ fontSize: 11 }}>{hint}</span>}
			</div>
			<div className="flex flex-col" style={{ gap: 3, background: "rgba(120,120,128,0.06)", borderRadius: 10, padding: "9px 11px" }}>
				{children}
			</div>
		</div>
	);
}

const TONE: Record<string, string> = {
	in: "text-[#1c8a3b]",
	out: "text-[#d1362c]",
	warn: "text-[#c2670a]",
	muted: "text-muted",
};

function Row({ label, value, sub, tone, strong, indent }: {
	label: string;
	value: string;
	sub?: string;
	tone?: "in" | "out" | "warn" | "muted";
	strong?: boolean;
	indent?: boolean;
}) {
	const cls = tone ? TONE[tone] : "text-strong";
	return (
		<div className="flex items-baseline gap-2" style={{ fontSize: 13, paddingLeft: indent ? 12 : 0 }}>
			<span className={indent ? "text-muted" : "text-strong"} style={{ fontWeight: strong ? 700 : 500, flexShrink: 0 }}>
				{indent ? "└ " : ""}{label}
			</span>
			{sub && <span className="text-faint" style={{ fontSize: 11, minWidth: 0 }}>{sub}</span>}
			<span style={{ flex: 1 }} />
			<span className={cls} style={{ fontWeight: strong ? 800 : 700, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{value}</span>
		</div>
	);
}

function Divider() {
	return <div style={{ height: 1, background: "rgba(120,120,128,0.22)", margin: "3px 0" }} />;
}

function Tag({ tone, children }: { tone: "warn" | "info" | "muted"; children: ReactNode }) {
	const map: Record<string, CSSProperties> = {
		warn: { background: "rgba(255,149,0,0.16)", color: "#c2670a" },
		info: { background: "rgba(11,132,255,0.14)", color: "#0b84ff" },
		muted: { background: "rgba(120,120,128,0.16)", color: "#64748b" },
	};
	return (
		<span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 6px", borderRadius: 6, whiteSpace: "nowrap", ...map[tone] }}>
			{children}
		</span>
	);
}
