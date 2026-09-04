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
 * 파티클 좌표 — **무작위로 한 번 뽑아 고정한 값**이다(운영자 지시: "랜덤위치를 뿌리고 그
 * 값을 고정해서 써"). 반복마다 재추첨하는 버전을 만들어 봤지만 더 어색했다 — 같은 자리에서
 * 규칙적으로 뜨는 것이 magic dust 로 읽히고, 매번 옮겨다니면 시선이 따라가느라 산만해진다.
 * 고르게 배치한 버전도 기계적으로 보여 폐기했다.
 *
 * 추첨 조건(재추첨할 일이 생기면 같은 조건을 지킬 것):
 *   · 중심에서 반지름 28~42% — 글리프(중심 ±22%)를 덮지 않는다
 *   · 바깥으로 5~9% 만 밀려난다 — 최대 이탈 43%로 무대(반폭 50%) 안에 머물러 잘리지 않는다
 *   · 서로 13% 이내로 붙지 않는다 — 두 알이 한 점처럼 보이는 것만 배제(고르게 만들지는 않는다)
 *   · 상반/하반 3:3, 한 사분면에 2개 이하 — 한쪽이 텅 비지 않게
 *
 * **delay 는 주기(3.3s)를 6등분한 값이고 고리 순서와 어긋나게 섞여 있다.** 순서대로 주면
 * 빛이 한 방향으로 도는 로더처럼 보인다. 주기 통일 + 균등 시차 + 가시 구간 48% 조합이
 * 동시 표시를 영구히 2~3알로 고정한다(CSS 쪽 주석 참고) — 값을 개별로 바꾸지 말 것.
 */
const DUST = [
	{ x: "74.1%", y: "35.1%", d: "4.5px", dx: "5.9%", dy: "-3.6%", delay: "0s" },
	{ x: "39.5%", y: "14.8%", d: "4.7px", dx: "-2.4%", dy: "-8.0%", delay: "0.55s" },
	{ x: "79.6%", y: "21.4%", d: "3.6px", dx: "5.6%", dy: "-5.4%", delay: "1.1s" },
	{ x: "29.2%", y: "85.5%", d: "3.8px", dx: "-4.1%", dy: "6.9%", delay: "1.65s" },
	{ x: "86.8%", y: "53.7%", d: "4.9px", dx: "6.5%", dy: "0.7%", delay: "2.2s" },
	{ x: "84.5%", y: "69.4%", d: "4.0px", dx: "6.7%", dy: "3.8%", delay: "2.75s" },
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
