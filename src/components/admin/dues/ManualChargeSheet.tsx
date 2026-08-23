import { useMemo, useState } from "react";
import {
	type FilterContext,
	type FilterSelection,
	emptySelection,
	resolveSelection,
} from "../../../lib/dues/chargeFilters";
import { ROUND_UNITS, type RoundUnit, type SplitMode, diffHint, splitAmount } from "../../../lib/dues/splitAmount";
import { nameWithBirthYear } from "../../../lib/birthYear";
import { matchesQuery } from "../../../lib/playerSearch";
import {
	MANUAL_TYPES,
	type ManualBatch,
	type ManualChargeEntry,
	type ManualType,
	buildBatchKey,
	deleteManualBatch,
	parseBatchSessionId,
	manualTypeLabel,
	upsertManualBatch,
} from "../../../lib/supabase/manualCharges";
import { useDuesStore } from "../../../store/duesStore";
import { toast } from "../../../store/toastStore";
import ConfirmDialog from "../../common/ConfirmDialog";
import { inputCls, inputStyle, labelCls, labelStyle, selectStyle } from "../../common/fieldStyles";
import ModalSheet from "../../common/ModalSheet";
import PlayerAvatar from "../../shared/PlayerAvatar";
import ChargeFilterBar from "./ChargeFilterBar";
import { fmtMD, won } from "./duesText";
import { ToggleChip } from "./duesUi";

interface Props {
	ym: string;
	/** 편집할 기존 배치. null = 새로 만들기. */
	batch: ManualBatch | null;
	onClose: () => void;
	/**
	 * 저장·삭제 후. `deleted` 면 이 배치가 사라졌다는 뜻 — 호출부가 돌아갈 화면을 바꿀 수 있게 알려준다
	 * (대조 시트 → 수정 흐름에서 삭제하면 돌아갈 대조가 없다). 미납만 지우고 납부분이 남으면 배치는 산다.
	 */
	onSaved: (info?: { deleted?: boolean }) => void;
}

/**
 * 수동 부과 만들기·수정 시트.
 *
 * 대상을 고르는 방법(필터)은 전부 `lib/dues/chargeFilters` 레지스트리에 있고 이 화면은 그 결과만 쓴다.
 * 금액 산식도 `lib/dues/splitAmount` 로 분리 — 이 파일은 **입력을 모아 RPC 를 부르는 일**만 한다.
 *
 * 필터 결과에 손으로 더하고 뺀 것(added/removed)을 결과에 병합하지 않고 따로 들고 있는 이유:
 * 필터를 바꿔도 현장에서 확인한 예외가 살아남아야 한다(식사 체크를 안 했는데 온 사람 등).
 */
