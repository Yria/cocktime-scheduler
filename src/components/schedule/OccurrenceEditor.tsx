import { useMemo, useState } from "react";
import {
	dateStrDow,
	isoToDateKST,
	isoToTimeKST,
	kstEndWallClockToISO,
	kstWallClockToISO,
	todayKST,
} from "../../lib/schedule/calendar";
import type {
	OccurrencePatch,
	OneOffInput,
} from "../../lib/supabase/recurring";
import type { CreatePlaceInput } from "../../lib/supabase/schedule";
import type { PlaceRow, SessionRow } from "../../lib/supabase/types";
import PlaceLocationPicker from "./PlaceLocationPicker";
import {
	inputCls,
	inputStyle,
	labelCls,
	labelStyle,
	overlayStyle,
	primaryBtnStyle,
	sheetCls,
	sheetStyle,
	statusStyle,
} from "./styles";

interface Props {
	occurrence: SessionRow | null; // null = 신규 일회성
	date: string | null; // YYYY-MM-DD (신규 일회성 대상일)
	places: PlaceRow[];
	placeName: (id: number | null) => string | null;
	onAddPlace: (input: CreatePlaceInput) => Promise<PlaceRow | null>;
	onOverride: (sessionId: number, patch: OccurrencePatch) => Promise<void>;
	onCreateOneOff: (input: OneOffInput) => Promise<void>;
	onSkip: (sessionId: number) => Promise<void>;
	onRestore: (sessionId: number, isRuleBased: boolean) => Promise<void>;
	onDelete: (sessionId: number) => Promise<void>;
	onClose: () => void;
}

