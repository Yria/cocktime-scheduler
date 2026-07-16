import { useState } from "react";
import type {
	OccurrencePatch,
	OneOffInput,
} from "../../lib/supabase/recurring";
import type { CreatePlaceInput } from "../../lib/supabase/schedule";
import type { PlaceRow, SessionRow } from "../../lib/supabase/types";
import {
	inputCls,
	inputStyle,
	labelCls,
	labelStyle,
	selectStyle,
} from "../common/fieldStyles";
import ModalSheet from "../common/ModalSheet";
import { Switch } from "../common/Switch";
import OccurrenceInfoView from "./OccurrenceInfoView";
import PlaceLocationPicker from "./PlaceLocationPicker";
import { statusStyle } from "./styles";
import { useOccurrenceForm } from "./useOccurrenceForm";

interface Props {
	occurrence: SessionRow | null; // null = 신규 일회성
	date: string | null; // YYYY-MM-DD (신규 일회성 대상일)
	places: PlaceRow[];
	placeName: (id: number | null) => string | null;
	onAddPlace: (input: CreatePlaceInput) => Promise<PlaceRow | null>;
	onOverride: (sessionId: number, patch: OccurrencePatch) => Promise<void>;
	onCreateOneOff: (input: OneOffInput) => Promise<void>;
	onDelete: (occurrence: SessionRow) => Promise<void>;
	onReopen: (occurrence: SessionRow) => Promise<void>;
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
	onDelete,
	onReopen,
	onClose,
}: Props) {
	const {
		isRuleBased,
		editable,
		occDate,
		time,
		setTime,
		endTime,
		setEndTime,
		carpoolEnabled,
		setCarpoolEnabled,
		capacity,
		setCapacity,
		placeId,
		setPlaceId,
		isRegular,
		setIsRegular,
		noticeMd,
		setNoticeMd,
		busy,
		error,
		handleCreate,
		handleOverride,
		handleDelete,
	} = useOccurrenceForm(occurrence, date, {
		onOverride,
		onCreateOneOff,
		onDelete,
	});

	const [showPicker, setShowPicker] = useState(false);

	// 헤더 제목/태그
	const title =
		occurrence == null
			? `일정 추가 · ${occDate ?? ""}`
			: `${occDate ?? ""} 회차`;

	const st = occurrence ? statusStyle(occurrence.status) : null;

	return (
		<>
		<ModalSheet
			position="bottom"
			onClose={onClose}
			// 위에 새 장소 picker 가 떠 있을 땐 Escape 가 최상단 시트만 닫히게 잠시 끈다
			closeOnEscape={!showPicker}
			title={title}
			subtitle={
				occurrence ? (
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
							className="text-muted"
							style={{ fontSize: 11.5, fontWeight: 600 }}
						>
							{isRuleBased ? "반복" : "일회성"}
						</span>
						{occurrence.status === "draft" && (
							<span
								className="text-faint"
								style={{ fontSize: 11.5, fontWeight: 600 }}
							>
								· 미노출
							</span>
						)}
					</div>
				) : undefined
			}
		>
			<div className="px-5 pb-5">
				{/* 본문 */}
				{occurrence && !editable ? (
					<OccurrenceInfoView
						occurrence={occurrence}
						occDate={occDate}
						time={time}
						endTime={endTime}
						placeName={placeName}
						error={error}
						onClose={onClose}
						onReopen={
							occurrence.status === "cancelled"
								? () => onReopen(occurrence)
								: undefined
						}
					/>
				) : (
					// 신규 일회성 또는 draft/open 편집 폼
					<div className="flex flex-col gap-4">
						{/* 시간 (시작 / 종료) — 네이티브 time 위젯이 width:100%를 무시하고 고유 폭(~180pt)으로 그려
						    2단에선 좁은 셀 밖으로 넘친다. 폭 의존성 없이 안전하게 전체폭 세로 스택. */}
						<div className="flex flex-col gap-3">
							<div>
								<label className={labelCls} style={labelStyle}>
									시작 시간
								</label>
								<input
									type="time"
									value={time}
									onChange={(e) => setTime(e.target.value)}
									disabled={busy}
									className={inputCls}
									style={{ ...inputStyle, width: "auto", maxWidth: "100%" }}
								/>
							</div>
							<div>
								<label className={labelCls} style={labelStyle}>
									종료 시간
								</label>
								<input
									type="time"
									value={endTime}
									onChange={(e) => setEndTime(e.target.value)}
									disabled={busy}
									className={inputCls}
									style={{ ...inputStyle, width: "auto", maxWidth: "100%" }}
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
									className="text-faint"
									style={{ fontSize: 11.5 }}
								>
									켜면 참석자가 카풀 가능/필요를 선택할 수 있어요
								</span>
							</div>
							<Switch
								checked={carpoolEnabled}
								onChange={setCarpoolEnabled}
								disabled={busy}
								ariaLabel="카풀"
							/>
						</div>

						{/* 정모 on/off + 안내(대진표) 본문 */}
						<div className="flex items-center justify-between">
							<div className="flex flex-col gap-0.5">
								<span
									className={labelCls}
									style={{ ...labelStyle, marginBottom: 0 }}
								>
									정모
								</span>
								<span
									className="text-faint"
									style={{ fontSize: 11.5 }}
								>
									켜면 회원이 일정에서 대진표·안내 페이지를 볼 수 있어요
								</span>
							</div>
							<Switch
								checked={isRegular}
								onChange={setIsRegular}
								disabled={busy}
								ariaLabel="정모"
							/>
						</div>

						{isRegular && (
							<div>
								<label className={labelCls} style={labelStyle}>
									안내 · 대진표 (마크다운)
								</label>
								<textarea
									value={noticeMd}
									onChange={(e) => setNoticeMd(e.target.value)}
									disabled={busy}
									rows={10}
									placeholder={
										"## 1라운드\n| 코트 | 경기 |\n|---|---|\n| 1 | 박현아·오상진 vs 심유진·심상욱 |\n| 2 | … |"
									}
									className={inputCls}
									style={{
										...inputStyle,
										height: "auto",
										minHeight: 180,
										resize: "vertical",
										fontFamily:
											'ui-monospace, "SF Mono", Menlo, monospace',
										fontSize: 13,
										lineHeight: 1.5,
										whiteSpace: "pre",
										overflowWrap: "normal",
									}}
								/>
								<p
									className="text-faint"
									style={{ fontSize: 11.5, marginTop: 4 }}
								>
									제목(##), 표(| … |), 굵게(**…**) 등 마크다운으로 매번 직접
									작성합니다. 비워두면 회원에겐 “준비 중”으로 보여요.
								</p>
							</div>
						)}

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
									style={{ ...selectStyle, flex: 1 }}
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
									className="btn-tint-blue rounded-[10px] px-4 py-0 text-sm bg-[rgba(11,132,255,0.12)] whitespace-nowrap"
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
							className="btn-solid-blue"
						>
							{busy ? "저장 중…" : occurrence ? "저장(변경)" : "저장"}
						</button>

						{occurrence && (
							<button
								type="button"
								onClick={handleDelete}
								disabled={busy}
								className="btn-tint-red"
							>
								삭제
							</button>
						)}
					</div>
				)}
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
