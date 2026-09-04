import TicketIcon from "../shared/TicketIcon";

/**
 * 티켓(우선참여권) 보유 표시용 VFX 무대 — Aura + magic dust.
 *
 * 게임에서 Legendary/Rare 아이템이 활성화된 느낌을 목표로 한다. 티켓이 주인공이고
 * VFX 는 그것을 강조하는 배경 역할만 한다.
 *
 * ★ 불변식: **티켓 DOM 은 절대 움직이지 않는다.** scale·rotate·translate·bounce·
 *   shake·pulse·opacity 애니메이션을 티켓에 걸지 않는다. 움직이는 것은 티켓 뒤·주변에
 *   깔리는 .tvfx-layer 와 .tvfx-dust 뿐이다. TicketIcon 은 `.tvfx-ticket`(정적) 안에만
 *   놓는다 — 깨면 상태 표시가 '버튼 애니메이션'으로 읽힌다(운영자 확정 기준).
 *
 * 구조:
 *   .tvfx (무대, overflow:hidden + 고리 마스크)
 *     ├ .tvfx-layer × 3  ← 떠도는 오라 (z-index 0)
 *     ├ .tvfx-dust       ← 파티클 (z-index 1)
 *     └ .tvfx-ticket     ← 티켓 (z-index 2, 정적)
 */

const AURA_LAYERS = ["tvfx-aura-1", "tvfx-aura-2", "tvfx-aura-3"] as const;

/**
 * 파티클(별) 좌표 — **무작위로 한 번 뽑아 고정한 값**이다(운영자 지시: "랜덤위치를 뿌리고
 * 그 값을 고정해서 써"). 반복마다 재추첨하는 버전을 만들어 봤지만 더 어색했다 — 같은 자리에서
 * 규칙적으로 뜨는 것이 magic dust 로 읽히고, 매번 옮겨다니면 시선이 따라가느라 산만해진다.
 * 고르게 배치한 버전도 기계적으로 보여 폐기했다.
 *
 * 별(4각 sparkle)로 바꾸면서 좌표를 다시 계산했다 — 별은 점보다 2배 크고 `left/top` 이
 * 이제 **중심** 기준이라(CSS 의 음수 margin) 유효 구간이 좁다. 52px 무대에 23px 글리프가
 * 있으니 별이 놓일 수 있는 고리는 반지름 약 27~40% 뿐이다. 각 별은 크기에 맞춰 그 안에서
 * 반지름을 잡았고, 아래 세 조건을 모두 만족함을 계산으로 확인했다:
 *   · 글리프(중심 ±22.1%)를 침범하지 않는다 — 여유 0.6~7.5%
 *   · 이동(바깥 4%) 후에도 무대(반폭 50%) 안에 있다 — 최외곽 36~46%
 *   · 서로 13% 이상 떨어진다 — 최근접 16.5% (두 별이 한 덩어리로 보이지 않게)
 * 각도는 원래의 '한 번 뽑아 고정한' 무작위 배치를 유지하되, 겹치던 두 쌍만 벌렸다.
 *
 * **delay 는 주기(3.3s)를 6등분한 값이다.** 주기 통일 + 균등 시차 + 가시 구간 48% 조합이
 * 동시 표시를 영구히 2~3알로 고정한다(CSS 쪽 주석 참고) — 값을 개별로 바꾸지 말 것.
 */
const DUST = [
	{ x: "76.7%", y: "33.5%", d: "9.0px", dx: "3.4%", dy: "-2.1%", delay: "0s" },
	{ x: "40.3%", y: "17.3%", d: "9.4px", dx: "-1.1%", dy: "-3.8%", delay: "0.55s" },
	{ x: "56.8%", y: "18.1%", d: "7.2px", dx: "0.8%", dy: "-3.9%", delay: "1.1s" },
	{ x: "31.3%", y: "81.9%", d: "7.6px", dx: "-2.0%", dy: "3.5%", delay: "1.65s" },
	{ x: "82.1%", y: "53.2%", d: "9.8px", dx: "4.0%", dy: "0.4%", delay: "2.2s" },
	{ x: "75.9%", y: "74.5%", d: "8.0px", dx: "2.9%", dy: "2.7%", delay: "2.75s" },
] as const;

interface Props {
	/** magic dust 파티클 표시. */
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
					{DUST.map((p) => (
						<i
							key={p.delay}
							style={
								{
									"--x": p.x,
									"--y": p.y,
									"--d": p.d,
									"--dx": p.dx,
									"--dy": p.dy,
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
