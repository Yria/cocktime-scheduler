import TicketIcon from "../shared/TicketIcon";

/**
 * 티켓(우선참여권) 보유 표시용 VFX 무대.
 *
 * 게임에서 Legendary/Rare 아이템이 활성화된 느낌을 목표로 한다 — 티켓이 주인공이고
 * VFX 는 그것을 강조하는 배경 역할만 한다.
 *
 * ★ 불변식: **티켓 DOM 은 절대 움직이지 않는다.** scale·rotate·translate·bounce·
 *   shake·pulse·opacity 애니메이션을 티켓에 걸지 않는다. 움직이는 것은 티켓 뒤·주변에
 *   깔리는 .tvfx-layer 와 파티클뿐이다. TicketIcon 은 `.tvfx-ticket`(정적) 안에만 놓는다.
 *   — 이 규칙을 깨면 상태 표시가 '버튼 애니메이션'으로 읽힌다(운영자 확정 기준).
 *
 * 구조:
 *   .tvfx (무대, overflow:hidden + 고리 마스크)
 *     ├ .tvfx-layer × N   ← 움직이는 VFX (z-index 0)
 *     ├ .tvfx-dust        ← 파티클 (z-index 1, 선택)
 *     └ .tvfx-ticket      ← 티켓 (z-index 2, 정적)
 *
 * 모든 레이어가 가운데가 빈 고리 마스크(--tvfx-ring)를 공유하므로 글리프 뒤는 늘 비어
 * 있고, 마스크가 바깥에서 서서히 사라져 무대의 잘린 경계가 보이지 않는다.
 * WebGL 을 쓰지 않는다(프로젝트에 없음) — CSS 그라디언트 + blur + mask 만 쓴다.
 */

export type TicketVfxVariant = "orb" | "aura" | "specter";

interface Props {
	variant: TicketVfxVariant;
	/** magic dust 파티클 추가. */
	particles?: boolean;
	/** 티켓 글리프 크기(px). 메인 헤더 기준값이 23. */
	size?: number;
	/** VFX 무대 한 변(px). 헤더에서는 50~80 사이가 적정. */
	stage?: number;
	className?: string;
}

/**
 * 파티클 배치 — **고정 테이블**이다. Math.random 을 쓰면 리렌더마다 점이 튀어
 * '떠다니는 먼지'가 아니라 '깜빡이는 오류'로 보인다. 서로 다른 delay/duration 이
 * 무작위성을 만들고, 동시에 뜨지 않으므로 폭죽처럼 터지지 않는다.
 * 좌표는 무대 기준 % 라 stage 크기가 바뀌어도 비율이 유지된다.
 */
const DUST = [
	{ x: "16%", y: "26%", d: 2.5, dx: "-8%", dy: "-14%", dur: "6.5s", delay: "0s" },
	{ x: "78%", y: "22%", d: 2, dx: "10%", dy: "-10%", dur: "7.5s", delay: "1.1s" },
	{ x: "86%", y: "62%", d: 2.5, dx: "9%", dy: "9%", dur: "6.8s", delay: "2.4s" },
	{ x: "50%", y: "88%", d: 2, dx: "-3%", dy: "12%", dur: "8s", delay: "3.6s" },
	{ x: "14%", y: "68%", d: 3, dx: "-11%", dy: "8%", dur: "7.2s", delay: "4.7s" },
	{ x: "44%", y: "10%", d: 1.5, dx: "4%", dy: "-13%", dur: "6.2s", delay: "5.5s" },
] as const;

/** 변형별 레이어 조합. 정적 림(orb-rim)도 여기서 함께 얹는다. */
const LAYERS: Record<TicketVfxVariant, string[]> = {
	orb: ["tvfx-orb-1", "tvfx-orb-2", "tvfx-orb-rim"],
	aura: ["tvfx-aura-1", "tvfx-aura-2", "tvfx-aura-3"],
	specter: ["tvfx-spec-mist", "tvfx-spec-1", "tvfx-spec-2"],
};

export default function TicketVfx({
	variant,
	particles = false,
	size = 23,
	stage = 64,
	className,
}: Props) {
	return (
		<span
			className={`tvfx${className ? ` ${className}` : ""}`}
			style={{ width: stage, height: stage }}
			role="img"
			aria-label="우선참여권 보유 중"
		>
			{LAYERS[variant].map((cls) => (
				<span key={cls} className={`tvfx-layer ${cls}`} aria-hidden="true" />
			))}

			{particles && (
				<span className="tvfx-dust" aria-hidden="true">
					{DUST.map((p) => (
						<i
							key={`${p.x}-${p.y}`}
							style={
								{
									"--x": p.x,
									"--y": p.y,
									"--d": `${p.d}px`,
									"--dx": p.dx,
									"--dy": p.dy,
									"--dur": p.dur,
									"--delay": p.delay,
								} as React.CSSProperties
							}
						/>
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
