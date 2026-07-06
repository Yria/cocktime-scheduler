import type { CSSProperties } from "react";
import { fmtClock } from "../../lib/schedule/timeFmt";

interface Props {
	/** 세션 시작 ISO(도착 오프셋의 기준). */
	scheduledAt: string;
	/** 세션 종료 ISO(슬라이더 상한). */
	endsAt: string;
	/** 현재 늦참 오프셋(분). */
	value: number;
	disabled?: boolean;
	/** 30분 단위 오프셋 반영. */
	onChange: (minutes: number) => void;
}

/**
 * 늦참 체크 — 시작~종료 타임라인 위에서 도착 시각을 좌우로 드래그해 30분 단위로 고른다.
 * 카풀 세그먼트와 통일된 알약 트랙(.ctl-pill) 안 슬라이더 + 우측 도착시각 값.
 * 늦참 여지가 없는(≤30분) 세션은 렌더 생략.
 */
export default function LateArrivalSlider({
	scheduledAt,
	endsAt,
	value,
	disabled,
	onChange,
}: Props) {
	const start = new Date(scheduledAt).getTime();
	const durationMin = Math.floor((new Date(endsAt).getTime() - start) / 60000);
	const max = Math.floor(durationMin / 30) * 30; // 30분 단위 상한(내림)
	if (!(max >= 30)) return null;

	const v = Math.min(Math.max(value, 0), max);
	const active = v > 0;
	const arrival = active
		? fmtClock(new Date(start + v * 60000).toISOString())
		: null;

	return (
		<div className="ctl-row">
			<span className="ctl-label">늦참</span>
			<div className="ctl-pill">
				<input
					type="range"
					className="late-range"
					min={0}
					max={max}
					step={30}
					value={v}
					disabled={disabled}
					onChange={(e) => onChange(Number(e.target.value))}
					aria-label="늦참 도착 시각"
					style={
						{ "--late-fill": `${Math.round((v / max) * 100)}%` } as CSSProperties
					}
				/>
				<span className={active ? "ctl-val on" : "ctl-val"}>
					{arrival ?? "정시"}
				</span>
			</div>
		</div>
	);
}
