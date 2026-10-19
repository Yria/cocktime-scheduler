import { useMemo, useState } from "react";
import {
	type AttendanceEvent,
	actorText,
	isCancelEvent,
	kstStamp,
	type SessionAttendanceLog,
	transitionText,
} from "../../lib/dues/attendanceLog";
import { kstDateKey } from "../../lib/dues/sessionSettle";

const W = 320;
const H = 132;
const PAD = { l: 26, r: 10, t: 12, b: 22 };
const KST_MS = 9 * 3600 * 1000;

/** 가장자리 점의 툴팁이 폰 화면 밖으로 나가지 않게 기준점을 바꾼다. */
function tipStyle(pct: number): React.CSSProperties {
	return {
		left: `${pct}%`,
		transform:
			pct < 30
				? "translateX(0)"
				: pct > 70
					? "translateX(-100%)"
					: "translateX(-50%)",
	};
}

/** 세션일 00:00 KST(ms). */
function kstDayStart(iso: string): number {
	const t = new Date(iso).getTime() + KST_MS;
	return t - (t % 86_400_000) - KST_MS;
}

function hourLabel(ms: number): string {
	const d = new Date(ms + KST_MS);
	return `${d.getUTCHours()}시`;
}

/**
 * 회차 확정 인원의 시간별 계단 그래프. 취소 순간은 점으로 표시한다.
 * '당일' 은 세션일 0시부터라 당일취소가 언제 어떤 흐름 속에서 났는지 보인다.
 */
