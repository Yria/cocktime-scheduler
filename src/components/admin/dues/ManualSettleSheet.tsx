import { useMemo, useState } from "react";
import { manualTypeLabel } from "../../../lib/supabase/manualCharges";
import { useDuesStore } from "../../../store/duesStore";
import BirthYearTag from "../../shared/BirthYearTag";
import ModalSheet from "../../common/ModalSheet";
import { Divider, Row, Section } from "./duesSheetBits";
import { fmtMD, signedWon, statusChipClass, statusLabel, won } from "./duesText";
import type { ManualCard } from "./manualCards";

// 수동 부과 정산 대조 시트(열람 + [수정] 진입).
//
// 세션 카드의 [정산 대조]와 **같은 자리**다: 카드는 요약·배지만 말하고, "몇 명이 대상인지 →
// 누가 냈는지 → 돈이 맞는지"는 이 시트가 한 화면에서 이어 보여준다. 수동 부과는 대상·금액을 사람이
// 정하므로 특히 "카드의 수납 12/17 이 누구냐"를 여기서 닫아야 한다(2026-08-23 요청).
//
// 조작은 [수정] 하나뿐이다 — 명단·금액을 고치는 것이 곧 이 부과의 유일한 조작이고, 그 화면(편집
// 시트)이 이미 삭제·부분 처리까지 다 갖고 있다. 그래서 이 시트는 갈림을 보여주고 넘긴다.
export default function ManualSettleSheet({
	card,
	onEdit,
	onClose,
}: {
	card: ManualCard;
	onEdit: () => void;
	onClose: () => void;
}) {
	const members = useDuesStore((s) => s.members);
	const [rosterOpen, setRosterOpen] = useState(true);
	const b = card.batch;

	const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
	const roster = useMemo(() => {
		// 미납 → 완납 → 무효(부과삭제·면제) 순. 대조는 "안 낸 사람 찾기"부터라 미납이 맨 위다.
		const rank = (dead: boolean, full: boolean) => (dead ? 2 : full ? 1 : 0);
		return b.entries
			.map((e) => {
				const m = memberById.get(e.memberId);
				const dead = e.status === "void" || e.status === "waived";
				return {
					...e,
					dead,
					full: e.paid >= e.due,
					remain: Math.max(0, e.due - e.paid),
					name: m?.name ?? "(명단에 없는 회원)",
					birthYear: m?.birthYear ?? null,
				};
			})
			.sort(
				(x, y) =>
					rank(x.dead, x.full) - rank(y.dead, y.full) || x.name.localeCompare(y.name, "ko"),
			);
	}, [b.entries, memberById]);

	// 파생값은 전부 manualCards(카드와 같은 소스)에서 온다 — 시트가 다시 계산하면 카드와 갈린다.
	const { unpaidSum, deadSum, net, expectedNet, clubShare } = card;
	// 절상 때문에 부과합이 원본 총액보다 클 수 있다(splitAmount: 인당을 10/100/1000원 단위로 올림).
	// 그래서 '총액 ÷ 인원 = 인당' 같은 등식은 쓰지 않는다 — 성립하지 않는다.
	const roundUp = card.total != null ? b.dueSum - card.total : 0;

	const perHeadText = b.mixedAmount ? `인당 금액 섞임(최소 ${won(b.perHead)})` : `인당 ${won(b.perHead)}`;

	return (
		<ModalSheet
			position="bottom"
			onClose={onClose}
			closeOnEscape
			title={b.label}
			subtitle={`${manualTypeLabel(b.type)} · ${fmtMD(`${b.chargedOn}T00:00:00+09:00`)} · ${perHeadText} · ${card.done ? "마감" : "정산 미완"}`}
		>
			<div className="flex flex-col gap-4 px-5 pb-6">
				{/* ── ① 인원: 부과 대상이 낸 사람/미납으로 갈리는 과정 ── */}
				<Section title="인원 대조" hint="카드의 '수납 N/M' 이 나오는 곳">
					{/* 무효분이 있을 때만 뺄셈 사슬을 세운다 — 없으면 '전체 부과 = 부과 대상' 이라 한 줄이 낫다. */}
					{b.deadCount > 0 && (
						<>
							<Row label="전체 부과" value={`${b.head}건`} />
							<Row label="− 부과삭제·면제" value={`${b.deadCount}건`} tone="muted" indent sub="낼 돈에서 빠짐" />
							<Divider />
						</>
					)}
					<Row
						label="부과 대상"
						value={`${card.liveCount}명`}
						// 인당 금액은 시트 부제가 이미 말한다 — 총액이 있을 때만 덧붙인다.
						sub={card.total != null ? `엔빵 총액 ${card.total.toLocaleString("ko-KR")}원` : undefined}
						strong
					/>
					<Row label="└ 완납" value={`${card.paidCount}명`} tone="in" />
					{b.unpaidCount > 0 && <Row label="└ 미납" value={`${b.unpaidCount}명`} tone="warn" />}
				</Section>

				{/* ── ② 돈 ── */}
				<Section title="금액 대조" hint="이 묶음에 귀속된 돈 전부">
					{/* 절상해서 더 걷는 금액을 숨기지 않는다 — 통장에는 그만큼 더 들어온다. */}
					{card.total != null && (
						<Row label="엔빵 총액" value={won(card.total)} tone="muted" sub="나눈 원본 금액" />
					)}
					{roundUp !== 0 && (
						<Row label="절상 차액" value={signedWon(roundUp)} tone="muted" sub="인당 금액을 올려 걷는 만큼" />
					)}
					<Row
						label="낼 돈"
						value={won(b.dueSum)}
						sub={!b.mixedAmount && card.liveCount > 0 ? `${card.liveCount}건 × ${b.perHead.toLocaleString("ko-KR")}원` : undefined}
						strong
					/>
					{unpaidSum > 0 && <Row label="미납" value={won(unpaidSum)} tone="warn" indent sub={`${b.unpaidCount}명`} />}
					{deadSum > 0 && <Row label="부과삭제·면제" value={won(deadSum)} tone="muted" sub="낼 돈에 안 들어감" />}
					<Row label="받은 돈" value={`+${won(b.receivedSum)}`} tone="in" />
					{card.funded > 0 && (
						<Row label="묶음 직접 입금" value={`+${won(card.funded)}`} tone="in" sub="부과 없이 붙은 돈(모금 등)" />
					)}
					<Row
						label="지출"
						value={card.expense > 0 ? `−${won(card.expense)}` : "미연결"}
						tone={card.expense > 0 ? "out" : "warn"}
						sub={card.expense > 0 ? undefined : "정산함에서 출금 → 묶음 지정"}
					/>
					<Divider />
					<Row label="현재 순액" value={signedWon(net)} tone={net >= 0 ? "in" : "out"} strong />
					{/* '전원 완납 시'와 '클럽 부담'은 같은 숫자의 두 표현이라 한 줄로 합친다(부호만 다르게
					    두 줄로 놓으면 둘을 더해 두 배로 읽는다). 음수면 그 금액이 클럽이 메우는 돈이다. */}
					{(unpaidSum > 0 || clubShare > 0) && (
						<Row
							label="전원 완납 시"
							value={signedWon(expectedNet)}
							tone="muted"
							indent={unpaidSum > 0}
							sub={clubShare > 0 ? `클럽이 ${won(clubShare)} 부담` : undefined}
						/>
					)}
				</Section>

				{/* ── ③ 명단: 누가 냈는지. 미납이 위로 온다 ── */}
				<div>
					<button
						type="button"
						onClick={() => setRosterOpen((v) => !v)}
						aria-expanded={rosterOpen}
						className="flex w-full items-center gap-2"
						style={{ background: "none", border: "none", padding: "0 0 6px", cursor: "pointer", textAlign: "left" }}
					>
						<b className="text-strong" style={{ fontSize: 13.5, flexShrink: 0 }}>전체 명단 {roster.length}명</b>
						<span className="flex flex-wrap items-center justify-end" style={{ gap: "1px 7px", flex: 1, minWidth: 0, fontSize: 11.5 }}>
							{card.paidCount > 0 && <span className="text-[#1c8a3b]">완납 {card.paidCount}</span>}
							{b.unpaidCount > 0 && <span className="text-[#c2670a]" style={{ fontWeight: 700 }}>미납 {b.unpaidCount}</span>}
							{b.deadCount > 0 && <span className="text-faint">무효 {b.deadCount}</span>}
						</span>
						<span className="text-faint" style={{ fontSize: 10, fontWeight: 800, flexShrink: 0 }}>{rosterOpen ? "▲" : "▼"}</span>
					</button>
					{rosterOpen && (
						<div className="flex flex-col" style={{ gap: 2, background: "rgba(120,120,128,0.06)", borderRadius: 10, padding: "8px 10px" }}>
							{roster.map((r) => (
								<div key={r.memberId} className="flex items-center gap-2" style={{ fontSize: 13, padding: "2px 0" }}>
									<span
										className={r.dead ? "text-muted" : "text-strong"}
										style={{ fontWeight: 600, flex: 1, minWidth: 0, opacity: r.dead ? 0.55 : 1, textDecoration: r.dead ? "line-through" : undefined }}
									>
										{r.name}
										<BirthYearTag birthYear={r.birthYear} size={11} />
									</span>
									{/* 낸 금액이 부과액과 다를 때 얼마 들어왔는지 적는다(부분 납부·초과납).
									    무효·면제 행도 납부가 있으면 적는다 — '받은 돈'에는 들어 있어서
									    여기서 감추면 통장 대조가 그 금액만큼 설명 없이 어긋난다. */}
									{r.paid > 0 && (r.dead || r.paid !== r.due) && (
										<span className="text-faint" style={{ fontSize: 11, flexShrink: 0 }}>받음 {r.paid.toLocaleString("ko-KR")}</span>
									)}
									<span
										className="text-muted"
										style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0, opacity: r.dead ? 0.45 : 1, textDecoration: r.dead ? "line-through" : undefined }}
									>
										{r.due.toLocaleString("ko-KR")}
									</span>
									<span
										className={`rounded-[6px] ${statusChipClass(r.status)}`}
										style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 6px", flexShrink: 0, minWidth: 38, textAlign: "center" }}
									>
										{r.status === "partial" ? `${r.remain.toLocaleString("ko-KR")} 남음` : statusLabel(r.status)}
									</span>
								</div>
							))}
						</div>
					)}
				</div>

				{/* ── 조작: 명단·금액 수정으로 넘긴다 ── */}
				<div className="flex flex-col gap-1.5">
					<button
						type="button"
						onClick={onEdit}
						className="btn-tint-blue w-full rounded-[12px] py-3 text-sm"
					>
						명단·금액 수정
					</button>
					<p className="text-faint" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
						수정해도 <b>이미 낸 부과는 그대로 남습니다</b> — 명단에서 뺀 사람 중 미납인 건만 삭제되고, 금액도 미납분에만 새로 적용돼요.
					</p>
				</div>
			</div>
		</ModalSheet>
	);
}
