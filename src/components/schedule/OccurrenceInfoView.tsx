import { useState } from "react";
import {
	courtFeeChargeHint,
	courtFeeResetLines,
	parseCourtFee,
} from "../../lib/schedule/courtFee";
import {
	type SetSessionFeeResult,
	accountingError,
} from "../../lib/supabase/dues";
import type { SessionRow } from "../../lib/supabase/types";
import ConfirmDialog from "../common/ConfirmDialog";
import {
	inputCls,
	inputStyle,
	labelCls,
	labelStyle,
} from "../common/fieldStyles";

interface Props {
	occurrence: SessionRow;
	occDate: string | null;
	time: string;
	endTime: string;
	placeName: (id: number | null) => string | null;
	error: string | null;
	onClose: () => void;
	/** 취소된 회차 되살리기(취소 취소). status==='cancelled' 일 때만 버튼 노출. */
	onReopen?: () => void;
	/** 대관장소 회차인가 — 총액 정정 칸 노출 조건. */
	chargesCourtFee?: boolean;
	/**
	 * 대관 총액 변경. 발행분이 있으면 서버가 전부 취소(납부 해제) 후 새 금액으로 재발행한다.
	 * 실패는 throw — 이 컴포넌트가 사유를 보여준다.
	 */
	onFixCourtFee?: (amount: number | null) => Promise<unknown>;
	/** 위 변경을 돌려 본 결과(서버 롤백). 확인창 숫자용. */
	onPreviewCourtFee?: (amount: number | null) => Promise<SetSessionFeeResult>;
}

