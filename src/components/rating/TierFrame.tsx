import type { TierKey } from "../../lib/rating/tier";
import { tierLabel } from "../../lib/rating/tier";

/**
 * TierFrame — 아바타를 감싸 ELO 등급을 테두리 **모양**으로 보여준다(색만 바꾸면 색약·다크에서 구분이
 * 안 되므로 등급마다 실루엣을 다르게 한다).
 *   bronze   민무늬 고리
 *   silver   이중 고리
 *   gold     톱니(햇살) 고리
 *   platinum 깎은 팔각 판
 *   diamond  보석 컷 꼭짓점(4+4 별) + 지나가는 광택
 *   master   왕관 + 타오르는 오라
 *   placement(배치 중) 흐린 점선 고리 — 아직 등급이 없다는 뜻이라 어떤 등급 모양도 그리지 않는다.
 *
 * ★ 불변식(TicketVfx 와 같은 원칙): **아바타 DOM 은 절대 움직이지 않는다.** `.tierf-avatar` 와 그 안의
 *   children 에 animation/transform 을 걸지 않는다. 움직이는 것은 뒤·위에 깔리는 장식 레이어
 *   (.tierf-back / .tierf-fx / .tierf-aura)뿐이다 — 아바타가 흔들리면 '눌러야 하는 버튼'으로 읽힌다.
 *   prefers-reduced-motion 이면 장식도 정지한다(index.css).
 *
 * 크기: size 는 **아바타 지름**이다. 장식이 바깥으로 pad(지름의 22%)만큼 나가므로 실제 차지하는 상자는
 * size + 2·pad 다. 레이아웃에서 아바타 위치를 맞추려면 이 여백을 감안한다.
 */

interface Props {
	tier: TierKey;
	/** 배치 중(반영 5경기 미만) — 흐린 점선 고리만 */
	placement?: boolean;
	/** 아바타 지름(px). children(PlayerAvatar)의 size 와 같은 값을 넘긴다. */
	size: number;
	children: React.ReactNode;
	className?: string;
	/** 스크린리더용 이름 생략(옆에 등급명이 글자로 이미 있을 때) */
	decorative?: boolean;
}

function tierFramePad(size: number): number {
	return Math.round(size * 0.22);
}

export default function TierFrame({
	tier,
	placement = false,
	size,
	children,
	className,
	decorative,
}: Props) {
	const pad = tierFramePad(size);
	const label = placement ? "배치 중" : `${tierLabel(tier)} 등급`;
	return (
		<span
			className={`tierf tierf--${placement ? "placement" : tier}${className ? ` ${className}` : ""}`}
			style={
				{ "--tf-s": `${size}px`, "--tf-pad": `${pad}px` } as React.CSSProperties
			}
			{...(decorative
				? { "aria-hidden": true }
				: { role: "img", "aria-label": label })}
		>
			{/* 아바타 뒤 실루엣(톱니·팔각·별·오라) */}
			<span className="tierf-back" aria-hidden="true" />
			{tier === "master" && !placement && (
				<span className="tierf-aura" aria-hidden="true" />
			)}
			{/* 다이아의 45° 작은 별 — back 의 clip-path 에 잘리지 않게 형제 레이어로 둔다 */}
			{tier === "diamond" && !placement && (
				<span className="tierf-back tierf-back2" aria-hidden="true" />
			)}
			{/* 아바타 — 정적. 여기와 children 에 애니메이션을 추가하지 말 것(파일 상단 불변식). */}
			<span className="tierf-avatar">{children}</span>
			{/* 아바타 둘레 고리(위에 얹는다 — 사진 가장자리를 덮어 모양이 또렷하게) */}
			<span className="tierf-ring" aria-hidden="true" />
			{(tier === "diamond" || tier === "gold") && !placement && (
				<span className="tierf-fx" aria-hidden="true" />
			)}
			{tier === "master" && !placement && (
				<span className="tierf-crown" aria-hidden="true" />
			)}
		</span>
	);
}
