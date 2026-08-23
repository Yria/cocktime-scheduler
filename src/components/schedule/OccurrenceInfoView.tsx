import { useState } from "react";
import { courtFeeChargeHint, parseCourtFee } from "../../lib/schedule/courtFee";
import type { SessionRow } from "../../lib/supabase/types";
import ConfirmDialog from "../common/ConfirmDialog";
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
	 * 대관 총액 변경 = 그 회차 정산 재시작(배분 해제 → 부과 삭제 → 재발행).
	 * 되돌리기 어려운 조작이라 확인 다이얼로그를 거친다.
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
	const [feeConfirm, setFeeConfirm] = useState(false);
	// 값이 안 바뀌어도 누를 수 있게 둔다. "총액은 맞는데 부과가 어긋났다"(대상이 늘었거나 정액으로
	// 발행돼 운영진이 빠진 경우)가 실제로 있고, 그때가 바로 재계산이 필요한 순간이다.
	// 되돌리기 어려운 조작은 확인 다이얼로그가 막는다.

	async function fixFee() {
		if (!onFixCourtFee || feeBusy) return;
		setFeeBusy(true);
		try {
			await onFixCourtFee(parseCourtFee(feeStr));
			setFeeConfirm(false);
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
							onClick={() => setFeeConfirm(true)}
							disabled={feeBusy}
							className="btn-tint-blue rounded-[10px] px-4 py-0 text-sm bg-[rgba(11,132,255,0.12)] whitespace-nowrap disabled:opacity-35"
						>
							{feeBusy ? "처리 중…" : "저장 · 재발행"}
						</button>
					</div>
					<p className="text-faint" style={{ fontSize: 11.5, marginTop: 5, lineHeight: 1.5 }}>
						{courtFeeChargeHint(parseCourtFee(feeStr))}
						<br />
						총액을 바꾸면 이 회차 대관비 부과를 <b>전부 지우고 새 금액으로 다시 발행</b>합니다.
						이미 낸 입금은 배분이 풀려 <b>정산함으로 돌아가</b> 다시 확인해야 해요.
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
			{feeConfirm && (
				<ConfirmDialog
					zIndex={70}
					title="이 회차 대관비를 다시 계산할까요?"
					message={
						"기존 부과를 전부 지우고 새 총액으로 다시 발행합니다. 이미 낸 입금은 배분이 풀려 정산함으로 돌아가니, 그 건들을 다시 확인해야 해요. (지우기 전 명단·납부액은 감사 기록에 남습니다.)"
					}
					confirmLabel="다시 계산"
					cancelLabel="닫기"
					tone="danger"
					busy={feeBusy}
					busyLabel="처리 중…"
					onConfirm={fixFee}
					onCancel={() => setFeeConfirm(false)}
					onDismiss={() => setFeeConfirm(false)}
				/>
			)}

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
