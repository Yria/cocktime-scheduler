import { useMemo, useState } from "react";
import { ORDINAL_PRESETS, formatTime } from "../../lib/schedule/recurrence";
import type { RecurringRuleInput } from "../../lib/supabase/recurring";
import type { CreatePlaceInput } from "../../lib/supabase/schedule";
import type { PlaceRow, RecurringScheduleRow } from "../../lib/supabase/types";
import {
	inputCls,
	inputStyle,
	labelCls,
	labelStyle,
	selectStyle,
} from "../common/fieldStyles";
import ModalSheet from "../common/ModalSheet";
import { Switch } from "../common/Switch";
import PlaceLocationPicker from "./PlaceLocationPicker";
import { WeekOrdinalField } from "./WeekOrdinalField";
import { WeekdayField } from "./WeekdayField";
import { isWeekend, matchPreset } from "./ruleEditorPresets";
import type { PresetKey } from "./ruleEditorPresets";

interface Props {
	initial: RecurringScheduleRow | null; // null = 신규
	places: PlaceRow[];
	onAddPlace: (input: CreatePlaceInput) => Promise<PlaceRow | null>;
	onSubmit: (input: RecurringRuleInput) => Promise<void>;
	onClose: () => void;
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
		<ModalSheet
			position="bottom"
			onClose={onClose}
			// 위에 새 장소 picker 가 떠 있을 땐 Escape 가 최상단 시트만 닫히게 잠시 끈다
			closeOnEscape={!showPicker}
			title={initial ? "규칙 수정" : "반복 규칙 추가"}
		>
			<div className="px-5 pb-5">
				<div className="flex flex-col gap-4">
					{/* 요일 */}
					<WeekdayField
						dayOfWeek={dayOfWeek}
						onSelect={(dow) => {
							setError(null);
							setDayOfWeek(dow);
							// 신규 + 미수정이면 카풀 기본값을 선택 요일에 맞춤(주말 on)
							if (!initial && !carpoolTouched)
								setCarpoolEnabled(isWeekend(dow));
						}}
					/>

					{/* 주차 */}
					<WeekOrdinalField
						activePreset={activePreset}
						ordinals={ordinals}
						includeLast={includeLast}
						onSelectPreset={selectPreset}
						onToggleOrdinal={toggleOrdinal}
						onToggleLast={() => {
							setError(null);
							setIncludeLast((v) => !v);
						}}
					/>

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
								className="text-faint"
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
								className="btn-tint-blue rounded-[10px] px-4 py-0 text-sm bg-[rgba(11,132,255,0.12)] whitespace-nowrap"
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
						className="btn-solid-blue"
					>
						{busy ? "저장 중…" : "저장"}
					</button>
				</div>
			</div>
		</ModalSheet>
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