export default function AttendanceTimeline({
	log,
	nameOf,
}: {
	log: SessionAttendanceLog;
	nameOf: (memberId: string) => string;
}) {
	const [range, setRange] = useState<"day" | "all">("day");
	const [hover, setHover] = useState<number | null>(null);
	const events = log.events;
	const first = events[0]?.at;
	const lastAt = events.at(-1)?.at;
	const endIso = log.endedAt ?? lastAt ?? log.scheduledAt;
	const view = useMemo(() => {
		if (!first || !endIso) return null;
		const end = Math.max(
			new Date(endIso).getTime(),
			log.scheduledAt ? new Date(log.scheduledAt).getTime() : 0,
		);
		const dayStart = log.scheduledAt ? kstDayStart(log.scheduledAt) : null;
		const start =
			range === "day" && dayStart !== null
				? Math.max(dayStart, new Date(first).getTime())
				: new Date(first).getTime();
		// 범위 시작 시점의 인원 = 그 직전 마지막 이벤트의 count.
		let startCount = 0;
		for (const e of events) {
			if (new Date(e.at).getTime() > start) break;
			startCount = e.count;
		}
		const shown = events.filter((e) => {
			const t = new Date(e.at).getTime();
			return t >= start && t <= end;
		});
		const maxCount = Math.max(
			4,
			log.capacity ?? 0,
			startCount,
			...shown.map((e) => e.count),
		);
		return {
			start,
			end: Math.max(end, start + 60_000),
			startCount,
			shown,
			maxCount,
		};
	}, [events, first, endIso, log.scheduledAt, log.capacity, range]);

	if (!view) return <p className="ac-tl-empty">참석 변경 기록이 없습니다.</p>;
	const { start, end, startCount, shown, maxCount } = view;
	const x = (ms: number) =>
		PAD.l + ((ms - start) / (end - start)) * (W - PAD.l - PAD.r);
	const y = (n: number) => PAD.t + (1 - n / maxCount) * (H - PAD.t - PAD.b);

	let d = `M${x(start)},${y(startCount)}`;
	for (const e of shown) d += ` H${x(new Date(e.at).getTime())} V${y(e.count)}`;
	d += ` H${x(end)}`;

	// 눈금: 범위가 하루 이내면 3시간, 아니면 12시간 간격(정각).
	const step = (end - start <= 26 * 3600_000 ? 3 : 12) * 3600_000;
	const ticks: number[] = [];
	for (
		let t = Math.ceil((start + KST_MS) / step) * step - KST_MS;
		t <= end;
		t += step
	)
		ticks.push(t);
	const yTicks = [0, Math.round(maxCount / 2), maxCount];
	const startMs = log.scheduledAt ? new Date(log.scheduledAt).getTime() : null;
	const hovered: AttendanceEvent | undefined =
		hover !== null ? shown[hover] : undefined;

	const onMove = (ev: React.PointerEvent<SVGSVGElement>) => {
		const box = ev.currentTarget.getBoundingClientRect();
		const px = ((ev.clientX - box.left) / box.width) * W;
		let best = -1;
		let bestD = 14; // 뷰박스 단위 히트 반경
		// 팁은 취소 점에만 — 신청·확정까지 잡히면 촘촘한 구간에서 원하는 취소를 못 고른다.
		shown.forEach((e, i) => {
			if (!isCancelEvent(e)) return;
			const dd = Math.abs(x(new Date(e.at).getTime()) - px);
			if (dd < bestD) {
				bestD = dd;
				best = i;
			}
		});
		setHover(best < 0 ? null : best);
	};

	const multiDay =
		!!first &&
		!!log.scheduledAt &&
		kstDateKey(first) !== kstDateKey(log.scheduledAt);
	return (
		<figure className="ac-tl">
			<figcaption>
				<span>시간별 확정 인원</span>
				{multiDay && (
					<span className="ac-tl-range">
						{(["day", "all"] as const).map((r) => (
							<button
								key={r}
								type="button"
								aria-pressed={range === r}
								onClick={() => {
									setRange(r);
									setHover(null);
								}}
							>
								{r === "day" ? "당일" : "전체"}
							</button>
						))}
					</span>
				)}
			</figcaption>
			<div className="ac-tl-plot">
				<svg
					viewBox={`0 0 ${W} ${H}`}
					role="img"
					aria-label="시간별 확정 인원 그래프"
					onPointerDown={onMove}
					onPointerMove={onMove}
					onPointerLeave={(ev) => {
						// 터치는 손을 떼면 leave 가 와서 툴팁이 바로 사라진다 — 다음 탭까지 고정.
						if (ev.pointerType === "mouse") setHover(null);
					}}
				>
					{yTicks.map((n) => (
						<g key={n}>
							<line
								className="ac-tl-grid"
								x1={PAD.l}
								x2={W - PAD.r}
								y1={y(n)}
								y2={y(n)}
							/>
							<text
								className="ac-tl-axis"
								x={PAD.l - 4}
								y={y(n) + 3}
								textAnchor="end"
							>
								{n}
							</text>
						</g>
					))}
					{ticks.map((t) => (
						<text
							key={t}
							className="ac-tl-axis"
							x={x(t)}
							y={H - 6}
							textAnchor="middle"
						>
							{hourLabel(t)}
						</text>
					))}
					{log.capacity !== null && log.capacity > 0 && (
						<line
							className="ac-tl-cap"
							x1={PAD.l}
							x2={W - PAD.r}
							y1={y(log.capacity)}
							y2={y(log.capacity)}
						/>
					)}
					{startMs !== null && startMs >= start && startMs <= end && (
						<g>
							<line
								className="ac-tl-start"
								x1={x(startMs)}
								x2={x(startMs)}
								y1={PAD.t}
								y2={H - PAD.b}
							/>
							<text
								className="ac-tl-axis"
								x={x(startMs) - 3}
								y={PAD.t + 8}
								textAnchor="end"
							>
								시작
							</text>
						</g>
					)}
					<path className="ac-tl-line" d={d} />
					{shown.filter(isCancelEvent).map((e) => (
						<circle
							key={`${e.at}-${e.memberId}-${e.to}`}
							className="ac-tl-dot"
							cx={x(new Date(e.at).getTime())}
							cy={y(e.count)}
							r={2.5}
						/>
					))}
					{hovered && (
						<line
							className="ac-tl-cross"
							x1={x(new Date(hovered.at).getTime())}
							x2={x(new Date(hovered.at).getTime())}
							y1={PAD.t}
							y2={H - PAD.b}
						/>
					)}
				</svg>
				{hovered && (
					<div
						className="ac-tl-tip"
						style={tipStyle((x(new Date(hovered.at).getTime()) / W) * 100)}
					>
						<strong>
							{kstStamp(hovered.at)} · {hovered.count}명
						</strong>
						<span>
							{nameOf(hovered.memberId)} {transitionText(hovered)} (
							{actorText(hovered)})
						</span>
					</div>
				)}
			</div>
			<p className="ac-tl-legend">
				<span className="ac-tl-key is-line" />
				확정 인원
				<span className="ac-tl-key is-dot" />
				취소
				{log.capacity ? (
					<>
						<span className="ac-tl-key is-cap" />
						정원 {log.capacity}
					</>
				) : null}
			</p>
			<details className="ac-tl-table">
				<summary>변경 기록 {shown.length}건 표로 보기</summary>
				<table>
					<thead>
						<tr>
							<th>시각</th>
							<th>회원</th>
							<th>변경</th>
							<th>인원</th>
						</tr>
					</thead>
					<tbody>
						{shown
							.filter((e) => e.from !== e.to)
							.map((e) => (
								<tr key={`${e.at}-${e.memberId}-${e.to}`}>
									<td>{kstStamp(e.at)}</td>
									<td>{nameOf(e.memberId)}</td>
									<td>
										{transitionText(e)} · {actorText(e)}
									</td>
									<td>{e.count}</td>
								</tr>
							))}
					</tbody>
				</table>
			</details>
		</figure>
	);
}
