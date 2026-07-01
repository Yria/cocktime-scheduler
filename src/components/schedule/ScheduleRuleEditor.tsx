import { useMemo, useState } from "react";
import {
	ORDINAL_PRESETS,
	WEEKDAY_LABELS,
	formatTime,
} from "../../lib/schedule/recurrence";
import type { RecurringRuleInput } from "../../lib/supabase/recurring";
import type { CreatePlaceInput } from "../../lib/supabase/schedule";
import type { PlaceRow, RecurringScheduleRow } from "../../lib/supabase/types";
import { Switch } from "../common/Switch";
import PlaceLocationPicker from "./PlaceLocationPicker";
import {
	inputCls,
	inputStyle,
	labelCls,
	labelStyle,
	overlayStyle,
	primaryBtnStyle,
	selectStyle,
	sheetCls,
	sheetStyle,
} from "./styles";

interface Props {
	initial: RecurringScheduleRow | null; // null = 신규
	places: PlaceRow[];
	onAddPlace: (input: CreatePlaceInput) => Promise<PlaceRow | null>;
	onSubmit: (input: RecurringRuleInput) => Promise<void>;
	onClose: () => void;
}

/** 0=일 .. 6=토 → 주말(토/일) 여부. 카풀 기본값(주말 on) 판정용. */
function isWeekend(dow: number): boolean {
	return dow === 0 || dow === 6;
}

type PresetKey = "every" | "odd" | "even" | "custom";

const PRESET_CHIPS: { key: PresetKey; label: string }[] = [
	{ key: "every", label: "매주" },
	{ key: "odd", label: "홀수주" },
	{ key: "even", label: "짝수주" },
	{ key: "custom", label: "직접선택" },
];

/** 정렬된 ordinals 배열이 어떤 프리셋과 일치하는지 (마지막주 미포함 가정) */
function matchPreset(ordinals: number[], includeLast: boolean): PresetKey {
	if (includeLast) return "custom";
	const key = [...ordinals].sort((a, b) => a - b).join(",");
	if (key === ORDINAL_PRESETS.every.join(",")) return "every";
	if (key === ORDINAL_PRESETS.odd.join(",")) return "odd";
	if (key === ORDINAL_PRESETS.even.join(",")) return "even";
	return "custom";
}

