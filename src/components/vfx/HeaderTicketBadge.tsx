import TicketVfx from "./TicketVfx";

/**
 * 메인 헤더 가운데에 놓이는 우선참여권 배지.
 *
 * **버튼이 아니라 상태 표시**다 — 탭 동작이 없고, AppHeader 의 center 슬롯이
 * pointer-events:none 이라 로고·알림벨 클릭도 가리지 않는다(운영자 확정 기준:
 * 내역은 '내 정보'에서 본다). 티켓 DOM 은 정적이고 움직이는 것은 오라와 파티클뿐이다
 * (TicketVfx 상단 불변식).
 *
 * 개발 중에는 티켓 미보유여도 띄운다 — 실제 헤더 맥락에서 강도를 확인하기 위함
 * (조건은 Home.tsx 의 center prop).
 */
export default function HeaderTicketBadge() {
	return <TicketVfx size={23} stage={52} />;
}
