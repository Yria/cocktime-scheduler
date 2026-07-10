import type { CSSProperties } from "react";
import { fmtClock } from "../../lib/schedule/timeFmt";
import { poolStartMinutes } from "../../lib/schedule/latePool";

interface Props {
	/** 세션 시작 ISO(도착 오프셋의 기준). */
	scheduledAt: string;
	/** 세션 종료 ISO(슬라이더 상한). */
	endsAt: string;
	/** 표시할 늦참 오프셋(분) — 확인 대기 중이면 상위가 pending 값을 넘긴다. */
	value: number;
	disabled?: boolean;
	/** 30분 단위 오프셋 후보 전달 — 상위(ScheduleCard)가 8시 경계 크로싱이면 확인 다이얼로그로 게이팅. */
	onChange: (minutes: number) => void;
}

/**
 * 늦참 체크 — 시작~종료 타임라인 위에서 도착 시각을 좌우로 드래그해 30분 단위로 고른다.
 * 8시(KST 20:00) 이후 도착 구간은 "정원 외 늦참"으로, 트랙이 앰버→바이올렛 2톤으로 갈리고
 * 값 텍스트도 바이올렛으로 스왑된다(정원 큐와 분리된 독립 접수 신호). 실제 전환 확인은 상위가 담당.
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
	// 종료 시각엔 늦참이 없으므로(도착=종료는 무의미) 상한은 "종료 미만" 최대 30분 스텝.
	// 예) 18:00~21:00(3h) → 150분(20:30)까지, 21:00은 선택 불가.
	const max = Math.floor((durationMin - 1) / 30) * 30;
	if (!(max >= 30)) return null;

	const v = Math.min(Math.max(value, 0), max);
	const active = v > 0;

	// 정원 외 풀 경계(후반 2/3 지점) — 경계가 슬라이더 범위 안에서 의미 있을 때만 활성.
	const poolStart = poolStartMinutes(scheduledAt, endsAt);
	const poolActive = poolStart != null && poolStart >= 30 && poolStart <= max;
	const inPool = poolActive && v >= (poolStart as number);

	const arrival = active
		? fmtClock(new Date(start + v * 60000).toISOString())
		: null;

	// 채움 %: 총 채움과 앰버 구간 끝(= 8시 경계와 채움 중 작은 값). poolActive 아니면 전부 앰버.
	const fillPct = (v / max) * 100;
	const amberFillPct = poolActive
		? (Math.min(v, poolStart as number) / max) * 100
		: fillPct;

	return (
		<div className="ctl-row">
			<span className="ctl-label">늦참</span>
			<div className={inPool ? "ctl-pill pool" : "ctl-pill"}>
				<input
					type="range"
					className={inPool ? "late-range pool" : "late-range"}
					min={0}
					max={max}
					step={30}
					value={v}
					disabled={disabled}
					onChange={(e) => onChange(Number(e.target.value))}
					aria-label="늦참 도착 시각"
					style={
						{
							"--late-fill": `${Math.round(fillPct)}%`,
							"--late-amber-fill": `${Math.round(amberFillPct)}%`,
						} as CSSProperties
					}
				/>
				<span
					className={inPool ? "ctl-val pool" : active ? "ctl-val on" : "ctl-val"}
				>
					{arrival ?? "정시"}
				</span>
			</div>
		</div>
	);
}
