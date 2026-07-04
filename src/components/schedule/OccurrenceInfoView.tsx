import type { SessionRow } from "../../lib/supabase/types";

interface Props {
	occurrence: SessionRow;
	occDate: string | null;
	time: string;
	endTime: string;
	placeName: (id: number | null) => string | null;
	error: string | null;
	onClose: () => void;
}

// active/closed: 편집 불가, 정보만
export default function OccurrenceInfoView({
	occurrence,
	occDate,
	time,
	endTime,
	placeName,
	error,
	onClose,
}: Props) {
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
			</dl>
			<p
				className="text-faint"
				style={{ fontSize: 12.5 }}
			>
				진행 중이거나 종료된 회차는 수정할 수 없어요.
			</p>
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
