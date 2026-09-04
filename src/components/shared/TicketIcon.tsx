interface Props {
	size?: number;
	className?: string;
}

/**
 * 우선참여권(대기 포인트 7점) 글리프.
 *
 * 왜 인라인 SVG 인가 — 🎫 이모지를 쓰지 않는다. 참여목록·게스트 섹션에서 이미 '게스트'를 뜻하는
 * 기호로 읽히므로 헤더에 띄우면 "내가 게스트로 잡혔나"로 오독된다. NewMemberIcon 도 재사용하지
 * 않는다(그쪽 주석이 '가입 시점 표식'으로 못박아 뒀다).
 *
 * 모양 = 좌우가 오목한 입장권 실루엣 + 가운데 별. 색은 부모가 currentColor 로 주입한다
 * (헤더에서는 --ticket-gold). 반짝임은 이 컴포넌트가 아니라 감싸는 쪽의 CSS 애니메이션이 담당한다.
 */
export default function TicketIcon({ size = 22, className }: Props) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			className={className}
			aria-hidden="true"
			focusable="false"
		>
			{/* 티켓 본체 — 좌우 중앙의 오목한 홈이 '표'로 읽히게 하는 핵심 실루엣 */}
			<path
				d="M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v2.1a2.4 2.4 0 0 0 0 4.8v2.1a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-2.1a2.4 2.4 0 0 0 0-4.8V7.5Z"
				fill="currentColor"
				fillOpacity="0.18"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinejoin="round"
			/>
			{/* 가운데 별 — '특별한 자리'를 뜻한다 */}
			<path
				d="m12 9.4 1.02 2.06 2.28.33-1.65 1.6.39 2.27L12 14.59l-2.04 1.07.39-2.27-1.65-1.6 2.28-.33L12 9.4Z"
				fill="currentColor"
			/>
		</svg>
	);
}