export default function ManualChargeSheet({ ym, batch, onClose, onSaved }: Props) {
	const members = useDuesStore((s) => s.members);
	const sessions = useDuesStore((s) => s.chargeSessions);
	const lastAttendedOn = useDuesStore((s) => s.lastAttendedOn);
	const batches = useDuesStore((s) => s.manualBatches);

	const editing = batch != null;

	// ── 기본 정보 ──────────────────────────────────────────────────
	const [type, setType] = useState<ManualType | string>(() => batch?.type ?? "meal");
	const [label, setLabel] = useState(() => batch?.label ?? "");
	const [labelTouched, setLabelTouched] = useState(() => editing);
	const [chargedOn, setChargedOn] = useState(
		() => batch?.chargedOn ?? new Date().toISOString().slice(0, 10),
	);
	// 회차는 '대상 후보의 재료'일 뿐 부과에 저장되지 않는다(요청: 일정에 엮지 않는다).
	// 다만 새 배치의 키·이름을 만들 때 회차를 쓰면 "한 정모에 회식 하나"가 자연히 보장된다.
	// 편집 모드에서는 batch_key('meal:228')가 그 회차의 유일한 흔적이라 거기서 복원한다 —
	// 안 하면 다시 열 때 "회차 없음"으로 보여 설정이 초기화된 것처럼 읽힌다.
	const [sessionId, setSessionId] = useState<number | null>(() =>
		batch ? parseBatchSessionId(batch.batchKey) : null,
	);

	// ── 대상 ───────────────────────────────────────────────────────
	const [selection, setSelection] = useState<FilterSelection>(() =>
		editing
			? // 편집은 저장된 명단이 진실이다 — 빈 시작 목록('직접 고르기')에 그 명단을 그대로 얹는다.
				{ ...emptySelection("none"), refineIds: [], added: new Set(batch.memberIds), removed: new Set() }
			: emptySelection(),
	);
	const [search, setSearch] = useState("");

	// ── 금액 ───────────────────────────────────────────────────────
	// 저장된 총액이 있으면 엔빵 모드로 열어 "총액 ÷ 인원" 맥락을 되살린다(없으면 인당 직접).
	const savedTotal = useDuesStore((s) =>
		batch ? (s.batches.find((b) => b.key === `manual:${batch.batchKey}`)?.totalAmount ?? null) : null,
	);
	const [mode, setMode] = useState<SplitMode>(() =>
		editing ? (savedTotal != null ? "total" : "perHead") : "total",
	);
	const [totalStr, setTotalStr] = useState(() => (savedTotal != null ? String(savedTotal) : ""));
	const [perHeadStr, setPerHeadStr] = useState(() => (batch ? String(batch.perHead) : ""));
	const [unit, setUnit] = useState<RoundUnit>(1000);

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);

	const session = useMemo(
		() => sessions.find((s) => s.id === sessionId) ?? null,
		[sessions, sessionId],
	);

	// 필터가 보는 값의 단일 입구. 스토어에서 여기로만 흘러 들어간다.
	const ctx: FilterContext = useMemo(
		() => ({
			members,
			session: session
				? {
						id: session.id,
						scheduledAt: session.scheduledAt,
						label: sessionText(session),
						isRegular: session.isRegular,
						mealEnabled: session.mealEnabled,
						attendances: session.attendances,
						boardMemberIds: session.boardMemberIds,
					}
				: null,
			lastAttendedOn,
			// 편집 중인 배치는 '지난 명단'에서 제외한다(자기 자신을 재사용 후보로 보여주면 헷갈린다).
			pastBatches: batches
				.filter((b) => b.batchKey !== batch?.batchKey)
				.map((b) => ({ batchKey: b.batchKey, label: `${b.label} (${b.head}명)`, memberIds: b.memberIds })),
			today: new Date().toISOString().slice(0, 10),
		}),
		[members, session, lastAttendedOn, batches, batch?.batchKey],
	);

	const selectedIds = useMemo(() => resolveSelection(selection, ctx), [selection, ctx]);
	const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
	// 회원별 납부 상태 — 편집 모드의 명단에서 **누가 냈는지** 바로 대조한다.
	// 카드의 `수납 12/17` 만으론 그 12명이 누구인지 알 수 없어서 운영진이 통장과 손으로 맞춰야 했다.
	const payByMember = useMemo(
		() => new Map((batch?.entries ?? []).map((e) => [e.memberId, e])),
		[batch],
	);
	// 낸 사람 수 = 살아 있는 부과 중 완납. 배치가 없으면(신규) 표시하지 않는다.
	const paidHead = batch
		? batch.entries.filter(
				(e) => e.status !== "void" && e.status !== "waived" && e.paid >= e.due,
			).length
		: 0;

	const split = splitAmount({
		mode,
		total: totalStr.trim() === "" ? null : Number(totalStr),
		perHead: perHeadStr.trim() === "" ? null : Number(perHeadStr),
		head: selectedIds.size,
		unit,
	});

	// 이름 자동 채움 — 직접 고친 적이 없을 때만(고친 뒤엔 건드리지 않는다).
	const autoLabel = useMemo(() => {
		const t = manualTypeLabel(type);
		if (session?.scheduledAt) return `${fmtMD(session.scheduledAt)} ${session.isRegular ? "정모 " : ""}${t}`;
		return `${Number(ym.slice(5))}월 ${t}`;
	}, [type, session, ym]);
	const effectiveLabel = labelTouched && label.trim() !== "" ? label.trim() : autoLabel;

	function pickSession(id: number | null) {
		setSessionId(id);
		const s = sessions.find((x) => x.id === id);
		// 회차를 고르면 발생일을 그 회차 날짜(KST)로 맞춘다 — 회식은 그날 저녁이다.
		if (s?.scheduledAt) setChargedOn(kstDate(s.scheduledAt));
	}

	function toggleMember(id: string) {
		const added = new Set(selection.added);
		const removed = new Set(selection.removed);
		if (selectedIds.has(id)) {
			added.delete(id);
			removed.add(id);
		} else {
			removed.delete(id);
			added.add(id);
		}
		setSelection({ ...selection, added, removed });
	}

	async function handleSave() {
		if (busy) return;
		if (selectedIds.size === 0) return setError("대상을 한 명 이상 고르세요.");
		if (split.perHead <= 0) return setError("금액을 입력하세요.");
		setBusy(true);
		setError(null);
		const key =
			batch?.batchKey ??
			buildBatchKey(type, { sessionId, date: chargedOn }, batches.map((b) => b.batchKey));
		const res = await upsertManualBatch({
			batchKey: key,
			label: effectiveLabel,
			chargedOn,
			amount: split.perHead,
			memberIds: [...selectedIds],
			// 엔빵 모드면 원본 총액을 남긴다 — 다시 열 때 "총액 ÷ 인원" 맥락이 살아난다.
			total: mode === "total" ? (totalStr.trim() === "" ? null : Number(totalStr)) : null,
		});
		setBusy(false);
		if (!res.ok) return setError(res.error);
		const { charged, removed, locked } = res.result;
		const parts = [`${charged}명 부과`];
		if (removed > 0) parts.push(`${removed}명 취소`);
		if (locked > 0) parts.push(`이미 낸 ${locked}명은 그대로 남았어요`);
		toast(parts.join(" · "), { variant: "success" });
		onSaved();
	}

	async function handleDelete() {
		if (!batch || busy) return;
		setBusy(true);
		const res = await deleteManualBatch(batch.batchKey);
		setBusy(false);
		setConfirmDelete(false);
		if (!res.ok) return setError(res.error);
		toast(
			res.keptPaid > 0
				? `${res.removed}건 삭제 · 이미 낸 ${res.keptPaid}건은 남겨뒀어요`
				: `${res.removed}건 삭제`,
			{ variant: "success" },
		);
		// 납부분이 남으면 배치는 살아 있다 — 그때는 삭제 신호를 보내지 않는다.
		onSaved({ deleted: res.keptPaid === 0 });
	}

	// 목록: 대상은 항상 보여주고, 검색어가 있으면 대상 아닌 사람도 후보로 보여준다(손으로 추가).
	const chosen = [...selectedIds]
		.map((id) => memberById.get(id))
		.filter((m): m is (typeof members)[number] => !!m)
		.filter((m) => matchesQuery(m.name, search))
		.sort((a, b) => a.name.localeCompare(b.name, "ko"));
	const candidates =
		search.trim() === ""
			? []
			: members
					.filter((m) => !selectedIds.has(m.id) && matchesQuery(m.name, search))
					.sort((a, b) => a.name.localeCompare(b.name, "ko"))
					.slice(0, 20);
	// 대상인데 회원 명단에서 사라진 id(삭제 회원 등) — 조용히 빼지 않고 수를 알려준다.
	const missingCount = selectedIds.size - [...selectedIds].filter((id) => memberById.has(id)).length;

	return (
		<>
			<ModalSheet
				position="bottom"
				onClose={onClose}
				closeOnEscape
				title={editing ? "수동 부과 수정" : "수동 부과 만들기"}
				subtitle={editing ? batch.label : "회식·공동구매처럼 일정과 무관하게 걷는 돈"}
			>
				<div className="flex flex-col gap-4 px-5 pb-6">
					{/* ── 종류·이름·날짜 ── */}
					<div>
						<span className={labelCls} style={labelStyle}>종류</span>
						<div className="flex flex-wrap gap-1.5">
							{MANUAL_TYPES.map((t) => (
								<ToggleChip
									key={t.id}
									label={t.label}
									on={type === t.id}
									title={t.hint}
									onClick={() => setType(t.id)}
								/>
							))}
						</div>
					</div>

					<div>
						<label className={labelCls} style={labelStyle} htmlFor="mc-label">이름</label>
						<input
							id="mc-label"
							type="text"
							value={labelTouched ? label : autoLabel}
							onChange={(e) => {
								setLabelTouched(true);
								setLabel(e.target.value);
							}}
							className={inputCls}
							style={inputStyle}
							placeholder={autoLabel}
						/>
						<p className="text-faint" style={{ fontSize: 11.5, marginTop: 4 }}>
							회원의 [내 회비]에 이 이름으로 뜹니다.
						</p>
					</div>

					<div className="flex gap-2">
						<div style={{ flex: 1, minWidth: 0 }}>
							<label className={labelCls} style={labelStyle} htmlFor="mc-date">발생일</label>
							<input
								id="mc-date"
								type="date"
								value={chargedOn}
								onChange={(e) => setChargedOn(e.target.value)}
								className={inputCls}
								style={{ ...inputStyle, width: "auto", maxWidth: "100%" }}
							/>
						</div>
						<div style={{ flex: 1, minWidth: 0 }}>
							<label className={labelCls} style={labelStyle} htmlFor="mc-session">참고 회차</label>
							<select
								id="mc-session"
								value={sessionId == null ? "" : String(sessionId)}
								onChange={(e) => pickSession(e.target.value === "" ? null : Number(e.target.value))}
								className={inputCls}
								style={{ ...selectStyle, fontSize: 13.5 }}
							>
								<option value="">회차 없음</option>
								{sessions.map((s) => (
									<option key={s.id} value={String(s.id)}>
										{sessionText(s)}
									</option>
								))}
							</select>
						</div>
					</div>

					{/* ── 대상 고르기 ── */}
					<div className="border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] pt-3.5">
						<ChargeFilterBar ctx={ctx} value={selection} onChange={setSelection} />
					</div>

					<div>
						<div className="flex items-center justify-between gap-2 mb-1.5">
							<span className="text-strong" style={{ fontSize: 13.5, fontWeight: 700 }}>
								대상 {selectedIds.size}명
								{batch && (
									<span className="text-faint" style={{ fontSize: 11.5, fontWeight: 600 }}>
										{" · "}낸 사람 {paidHead}
										{batch.unpaidCount > 0 ? ` · 미납 ${batch.unpaidCount}` : ""}
									</span>
								)}
							</span>
							{(selection.added.size > 0 || selection.removed.size > 0) && (
								<button
									type="button"
									onClick={() => setSelection({ ...selection, added: new Set(), removed: new Set() })}
									className="text-[#0b84ff]"
									style={{ fontSize: 12, fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}
								>
									손으로 고친 것 초기화 (+{selection.added.size}/−{selection.removed.size})
								</button>
							)}
						</div>
						<input
							type="search"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="이름·초성 검색 (검색하면 대상 아닌 사람도 추가할 수 있어요)"
							className={inputCls}
							style={{ ...inputStyle, fontSize: 13.5, padding: "9px 12px" }}
						/>
						{missingCount > 0 && (
							<p style={{ fontSize: 11.5, marginTop: 5, color: "#d1362c" }}>
								명단에 없는 회원 {missingCount}명이 대상에 있어요(삭제된 계정일 수 있음).
							</p>
						)}
						<div className="mt-1.5 overflow-y-auto no-sb" style={{ maxHeight: 260 }}>
							{chosen.map((m) => (
								<MemberRow
									key={m.id}
									m={m}
									on
									pay={payByMember.get(m.id)}
									onClick={() => toggleMember(m.id)}
								/>
							))}
							{candidates.length > 0 && (
								<>
									<div className="text-faint px-1 pt-2 pb-1" style={{ fontSize: 11.5, fontWeight: 700 }}>
										추가할 수 있는 사람
									</div>
									{candidates.map((m) => (
										<MemberRow key={m.id} m={m} on={false} onClick={() => toggleMember(m.id)} />
									))}
								</>
							)}
							{chosen.length === 0 && candidates.length === 0 && (
								<p className="text-faint" style={{ fontSize: 12.5, padding: "10px 2px" }}>
									{search.trim() === "" ? "대상이 없어요. 위 필터로 골라보세요." : "검색 결과가 없어요."}
								</p>
							)}
						</div>
					</div>

					{/* ── 금액 ── */}
					<div className="border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] pt-3.5">
						<div className="flex flex-wrap gap-1.5 mb-2">
							<ToggleChip label="총액 엔빵" on={mode === "total"} onClick={() => setMode("total")} />
							<ToggleChip label="인당 직접" on={mode === "perHead"} onClick={() => setMode("perHead")} />
						</div>
						{mode === "total" ? (
							<div className="flex gap-2">
								<div style={{ flex: 1, minWidth: 0 }}>
									<label className={labelCls} style={labelStyle} htmlFor="mc-total">총액</label>
									<input
										id="mc-total"
										type="number"
										inputMode="numeric"
										min={0}
										step={1000}
										value={totalStr}
										onChange={(e) => setTotalStr(e.target.value)}
										className={inputCls}
										style={inputStyle}
										placeholder="예: 442000"
									/>
								</div>
								<div style={{ width: 120 }}>
									<label className={labelCls} style={labelStyle} htmlFor="mc-unit">올림 단위</label>
									<select
										id="mc-unit"
										value={String(unit)}
										onChange={(e) => setUnit(Number(e.target.value) as RoundUnit)}
										className={inputCls}
										style={{ ...selectStyle, fontSize: 13.5 }}
									>
										{ROUND_UNITS.map((u) => (
											<option key={u} value={String(u)}>{u.toLocaleString("ko-KR")}원</option>
										))}
									</select>
								</div>
							</div>
						) : (
							<div>
								<label className={labelCls} style={labelStyle} htmlFor="mc-per">인당 금액</label>
								<input
									id="mc-per"
									type="number"
									inputMode="numeric"
									min={0}
									step={1000}
									value={perHeadStr}
									onChange={(e) => setPerHeadStr(e.target.value)}
									className={inputCls}
									style={inputStyle}
									placeholder="예: 26000"
								/>
							</div>
						)}

						{/* 결과 — 인당·부과합·차액을 항상 같이 보여준다(총무가 총액을 다시 세지 않게). */}
						<div
							className="bg-[rgba(0,0,0,0.03)] dark:bg-[rgba(255,255,255,0.05)] mt-2.5"
							style={{ borderRadius: 10, padding: "10px 12px" }}
						>
							<div className="flex items-baseline justify-between gap-2">
								<span className="text-muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
									인당 × {split.head}명
								</span>
								<span className="text-strong" style={{ fontSize: 15, fontWeight: 800 }}>
									{won(split.perHead)}
								</span>
							</div>
							<div className="flex items-baseline justify-between gap-2 mt-1">
								<span className="text-faint" style={{ fontSize: 12 }}>부과 합계</span>
								<span className="text-muted" style={{ fontSize: 12.5, fontWeight: 700 }}>
									{won(split.charged)}
									{diffHint(split.diff) && (
										<span style={{ color: split.diff > 0 ? "#1c8a3b" : "#d1362c", marginLeft: 6 }}>
											{diffHint(split.diff)}
										</span>
									)}
								</span>
							</div>
						</div>
					</div>

					{error && (
						<p style={{ fontSize: 13, fontWeight: 600, color: "#ef4444" }}>{error}</p>
					)}

					<button type="button" onClick={handleSave} disabled={busy} className="btn-solid-blue">
						{busy
							? "처리 중…"
							: `${selectedIds.size}명에게 ${won(split.perHead)} 부과${editing ? " (수정)" : ""}`}
					</button>
					{editing && (
						<button type="button" onClick={() => setConfirmDelete(true)} disabled={busy} className="btn-tint-red">
							이 부과 삭제
						</button>
					)}
				</div>
			</ModalSheet>

			{confirmDelete && batch && (
				<ConfirmDialog
					zIndex={70}
					title={`'${batch.label}' 부과를 삭제할까요?`}
					message={
						batch.receivedSum > 0
							? `미납분만 삭제됩니다. 이미 받은 ${won(batch.receivedSum)}에 붙은 부과는 남습니다(배분이 끊기면 통장 정산이 어긋나요).`
							: `${batch.head}명의 부과가 삭제됩니다. 회원의 미납 목록에서도 사라집니다.`
					}
					confirmLabel="삭제"
					cancelLabel="닫기"
					tone="danger"
					busy={busy}
					busyLabel="삭제 중…"
					onConfirm={handleDelete}
					onCancel={() => setConfirmDelete(false)}
					onDismiss={() => setConfirmDelete(false)}
				/>
			)}
		</>
	);
}

