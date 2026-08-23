import { useState } from "react";
import { courtFeeChargeHint, parseCourtFee } from "../../lib/schedule/courtFee";
import type { SessionRow } from "../../lib/supabase/types";
import { inputCls, inputStyle, labelCls, labelStyle } from "../common/fieldStyles";

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
	 * 대관 총액 정정. 발행된 부과의 금액을 바꿀 수 있는 유일한 경로(규칙은 발행분을 건드리지 않는다).
	 * 미납 발행분만 새 인당 금액으로 맞추고 납부분은 보존한다.
	 */
	onFixCourtFee?: (amount: number | null) => Promise<unknown>;
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
}: Props) {
	const cancelled = occurrence.status === "cancelled";
	// 총액 정정 — 진행·종료 회차의 대관장소에서만. 취소 회차는 부과 자체가 없어 노출하지 않는다.
	const canFixFee =
		chargesCourtFee && onFixCourtFee != null && !cancelled;
	const [feeStr, setFeeStr] = useState(() =>
		occurrence.court_fee != null ? String(occurrence.court_fee) : "",
	);
	const [feeBusy, setFeeBusy] = useState(false);
	const feeDirty = parseCourtFee(feeStr) !== (occurrence.court_fee ?? null);

	async function fixFee() {
		if (!onFixCourtFee || feeBusy) return;
		setFeeBusy(true);
		try {
			await onFixCourtFee(parseCourtFee(feeStr));
		} finally {
			setFeeBusy(false);
		}
	}
	return (
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
			{/* 대관 총액 정정 — 대관비는 세션 종료 시 발행되므로, "끝나고 실제 총액을 알게 됐다"를
			    처리할 자리가 여기다. 미납 발행분만 정정되고 납부분은 보존된다. */}
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
							onChange={(e) => setFeeStr(e.target.value)}
							disabled={feeBusy}
							placeholder="비우면 규칙 기본값"
							className={inputCls}
							style={{ ...inputStyle, flex: 1 }}
						/>
						<button
							type="button"
							onClick={fixFee}
							disabled={feeBusy || !feeDirty}
							className="btn-tint-blue rounded-[10px] px-4 py-0 text-sm bg-[rgba(11,132,255,0.12)] whitespace-nowrap disabled:opacity-35"
						>
							{feeBusy ? "정정 중…" : "금액 정정"}
						</button>
					</div>
					<p className="text-faint" style={{ fontSize: 11.5, marginTop: 5, lineHeight: 1.5 }}>
						{courtFeeChargeHint(parseCourtFee(feeStr))}
						<br />
						이미 발행된 부과 중 <b>미납분만</b> 새 금액으로 바뀝니다. 낸 사람은 그대로 남고
						몇 명인지 알려드려요.
					</p>
				</div>
			)}

			<p
				className="text-faint"
				style={{ fontSize: 12.5 }}
			>
				{cancelled
					? "취소된 회차예요. 되살리면 규칙에 따라 다시 노출·모집됩니다."
					: "진행 중이거나 종료된 회차는 수정할 수 없어요."}
			</p>
			{cancelled && onReopen && (
				<button
					type="button"
					onClick={onReopen}
					className="btn-solid-blue"
				>
					되살리기
				</button>
			)}
			<button
				type="button"
				onClick={onClose}
				className="btn-tint-neutral"
			>
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
			<dt
				className="text-muted"
				style={{ fontSize: 13, fontWeight: 600 }}
			>
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
