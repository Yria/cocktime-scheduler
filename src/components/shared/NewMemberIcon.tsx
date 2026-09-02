/**
 * 신규 회원(가입 2주 이내) 표식 — 큰 반짝임 + 작은 반짝임.
 *
 * 뜻은 "우리 모임에 최근 가입했다"이지 "배드민턴을 처음 한다"가 아니다. 그래서 **성장 은유를 쓰지
 * 않는다** — 새싹·잎·아기·알 계열은 예외 없이 실력 단계로 번역되어, 20년 구력 고수에게 입문자 낙인을
 * 찍는다(lucide Sprout 를 걷어낸 이유). 반짝임은 실력 축을 건드리지 않고 '최근'이라는 시간만 가리킨다.
 *
 * 이모지(✨)는 플랫폼마다 모양이 달라 참여목록의 CrownIcon 과 같이 인라인 SVG + fill=currentColor 로
 * 고정한다. 같은 채움 방식이라 한 줄 안에서 왕관과 시각 무게가 맞고 실루엣은 서로 직교한다
 * (왕관 = 가로로 넓고 밑변이 평평한 덩어리 / 반짝임 = 방사 대칭). lucide Sparkle 은 외곽선이라
 * 16px 에서 가운데가 비어 왕관과 무게가 어긋나므로 쓰지 않았다.
 *
 * 주의: 글리프 자체는 "새것"까지만 말하고 **소속(모임 신입)은 말하지 못한다.** 그 뜻은 배지가 놓인
 * 자리와 호출부의 title/aria-label 이 지탱하므로 그 설명 문구를 지우지 말 것.
 *
 * 색은 주입하지 않는다(currentColor) — 부모에서 초록 토큰을 준다.
 * 쓰는 곳: 참여목록 행 배지(SessionParticipantsModal), 진입 안내 제목(NewbieFreepassAlert).
 */
export default function NewMemberIcon({ size = 16 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M9.5 5.5 L11.76 11.24 L17.5 13.5 L11.76 15.76 L9.5 21.5 L7.24 15.76 L1.5 13.5 L7.24 11.24 Z" />
			<path d="M18.5 1.2 L19.56 4.44 L22.8 5.5 L19.56 6.56 L18.5 9.8 L17.44 6.56 L14.2 5.5 L17.44 4.44 Z" />
		</svg>
	);
}