export default function ScheduleRuleEditor({
	initial,
	places,
	onAddPlace,
	onSubmit,
	onClose,
}: Props) {
	const [dayOfWeek, setDayOfWeek] = useState<number>(
		initial ? initial.day_of_week : 3,
	);
	const [ordinals, setOrdinals] = useState<Set<number>>(
		() =>
			new Set<number>(
				initial ? initial.week_ordinals : [...ORDINAL_PRESETS.every],
			),
	);
	const [includeLast, setIncludeLast] = useState<boolean>(
		initial ? initial.include_last : false,
	);
	const [startTime, setStartTime] = useState<string>(
		initial ? formatTime(initial.start_time) : "19:00",
	);
	const [endTime, setEndTime] = useState<string>(
		initial?.end_time ? formatTime(initial.end_time) : "22:00",
	);
	const [carpoolEnabled, setCarpoolEnabled] = useState<boolean>(
		initial ? initial.carpool_enabled : isWeekend(dayOfWeek),
	);
	// 신규 규칙: 사용자가 직접 만지기 전까지는 선택 요일에 따라 카풀 기본값(주말 on) 자동 추종
	const [carpoolTouched, setCarpoolTouched] = useState(false);
	const [capacityStr, setCapacityStr] = useState<string>(
		initial?.capacity != null ? String(initial.capacity) : "",
	);
	const [placeId, setPlaceId] = useState<number | null>(
		initial ? initial.place_id : null,
	);

	// 새 장소: 지도 picker 모달
	const [showPicker, setShowPicker] = useState(false);

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const activePreset = useMemo(
		() => matchPreset([...ordinals], includeLast),
		[ordinals, includeLast],
	);

	const selectPreset = (key: PresetKey) => {
		setError(null);
		if (key === "custom") {
			// 직접선택: 현재 ordinals/includeLast 유지하고 편집 UI만 노출
			return;
		}
		setIncludeLast(false);
		setOrdinals(new Set(ORDINAL_PRESETS[key]));
	};

	const toggleOrdinal = (n: number) => {
		setError(null);
		setOrdinals((prev) => {
			const next = new Set(prev);
			if (next.has(n)) next.delete(n);
			else next.add(n);
			return next;
		});
	};

	const handleSubmit = async () => {
		if (busy) return;
		setError(null);
		const list = [...ordinals].sort((a, b) => a - b);
		if (!startTime || !endTime) {
			setError("시작·종료 시간을 입력하세요.");
			return;
		}
		if (startTime === endTime) {
			setError("종료 시간이 시작 시간과 같아요.");
			return;
		}
		if (list.length === 0 && !includeLast) {
			setError("주차를 선택하세요.");
			return;
		}
		setBusy(true);
		try {
			await onSubmit({
				dayOfWeek,
				weekOrdinals: list,
				includeLast,
				startTime,
				endTime,
				carpoolEnabled,
				capacity: capacityStr.trim() === "" ? null : Number(capacityStr),
				placeId,
			});
		} catch {
			setError("저장에 실패했어요. 다시 시도해 주세요.");
			setBusy(false);
		}
	};

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
				<div className="flex items-center justify-between mb-4">
					<h2
						className="text-[#0f1724] dark:text-white"
						style={{ fontSize: 18, fontWeight: 800 }}
					>
						{initial ? "규칙 수정" : "반복 규칙 추가"}
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
						style={{
							background: "none",
							border: "none",
							fontSize: 14,
							fontWeight: 600,
							cursor: "pointer",
						}}
					>
						취소
					</button>
				</div>

				<div className="flex flex-col gap-4">
					{/* 요일 */}
					<div>
						<span className={labelCls} style={labelStyle}>
							요일
						</span>
						<div className="flex gap-1.5">
							{[1, 2, 3, 4, 5, 6, 0].map((dow) => {
								const label = WEEKDAY_LABELS[dow];
								const active = dow === dayOfWeek;
								return (
									<button
										key={label}
										type="button"
										onClick={() => {
											setError(null);
											setDayOfWeek(dow);
											// 신규 + 미수정이면 카풀 기본값을 선택 요일에 맞춤(주말 on)
											if (!initial && !carpoolTouched)
												setCarpoolEnabled(isWeekend(dow));
										}}
										style={{
											flex: 1,
											padding: "9px 0",
											borderRadius: 9,
											fontSize: 14,
											fontWeight: 700,
											border: "none",
											cursor: "pointer",
											color: active ? "#fff" : "#64748b",
											background: active ? "#0b84ff" : "rgba(100,116,139,0.12)",
										}}
									>
										{label}
									</button>
								);
							})}
						</div>
					</div>

					{/* 주차 */}
					<div>
						<span className={labelCls} style={labelStyle}>
							주차
						</span>
						<div className="flex gap-1.5">
							{PRESET_CHIPS.map(({ key, label }) => {
								const active = activePreset === key;
								return (
									<button
										key={key}
										type="button"
										onClick={() => selectPreset(key)}
										style={{
											flex: 1,
											padding: "9px 0",
											borderRadius: 9,
											fontSize: 13,
											fontWeight: 700,
											border: "none",
											cursor: "pointer",
											color: active ? "#fff" : "#64748b",
											background: active ? "#0b84ff" : "rgba(100,116,139,0.12)",
										}}
									>
										{label}
									</button>
								);
							})}
						</div>

						{/* 직접선택: 1~5주 체크박스 + 마지막주 토글 */}
						{activePreset === "custom" && (
							<div className="flex flex-col gap-2 mt-2.5">
								<div className="flex gap-1.5">
									{[1, 2, 3, 4, 5].map((n) => {
										const active = ordinals.has(n);
										return (
											<button
												key={n}
												type="button"
												onClick={() => toggleOrdinal(n)}
												style={{
													flex: 1,
													padding: "9px 0",
													borderRadius: 9,
													fontSize: 13.5,
													fontWeight: 700,
													border: active
														? "1px solid #0b84ff"
														: "1px solid rgba(0,0,0,0.12)",
													cursor: "pointer",
													color: active ? "#0b84ff" : "#64748b",
													background: active
														? "rgba(11,132,255,0.12)"
														: "transparent",
												}}
											>
												{active ? "✓ " : ""}
												{n}주
											</button>
										);
									})}
								</div>
								<button
									type="button"
									onClick={() => {
										setError(null);
										setIncludeLast((v) => !v);
									}}
									style={{
										alignSelf: "flex-start",
										padding: "7px 13px",
										borderRadius: 9,
										fontSize: 13,
										fontWeight: 700,
										border: includeLast
											? "1px solid #0b84ff"
											: "1px solid rgba(0,0,0,0.12)",
										cursor: "pointer",
										color: includeLast ? "#0b84ff" : "#64748b",
										background: includeLast
											? "rgba(11,132,255,0.12)"
											: "transparent",
									}}
								>
									{includeLast ? "✓ " : ""}마지막주
								</button>
							</div>
						)}
					</div>

					{/* 시간 (시작 ~ 종료) — 래퍼·input(inputStyle) 모두 minWidth:0:
					    네이티브 time 위젯(iOS Safari 등)의 intrinsic 폭이 모달 밖으로 밀지 못하게 */}
					<div className="flex gap-3">
						<div style={{ flex: 1, minWidth: 0 }}>
							<span className={labelCls} style={labelStyle}>
								시작 시간
							</span>
							<input
								type="time"
								value={startTime}
								onChange={(e) => {
									setError(null);
									setStartTime(e.target.value);
								}}
								className={inputCls}
								style={inputStyle}
							/>
						</div>
						<div style={{ flex: 1, minWidth: 0 }}>
							<span className={labelCls} style={labelStyle}>
								종료 시간
							</span>
							<input
								type="time"
								value={endTime}
								onChange={(e) => {
									setError(null);
									setEndTime(e.target.value);
								}}
								className={inputCls}
								style={inputStyle}
							/>
						</div>
					</div>

					{/* 카풀 on/off */}
					<div className="flex items-center justify-between">
						<div className="flex flex-col gap-0.5">
							<span className={labelCls} style={{ ...labelStyle, marginBottom: 0 }}>
								카풀
							</span>
							<span
								className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
								style={{ fontSize: 11.5 }}
							>
								켜면 참석자가 카풀 가능/필요를 선택할 수 있어요
							</span>
						</div>
						<Switch
							checked={carpoolEnabled}
							onChange={(v) => {
								setError(null);
								setCarpoolTouched(true);
								setCarpoolEnabled(v);
							}}
							ariaLabel="카풀"
						/>
					</div>

					{/* 최대인원 */}
					<div>
						<span className={labelCls} style={labelStyle}>
							최대인원
						</span>
						<input
							type="number"
							inputMode="numeric"
							min={1}
							placeholder="무제한"
							value={capacityStr}
							onChange={(e) => setCapacityStr(e.target.value)}
							className={inputCls}
							style={inputStyle}
						/>
					</div>

					{/* 장소 */}
					<div>
						<span className={labelCls} style={labelStyle}>
							장소
						</span>
						<div className="flex gap-2">
							<select
								value={placeId == null ? "" : String(placeId)}
								onChange={(e) => {
									setError(null);
									setPlaceId(
										e.target.value === "" ? null : Number(e.target.value),
									);
								}}
								className={inputCls}
								style={{ ...selectStyle, flex: 1 }}
							>
								<option value="">장소 선택 안 함</option>
								{places.map((p) => (
									<option key={p.id} value={String(p.id)}>
										{p.name}
									</option>
								))}
							</select>
							<button
								type="button"
								onClick={() => {
									setError(null);
									setShowPicker(true);
								}}
								style={{
									padding: "0 16px",
									borderRadius: 10,
									fontSize: 14,
									fontWeight: 700,
									color: "#0b84ff",
									background: "rgba(11,132,255,0.12)",
									border: "none",
									cursor: "pointer",
									whiteSpace: "nowrap",
								}}
							>
								새 장소
							</button>
						</div>
					</div>

					{error && (
						<p style={{ fontSize: 13, fontWeight: 600, color: "#ef4444" }}>
							{error}
						</p>
					)}

					{/* 저장 */}
					<button
						type="button"
						onClick={handleSubmit}
						disabled={busy}
						style={primaryBtnStyle(busy)}
					>
						{busy ? "저장 중…" : "저장"}
					</button>
				</div>
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