/** ISO → KST 'YYYY-MM-DD' (발생일 자동 채움용). */
function kstDate(iso: string): string {
	return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function sessionText(s: {
	scheduledAt: string | null;
	placeName: string | null;
	isRegular: boolean;
	title: string | null;
}): string {
	const d = s.scheduledAt ? fmtMD(s.scheduledAt) : (s.title ?? "회차");
	return `${d}${s.isRegular ? " 정모" : ""}${s.placeName ? ` · ${s.placeName}` : ""}`;
}

function MemberRow({
	m,
	on,
	pay,
	onClick,
}: {
	m: { id: string; name: string; birthYear: number | null; gender: "M" | "F" | null; isGuest: boolean; isAdmin: boolean };
	on: boolean;
	/** 이 배치에서 이 사람의 부과·납부 상태(편집 모드에서만 있다). */
	pay?: ManualChargeEntry;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="w-full flex items-center gap-2.5 px-1 py-1.5"
			style={{ background: "none", border: "none", textAlign: "left", cursor: "pointer", opacity: on ? 1 : 0.55 }}
		>
			<PlayerAvatar
				name={m.name}
				gender={m.gender}
				photoId={m.isGuest ? undefined : m.id}
				size={28}
			/>
			<span className="text-strong truncate min-w-0" style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>
				{nameWithBirthYear(m.name, m.birthYear)}
				{m.isGuest && <span className="text-faint" style={{ fontSize: 11.5 }}> · 게스트</span>}
				{m.isAdmin && <span className="text-faint" style={{ fontSize: 11.5 }}> · 운영진</span>}
			</span>
			{pay && <PayTag pay={pay} />}
			<span
				className={on ? "text-[#1c8a3b]" : "text-faint"}
				style={{ fontSize: 15, fontWeight: 800, flexShrink: 0, width: 20, textAlign: "center" }}
			>
				{on ? "✓" : "+"}
			</span>
		</button>
	);
}

/**
 * 납부 딱지 — 통장과 대조할 수 있게 **금액까지** 적는다.
 * "일부"는 실제로 있다(예: 6,000원 먼저 + 24,000원 잔금 → 그 사이엔 일부 상태).
 */
function PayTag({ pay }: { pay: ManualChargeEntry }) {
	const dead = pay.status === "void" || pay.status === "waived";
	const full = pay.paid >= pay.due;
	const label = dead
		? pay.status === "void"
			? "부과삭제"
			: "면제"
		: full
			? `완납 ${won(pay.paid)}`
			: pay.paid > 0
				? `일부 ${won(pay.paid)}`
				: "미납";
	const color = dead ? undefined : full ? "#1c8a3b" : pay.paid > 0 ? "#c2670a" : "#d1362c";
	return (
		<span
			className={color ? undefined : "text-faint"}
			style={{ fontSize: 11.5, fontWeight: 700, flexShrink: 0, color, textDecoration: dead ? "line-through" : undefined }}
		>
			{label}
		</span>
	);
}
