import { useCallback, useState } from "react";
import TicketIcon from "../shared/TicketIcon";

/**
 * 티켓(우선참여권) 보유 표시용 VFX 무대 — Aura.
 *
 * 게임에서 Legendary/Rare 아이템이 활성화된 느낌을 목표로 한다. 티켓이 주인공이고
 * VFX(오라 + magic dust)는 그것을 강조하는 배경 역할만 한다.
 *
 * ★ 불변식: **티켓 DOM 은 절대 움직이지 않는다.** scale·rotate·translate·bounce·
 *   shake·pulse·opacity 애니메이션을 티켓에 걸지 않는다. 움직이는 것은 티켓 뒤·주변에
 *   깔리는 .tvfx-layer 와 .tvfx-dust 뿐이다. TicketIcon 은 `.tvfx-ticket`(정적) 안에만
 *   놓는다 — 깨면 상태 표시가 '버튼 애니메이션'으로 읽힌다(운영자 확정 기준).
 *
 * 구조:
 *   .tvfx (무대, overflow:hidden + 고리 마스크)
 *     ├ .tvfx-layer × 3  ← 떠도는 오라 (z-index 0)
 *     ├ .tvfx-dust       ← 파티클 (z-index 1, 선택)
 *     └ .tvfx-ticket     ← 티켓 (z-index 2, 정적)
 */

const AURA_LAYERS = ["tvfx-aura-1", "tvfx-aura-2", "tvfx-aura-3"] as const;

/** 동시에 떠 있는 파티클 수. 늘리면 magic dust 가 아니라 confetti 가 된다. */
const DUST_COUNT = 6;

interface Dust {
	x: string;
	y: string;
	d: string;
	dx: string;
	dy: string;
	dur: string;
	delay: string;
}

/**
 * 파티클 한 알을 추첨한다.
 *
 * 글리프(무대 중앙)를 가리지 않게 **고리 위에** 놓는다 — 중심에서 반지름 30~46% 띠
 * 안에서 각도를 무작위로 뽑는다. 이동은 바깥 방향으로 짧게만(6~13%) — 길게 주면
 * 폭죽처럼 터져 보인다.
 *
 * @param first 최초 렌더인가. 처음에는 delay 를 흩어 6알이 한꺼번에 뜨지 않게 하고,
 *              이후 재추첨에서는 delay 를 없애 바로 이어지게 한다.
 */
function rollDust(first: boolean): Dust {
	const angle = Math.random() * Math.PI * 2;
	const radius = 30 + Math.random() * 16; // % (중심 기준)
	const x = 50 + Math.cos(angle) * radius;
	const y = 50 + Math.sin(angle) * radius;
	const push = 6 + Math.random() * 7; // 바깥으로 밀려나는 거리 %
	return {
		x: `${x.toFixed(1)}%`,
		y: `${y.toFixed(1)}%`,
		d: `${(1.5 + Math.random() * 1.6).toFixed(1)}px`,
		dx: `${(Math.cos(angle) * push).toFixed(1)}%`,
		dy: `${(Math.sin(angle) * push).toFixed(1)}%`,
		// 운영자 요청(2026-09-05): 더 빠르게. 종전 6.2~8s → 2.1~3.3s.
		dur: `${(2.1 + Math.random() * 1.2).toFixed(2)}s`,
		delay: first ? `${(Math.random() * 2).toFixed(2)}s` : "0s",
	};
}

/**
 * 파티클 한 알. 한 바퀴가 끝나면 좌표를 **다시 추첨**한다 — CSS 만으로는 반복마다 값을
 * 바꿀 수 없어서 여기서 처리한다. 시작·끝 opacity 가 0 이라 교체 순간은 보이지 않는다.
 */
function DustMote() {
	const [dust, setDust] = useState(() => rollDust(true));
	const reroll = useCallback(() => setDust(rollDust(false)), []);
	return (
		<i
			onAnimationIteration={reroll}
			style={
				{
					"--x": dust.x,
					"--y": dust.y,
					"--d": dust.d,
					"--dx": dust.dx,
					"--dy": dust.dy,
					"--dur": dust.dur,
					"--delay": dust.delay,
				} as React.CSSProperties
			}
		/>
	);
}

interface Props {
	/** magic dust 파티클 추가. */
	particles?: boolean;
	/** 티켓 글리프 크기(px). 메인 헤더 기준값이 23. */
	size?: number;
	/** VFX 무대 한 변(px). 헤더에서는 50 전후가 적정. */
	stage?: number;
	className?: string;
}

export default function TicketVfx({
	particles = true,
	size = 23,
	stage = 52,
	className,
}: Props) {
	return (
		<span
			className={`tvfx${className ? ` ${className}` : ""}`}
			style={{ width: stage, height: stage }}
			role="img"
			aria-label="우선참여권 보유 중"
		>
			{AURA_LAYERS.map((cls) => (
				<span key={cls} className={`tvfx-layer ${cls}`} aria-hidden="true" />
			))}

			{particles && (
				<span className="tvfx-dust" aria-hidden="true">
					{Array.from({ length: DUST_COUNT }, (_, i) => (
						// key 가 고정이라 재추첨 때 DOM 이 유지된다(교체되면 애니메이션이 리셋된다).
						<DustMote key={i} />
					))}
				</span>
			)}

			{/* 티켓 — 정적. 여기에 애니메이션을 추가하지 말 것(파일 상단 불변식). */}
			<span className="tvfx-ticket">
				<TicketIcon size={size} />
			</span>
		</span>
	);
}