export default function OccurrenceEditor({
	occurrence,
	date,
	places,
	placeName,
	onAddPlace,
	onOverride,
	onCreateOneOff,
	onSkip,
	onRestore,
	onDelete,
	onClose,
}: Props) {
	const isRuleBased = occurrence?.recurring_schedule_id != null;
	const status = occurrence?.status ?? null;

	// 대상 날짜: 기존 회차면 scheduled_at(KST), 아니면 신규 대상일
	const occDate = useMemo(() => {
		if (occurrence?.scheduled_at) return isoToDateKST(occurrence.scheduled_at);
		return date;
	}, [occurrence, date]);

	// 폼 상태 prefill
	const [time, setTime] = useState<string>(() => {
		if (occurrence?.scheduled_at) return isoToTimeKST(occurrence.scheduled_at);
		return "19:00";
	});
	const [endTime, setEndTime] = useState<string>(() => {
		if (occurrence?.ends_at) return isoToTimeKST(occurrence.ends_at);
		return "22:00";
	});
	const [carpoolEnabled, setCarpoolEnabled] = useState<boolean>(() => {
		if (occurrence) return occurrence.carpool_enabled;
		// 신규 일회성: 대상일이 주말(토/일)이면 카풀 기본 on
		const dow = occDate ? dateStrDow(occDate) : -1;
		return dow === 0 || dow === 6;
	});
	const [capacity, setCapacity] = useState<string>(() =>
		occurrence?.capacity != null ? String(occurrence.capacity) : "",
	);
	const [placeId, setPlaceId] = useState<number | null>(
		occurrence?.place_id ?? null,
	);
	const [showPicker, setShowPicker] = useState(false);

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// 편집 가능 여부 (draft/open 만 편집)
	const editable =
		occurrence == null || status === "draft" || status === "open";

	// 지난 날짜(KST) 회차: 되돌려도 sync 가 곧바로 종료시키므로 되돌리기 비노출
	const isPast = occDate != null && occDate < todayKST();

	function parseCapacity(): number | null {
		const v = capacity.trim();
		return v ? Number(v) : null;
	}

	async function run(fn: () => Promise<void>) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await fn();
		} catch (e) {
			setError(e instanceof Error ? e.message : "처리에 실패했어요.");
			setBusy(false);
		}
	}

	function validTimes(): boolean {
		if (!time || !endTime) {
			setError("시작·종료 시간을 입력하세요.");
			return false;
		}
		if (time === endTime) {
			setError("종료 시간이 시작 시간과 같아요.");
			return false;
		}
		return true;
	}

	// 저장: 신규 일회성 생성
	function handleCreate() {
		if (!occDate) {
			setError("대상 날짜가 없어요.");
			return;
		}
		if (!validTimes()) return;
		void run(async () => {
			await onCreateOneOff({
				scheduledAt: kstWallClockToISO(occDate, time),
				endsAt: kstEndWallClockToISO(occDate, time, endTime),
				carpoolEnabled,
				occurrenceDate: occDate,
				placeId,
				capacity: parseCapacity(),
			});
		});
	}

	// 저장: 기존 회차 수정
	function handleOverride() {
		if (!occurrence || !occDate) return;
		if (!validTimes()) return;
		void run(async () => {
			await onOverride(occurrence.id, {
				scheduledAt: kstWallClockToISO(occDate, time),
				endsAt: kstEndWallClockToISO(occDate, time, endTime),
				carpoolEnabled,
				placeId,
				capacity: parseCapacity(),
			});
		});
	}

	function handleSkip() {
		if (!occurrence) return;
		if (!confirm("이 회차를 취소할까요? (참석자에게 노출되지 않아요)")) return;
		void run(async () => {
			await onSkip(occurrence.id);
		});
	}

	function handleRestore() {
		if (!occurrence) return;
		void run(async () => {
			await onRestore(occurrence.id, isRuleBased);
		});
	}

	function handleDelete() {
		if (!occurrence) return;
		if (!confirm("이 회차를 완전히 삭제할까요? 되돌릴 수 없어요.")) return;
		void run(async () => {
			await onDelete(occurrence.id);
		});
	}

	// 헤더 제목/태그
	const title =
		occurrence == null
			? `일정 추가 · ${occDate ?? ""}`
			: `${occDate ?? ""} 회차`;

	const st = occurrence ? statusStyle(occurrence.status) : null;

	return (
		<>
		<div
			style={overlayStyle}
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div
				className={sheetCls}
				style={sheetStyle}
				onClick={(e) => e.stopPropagation()}
			>
				{/* 헤더 */}
				<div className="flex items-start justify-between gap-2 mb-4">
					<div className="flex flex-col gap-1.5 min-w-0">
						<h2
							className="text-[#0f1724] dark:text-white"
							style={{ fontSize: 17, fontWeight: 800 }}
						>
							{title}
						</h2>
						{occurrence && (
							<div className="flex items-center gap-1.5 flex-wrap">
								{st && (
									<span
										style={{
											fontSize: 11,
											fontWeight: 700,
											color: st.color,
											background: st.bg,
											padding: "2px 8px",
											borderRadius: 6,
										}}
									>
										{st.label}
									</span>
								)}
								<span
									className="text-[#64748b] dark:text-[rgba(235,235,245,0.55)]"
									style={{ fontSize: 11.5, fontWeight: 600 }}
								>
									{isRuleBased ? "반복" : "일회성"}
								</span>
								{occurrence.status === "draft" && (
									<span
										className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
										style={{ fontSize: 11.5, fontWeight: 600 }}
									>
										· 미노출
									</span>
								)}
							</div>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
						style={{
							background: "none",
							border: "none",
							fontSize: 22,
							lineHeight: 1,
							cursor: "pointer",
							padding: "0 2px",
						}}
						aria-label="닫기"
					>
						×
					</button>
				</div>

				{/* 본문 */}
				{occurrence && status === "cancelled" ? (
					// 취소된 회차: 되돌리기 (+ 일회성이면 삭제)
					<div className="flex flex-col gap-3">
						<p
							className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
							style={{ fontSize: 14 }}
						>
							취소된 회차입니다.
							{isPast ? " 지난 날짜라 되돌릴 수 없어요." : ""}
						</p>
						{!isPast && (
							<button
								type="button"
								onClick={handleRestore}
								disabled={busy}
								style={primaryBtnStyle(busy)}
							>
								{busy ? "처리 중…" : "되돌리기"}
							</button>
						)}
						{!isRuleBased && (
							<button
								type="button"
								onClick={handleDelete}
								disabled={busy}
								style={dangerBtnStyle(busy)}
							>
								삭제
							</button>
						)}
						{isPast && (
							<button type="button" onClick={onClose} style={neutralBtnStyle()}>
								닫기
							</button>
						)}
						{error && (
							<p style={{ fontSize: 13, fontWeight: 600, color: "#ef4444" }}>
								{error}
							</p>
						)}
					</div>
				) : occurrence && !editable ? (
					// active/closed: 편집 불가, 정보만
					<div className="flex flex-col gap-3">
						<dl className="flex flex-col gap-2">
							<InfoRow
								label="시간"
								value={`${occDate ?? ""} ${time}~${endTime}`}
							/>
							<InfoRow
								label="장소"
								value={placeName(occurrence.place_id) ?? "장소 미정"}
							/>
							<InfoRow
								label="정원"
								value={
									occurrence.capacity != null
										? `${occurrence.capacity}명`
										: "무제한"
								}
							/>
							<InfoRow
								label="카풀"
								value={occurrence.carpool_enabled ? "사용" : "사용 안 함"}
							/>
						</dl>
						<p
							className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
							style={{ fontSize: 12.5 }}
						>
							진행 중이거나 종료된 회차는 수정할 수 없어요.
						</p>
						<button
							type="button"
							onClick={onClose}
							style={neutralBtnStyle()}
						>
							닫기
						</button>
						{error && (
							<p style={{ fontSize: 13, fontWeight: 600, color: "#ef4444" }}>
								{error}
							</p>
						)}
					</div>
				) : (
					// 신규 일회성 또는 draft/open 편집 폼
					<div className="flex flex-col gap-4">
						{/* 시간 (시작 ~ 종료) */}
						<div className="flex gap-3">
							<div style={{ flex: 1 }}>
								<label className={labelCls} style={labelStyle}>
									시작 시간
								</label>
								<input
									type="time"
									value={time}
									onChange={(e) => setTime(e.target.value)}
									disabled={busy}
									className={inputCls}
									style={inputStyle}
								/>
							</div>
							<div style={{ flex: 1 }}>
								<label className={labelCls} style={labelStyle}>
									종료 시간
								</label>
								<input
									type="time"
									value={endTime}
									onChange={(e) => setEndTime(e.target.value)}
									disabled={busy}
									className={inputCls}
									style={inputStyle}
								/>
							</div>
						</div>

						{/* 카풀 on/off */}
						<div className="flex items-center justify-between">
							<div className="flex flex-col gap-0.5">
								<span
									className={labelCls}
									style={{ ...labelStyle, marginBottom: 0 }}
								>
									카풀
								</span>
								<span
									className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
									style={{ fontSize: 11.5 }}
								>
									켜면 참석자가 카풀 가능/필요를 선택할 수 있어요
								</span>
							</div>
							<button
								type="button"
								onClick={() => setCarpoolEnabled((v) => !v)}
								disabled={busy}
								aria-pressed={carpoolEnabled}
								style={{
									padding: "7px 16px",
									borderRadius: 9,
									fontSize: 13,
									fontWeight: 700,
									border: "none",
									cursor: busy ? "not-allowed" : "pointer",
									color: carpoolEnabled ? "#fff" : "#64748b",
									background: carpoolEnabled
										? "#2c7a57"
										: "rgba(100,116,139,0.14)",
								}}
							>
								{carpoolEnabled ? "ON" : "OFF"}
							</button>
						</div>

						{/* 인원 */}
						<div>
							<label className={labelCls} style={labelStyle}>
								정원
							</label>
							<input
								type="number"
								min={1}
								inputMode="numeric"
								value={capacity}
								onChange={(e) => setCapacity(e.target.value)}
								disabled={busy}
								placeholder="무제한"
								className={inputCls}
								style={inputStyle}
							/>
						</div>

						{/* 장소 */}
						<div>
							<label className={labelCls} style={labelStyle}>
								장소
							</label>
							<div className="flex gap-2">
								<select
									value={placeId == null ? "" : String(placeId)}
									onChange={(e) =>
										setPlaceId(
											e.target.value === "" ? null : Number(e.target.value),
										)
									}
									disabled={busy}
									className={inputCls}
									style={{ ...inputStyle, flex: 1 }}
								>
									<option value="">장소 미정</option>
									{places.map((p) => (
										<option key={p.id} value={String(p.id)}>
											{p.name}
										</option>
									))}
								</select>
								<button
									type="button"
									onClick={() => setShowPicker(true)}
									disabled={busy}
									style={{
										padding: "0 16px",
										borderRadius: 10,
										fontSize: 14,
										fontWeight: 700,
										color: "#0b84ff",
										background: "rgba(11,132,255,0.12)",
										border: "none",
										cursor: busy ? "not-allowed" : "pointer",
										whiteSpace: "nowrap",
									}}
								>
									새 장소
								</button>
							</div>
						</div>

						{error && (
							<p
								style={{ fontSize: 13, fontWeight: 600, color: "#ef4444" }}
							>
								{error}
							</p>
						)}

						{/* 액션 */}
						<button
							type="button"
							onClick={occurrence ? handleOverride : handleCreate}
							disabled={busy}
							style={primaryBtnStyle(busy)}
						>
							{busy ? "저장 중…" : occurrence ? "저장(변경)" : "저장"}
						</button>

						{occurrence && (
							<>
								<button
									type="button"
									onClick={handleSkip}
									disabled={busy}
									style={dangerBtnStyle(busy)}
								>
									이 회차 취소
								</button>
								{!isRuleBased && (
									<button
										type="button"
										onClick={handleDelete}
										disabled={busy}
										style={neutralBtnStyle()}
									>
										삭제
									</button>
								)}
							</>
						)}
					</div>
				)}
			</div>
		</div>
		{showPicker && (
			<PlaceLocationPicker
				onAddPlace={onAddPlace}
				onCreated={(p) => {
					setPlaceId(p.id);
					setShowPicker(false);
				}}
				onClose={() => setShowPicker(false)}
			/>
		)}
		</>
	);
}

function InfoRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-3">
			<dt
				className="text-[#64748b] dark:text-[rgba(235,235,245,0.6)]"
				style={{ fontSize: 13, fontWeight: 600 }}
			>
				{label}
			</dt>
			<dd
				className="text-[#0f1724] dark:text-white text-right"
				style={{ fontSize: 14, fontWeight: 600 }}
			>
				{value}
			</dd>
		</div>
	);
}

function dangerBtnStyle(busy: boolean): React.CSSProperties {
	return {
		width: "100%",
		padding: "13px",
		borderRadius: 12,
		fontSize: 15,
		fontWeight: 700,
		color: "#ef4444",
		background: "rgba(239,68,68,0.1)",
		border: "none",
		cursor: busy ? "not-allowed" : "pointer",
		opacity: busy ? 0.6 : 1,
	};
}

function neutralBtnStyle(): React.CSSProperties {
	return {
		width: "100%",
		padding: "13px",
		borderRadius: 12,
		fontSize: 15,
		fontWeight: 700,
		color: "#64748b",
		background: "rgba(100,116,139,0.1)",
		border: "none",
		cursor: "pointer",
	};
}