// active/closed: 편집 불가, 정보만. cancelled: 되살리기만 가능.
export default function OccurrenceInfoView({
	occurrence,
	occDate,
	time,
	endTime,
	placeName,
	error,
	onClose,
	onReopen,
	chargesCourtFee = false,
	onFixCourtFee,
	onPreviewCourtFee,
}: Props) {
	const cancelled = occurrence.status === "cancelled";
	// 총액 정정 — 진행·종료 회차의 대관장소에서만. 취소 회차에서는 변경을 제공하지 않는다.
	const canFixFee =
		chargesCourtFee &&
		onFixCourtFee != null &&
		onPreviewCourtFee != null &&
		!cancelled;
	const [feeStr, setFeeStr] = useState(() =>
		occurrence.court_fee != null ? String(occurrence.court_fee) : "",
	);
	const [feeBusy, setFeeBusy] = useState(false);
	// 확인창 = 미리보기 결과. null 이면 닫힘.
	const [feePreview, setFeePreview] = useState<SetSessionFeeResult | null>(
		null,
	);
	const [feeError, setFeeError] = useState<string | null>(null);

	// 저장 전에 무슨 일이 일어날지(취소·재발행·잔액) 서버에서 돌려 보고 확인받는다.
	// 거부 사유(정상 범위 밖 등)도 여기서 미리 드러난다.
	async function previewFee() {
		if (!onPreviewCourtFee || feeBusy) return;
		setFeeBusy(true);
		setFeeError(null);
		try {
			const amount = parseCourtFee(feeStr);
			// 저장된 총액과 같으면 할 일이 없다. 총액이 달라도 인당 금액이 같으면(unchanged)
			// 부과는 그대로 두고 총액만 저장하도록 확인창을 띄운다.
			if (amount === occurrence.court_fee) {
				setFeeError("저장된 총액과 같아요.");
				return;
			}
			setFeePreview(await onPreviewCourtFee(amount));
		} catch (e) {
			setFeeError(accountingError(e));
		} finally {
			setFeeBusy(false);
		}
	}

	async function fixFee() {
		if (!onFixCourtFee || feeBusy) return;
		setFeeBusy(true);
		try {
			await onFixCourtFee(parseCourtFee(feeStr));
		} catch (e) {
			setFeeError(accountingError(e));
		} finally {
			setFeePreview(null);
			setFeeBusy(false);
		}
	}
	return (
		<div className="flex flex-col gap-3">
			<dl className="flex flex-col gap-2">
				<InfoRow label="시간" value={`${occDate ?? ""} ${time}~${endTime}`} />
				<InfoRow
					label="장소"
					value={placeName(occurrence.place_id) ?? "장소 미정"}
				/>
				<InfoRow
					label="정원"
					value={
						occurrence.capacity != null ? `${occurrence.capacity}명` : "무제한"
					}
				/>
				<InfoRow
					label="카풀"
					value={occurrence.carpool_enabled ? "사용" : "사용 안 함"}
				/>
				<InfoRow
					label="정모"
					value={occurrence.is_regular ? "지정됨" : "아니오"}
				/>
				{/* 식사 체크는 정모 회차에서만 의미가 있어 정모일 때만 노출 */}
				{occurrence.is_regular && (
					<InfoRow
						label="식사 체크"
						value={occurrence.meal_enabled ? "사용" : "사용 안 함"}
					/>
				)}
				{occurrence.is_regular && occurrence.meal_enabled && (
					<InfoRow
						label="회식 가게"
						value={occurrence.meal_place ?? "미지정"}
					/>
				)}
			</dl>
			{/* 대관 총액 변경 — 대관비는 세션 종료 시 발행되므로, "끝나고 실제 총액을 알게 됐다"를
			    처리할 자리가 여기다. 발행분은 전부 취소 후 재발행되고, 낸 돈은 같은 회원 새 부과로 다시 연결된다. */}
			{canFixFee && (
				<div className="border-t border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] pt-3">
					<label className={labelCls} style={labelStyle} htmlFor="oiv-fee">
						코트 총액 (엔빵)
					</label>
					<div className="flex gap-2">
						<input
							id="oiv-fee"
							type="number"
							inputMode="numeric"
							min={0}
							step={1000}
							value={feeStr}
							onChange={(e) => {
								setFeeStr(e.target.value);
								setFeeError(null);
							}}
							disabled={feeBusy}
							placeholder="비우면 규칙 기본값"
							className={inputCls}
							style={{ ...inputStyle, flex: 1 }}
						/>
						<button
							type="button"
							onClick={previewFee}
							disabled={feeBusy}
							className="btn-tint-blue rounded-[10px] px-4 py-0 text-sm bg-[rgba(11,132,255,0.12)] whitespace-nowrap disabled:opacity-35"
						>
							{feeBusy ? "처리 중…" : "총액 저장"}
						</button>
					</div>
					<p
						className="text-faint"
						style={{ fontSize: 11.5, marginTop: 5, lineHeight: 1.5 }}
					>
						{courtFeeChargeHint(parseCourtFee(feeStr))}
						<br />
						이미 발행한 대관비가 있으면 전부 취소하고 새 금액으로 다시
						발행해요.
					</p>
					{feeError && (
						<p
							role="alert"
							style={{
								fontSize: 12.5,
								fontWeight: 600,
								color: "#ef4444",
								marginTop: 6,
							}}
						>
							{feeError}
						</p>
					)}
				</div>
			)}

			<p className="text-faint" style={{ fontSize: 12.5 }}>
				{cancelled
					? "취소된 회차예요. 되살리면 규칙에 따라 다시 노출·모집됩니다."
					: "진행 중이거나 종료된 회차는 수정할 수 없어요."}
			</p>
			{feePreview && (
				<ConfirmDialog
					zIndex={70}
					title="이 회차 대관 총액을 저장할까요?"
					tone={(feePreview.cancelled ?? 0) > 0 ? "danger" : "primary"}
					confirmLabel={
						(feePreview.cancelled ?? 0) > 0 ? "취소 후 재발행" : "저장"
					}
					cancelLabel="닫기"
					busy={feeBusy}
					busyLabel="처리 중…"
					onConfirm={fixFee}
					onCancel={() => setFeePreview(null)}
					onDismiss={() => setFeePreview(null)}
				>
					<div
						className="text-muted flex flex-col gap-1.5"
						style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 8 }}
					>
						{courtFeeResetLines(feePreview, {
							total: parseCourtFee(feeStr),
							closed: occurrence.status === "closed",
						}).map((line, i) => (
							<p key={i}>{line}</p>
						))}
					</div>
				</ConfirmDialog>
			)}

			{cancelled && onReopen && (
				<button type="button" onClick={onReopen} className="btn-solid-blue">
					되살리기
				</button>
			)}
			<button type="button" onClick={onClose} className="btn-tint-neutral">
				닫기
			</button>
			{error && (
				<p style={{ fontSize: 13, fontWeight: 600, color: "#ef4444" }}>
					{error}
				</p>
			)}
		</div>
	);
}

function InfoRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-3">
			<dt className="text-muted" style={{ fontSize: 13, fontWeight: 600 }}>
				{label}
			</dt>
			<dd
				className="text-strong text-right"
				style={{ fontSize: 14, fontWeight: 600 }}
			>
				{value}
			</dd>
		</div>
	);
}
