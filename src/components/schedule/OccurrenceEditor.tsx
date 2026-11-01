import { useState } from "react";
import {
	courtFeeChargeHint,
	courtFeeResetLines,
	parseCourtFee,
} from "../../lib/schedule/courtFee";
import type {
	OccurrencePatch,
	OneOffInput,
	OccurrenceEditResult,
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
import KakaoLocationSearch from "../common/KakaoLocationSearch";
import ConfirmDialog from "../common/ConfirmDialog";
import ModalSheet from "../common/ModalSheet";
import { Switch } from "../common/Switch";
import OccurrenceInfoView from "./OccurrenceInfoView";
import OccurrenceParticipants from "./OccurrenceParticipants";
import PlaceLocationPicker from "./PlaceLocationPicker";
import { statusStyle } from "./styles";
import { useOccurrenceForm } from "./useOccurrenceForm";

interface Props {
	occurrence: SessionRow | null; // null = 신규 일회성
	date: string | null; // YYYY-MM-DD (신규 일회성 대상일)
	places: PlaceRow[];
	placeName: (id: number | null) => string | null;
	onAddPlace: (input: CreatePlaceInput) => Promise<PlaceRow | null>;
	onCreateOneOff: (input: OneOffInput) => Promise<void>;
	onDelete: (occurrence: SessionRow) => Promise<void>;
	onReopen: (occurrence: SessionRow) => Promise<void>;
	/** 기존 회차 저장. 총액·대관장소 여부가 바뀌면 서버가 발행분을 취소 후 재발행한다. */
	onEdit: (sessionId: number, patch: OccurrencePatch) => Promise<void>;
	onPreviewEdit: (
		sessionId: number,
		patch: OccurrencePatch,
	) => Promise<OccurrenceEditResult>;
	onClose: () => void;
}

export default function OccurrenceEditor({
	occurrence,
	date,
	places,
	placeName,
	onAddPlace,
	onCreateOneOff,
	onDelete,
	onReopen,
	onEdit,
	onPreviewEdit,
	onClose,
}: Props) {
	const {
		isRuleBased,
		editable,
		started,
		chargePreview,
		dismissChargePreview,
		confirmChargeEdit,
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
		courtFeeStr,
		setCourtFeeStr,
		isRegular,
		setIsRegular,
		noticeMd,
		setNoticeMd,
		mealEnabled,
		setMealEnabled,
		mealPlace,
		changeMealPlaceText,
		pickMealPlace,
		mealCoords,
		busy,
		error,
		handleCreate,
		handleOverride,
		handleDelete,
	} = useOccurrenceForm(occurrence, date, {
		onCreateOneOff,
		onDelete,
		onEdit,
		onPreviewEdit,
	});

	const [showPicker, setShowPicker] = useState(false);

	// 선택한 장소가 대관장소면 코트 총액(엔빵) 입력 노출
	const placeChargesCourt =
		places.find((p) => p.id === placeId)?.charges_court_fee ?? false;

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
			// 확인창이 떠 있을 때도 마찬가지(Esc 한 번에 시트까지 닫혀 입력이 사라지지 않게)
			closeOnEscape={!showPicker && !chargePreview}
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
				{/* 참가자 요약 — 기존 회차에만. 종료된 지난 회차도 여기서 참가자·카풀/식사 신청을 본다
				    (메인 일정 카드와 같은 참여목록 모달을 시트 위에 겹쳐 띄운다). */}
				{occurrence && (
					<div className="mb-4">
						<OccurrenceParticipants
							occurrence={occurrence}
							placeName={placeName(occurrence.place_id)}
						/>
					</div>
				)}

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
						onReopen={() => onReopen(occurrence)}
					/>
				) : (
					// 신규 일회성 또는 기존 회차 편집 폼(취소 회차 제외)
					<div className="flex flex-col gap-4">
						{/* 진행·종료 회차: 날짜는 고정(부과 월·당일취소 판정이 날짜에 걸림), 부과에 닿는 변경은 확인 후 재발행 */}
						{started && (
							<p
								className="text-muted"
								style={{ fontSize: 12.5, lineHeight: 1.55 }}
							>
								{occurrence?.status === "closed" ? "종료된" : "진행 중인"} 회차예요.
								날짜는 바꿀 수 없어요. 코트 총액이나 대관장소 여부를 바꾸면 이미
								발행한 대관비를 취소하고 다시 계산해요(저장 전에 확인).
							</p>
						)}
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

						{/* 정모 식사(회식) 참여 체크 — 정모일 때만. 회식 없는 정모도 있어 별도 토글. */}
						{isRegular && (
							<div className="flex items-center justify-between">
								<div className="flex flex-col gap-0.5">
									<span
										className={labelCls}
										style={{ ...labelStyle, marginBottom: 0 }}
									>
										식사 참여 체크
									</span>
									<span
										className="text-faint"
										style={{ fontSize: 11.5 }}
									>
										켜면 참석자가 회식 참여 여부를 고를 수 있어요 (기본 참여)
									</span>
								</div>
								<Switch
									checked={mealEnabled}
									onChange={setMealEnabled}
									disabled={busy}
									ariaLabel="식사 참여 체크"
								/>
							</div>
						)}

						{/* 회식 가게 — 식사 체크를 켤 때만. 장소 등록·거주지 입력과 같은 카카오 검색 컴포넌트.
						    결과를 고르면 이름+좌표가 저장돼 회원 카드에서 정확한 핀으로 지도가 열린다.
						    검색으로 못 찾거나 지도 키가 없으면 타이핑한 이름만 저장(이름 검색으로 폴백). */}
						{isRegular && mealEnabled && (
							<div>
								<label className={labelCls} style={labelStyle}>
									회식 가게
								</label>
								<KakaoLocationSearch
									value={mealPlace}
									onChangeText={changeMealPlaceText}
									onPick={(loc) =>
										pickMealPlace(loc.placeName, loc.lat, loc.lng)
									}
									placeholder="가게 이름으로 검색 (예: 산들애 곱창)"
									heightPx={170}
								/>
								<p
									className="text-faint"
									style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}
								>
									{mealCoords
										? "✓ 위치 지정됨 — 회원이 가게를 탭하면 지도에 핀으로 열려요."
										: "검색 결과를 고르면 위치가 저장돼요. 그냥 이름만 적어도 되고, 그때는 이름으로 지도를 검색해요."}
								</p>
							</div>
						)}

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
									작성합니다. 비워두면 회원 카드에 “대진표 · 안내 보기” 버튼이
									아예 뜨지 않아요.
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

						{/* 코트 총액(엔빵) — 대관장소일 때만. 비우면 규칙 기본값 사용 */}
						{placeChargesCourt && (
							<div>
								<label className={labelCls} style={labelStyle}>
									코트 총액 (엔빵)
								</label>
								<input
									type="number"
									inputMode="numeric"
									min={0}
									step={1000}
									value={courtFeeStr}
									onChange={(e) => setCourtFeeStr(e.target.value)}
									disabled={busy}
									placeholder="비우면 규칙 기본값"
									className={inputCls}
									style={inputStyle}
								/>
								<p className="text-faint" style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}>
									{courtFeeStr.trim() === ""
										? "이 회차는 반복 규칙의 기본 총액으로 부과돼요."
										: courtFeeChargeHint(parseCourtFee(courtFeeStr))}
								</p>
							</div>
						)}

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

						{/* 진행·종료 회차는 삭제하지 않는다(참석·경기·부과의 근거). */}
						{occurrence && !started && (
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
		{chargePreview && (
			<ConfirmDialog
				zIndex={70}
				title="저장하면 대관비 부과가 바뀌어요"
				tone={(chargePreview.result.cancelled ?? 0) > 0 ? "danger" : "primary"}
				confirmLabel={
					(chargePreview.result.cancelled ?? 0) > 0 ? "취소 후 재발행" : "저장"
				}
				cancelLabel="닫기"
				busy={busy}
				busyLabel="처리 중…"
				onConfirm={confirmChargeEdit}
				onCancel={dismissChargePreview}
				onDismiss={dismissChargePreview}
			>
				<div
					className="text-muted flex flex-col gap-1.5"
					style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 8 }}
				>
					{courtFeeResetLines(chargePreview.result, {
						// 대관장소가 아니게 되면 걷을 대상이 없다 — 문구는 총액 0원(안 걷음)과 같다.
						total: chargePreview.result.is_rental
							? (chargePreview.patch.courtFee ?? null)
							: 0,
						closed: occurrence?.status === "closed",
					}).map((line, i) => (
						<p key={i}>{line}</p>
					))}
				</div>
			</ConfirmDialog>
		)}
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
