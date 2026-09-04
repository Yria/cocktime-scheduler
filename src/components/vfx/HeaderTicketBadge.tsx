import { useState } from "react";
import TicketVfx, { type TicketVfxVariant } from "./TicketVfx";

/**
 * 메인 헤더 가운데에 놓이는 우선참여권 배지.
 *
 * 프로덕션에서는 **버튼이 아니라 상태 표시**다 — 탭 동작이 없고 이벤트를 받지 않는다
 * (운영자 확정 기준: 내역은 '내 정보'에서 본다). 티켓 DOM 은 정적이고 움직이는 것은
 * VFX 레이어뿐이다(TicketVfx 상단 불변식).
 *
 * 개발 중(`import.meta.env.DEV`)에만 **탭으로 6종을 순환**한다 — 실제 헤더 맥락에서
 * 변형을 비교해 고르기 위한 임시 수단이다. 고른 값은 localStorage 에 남아 새로고침해도
 * 유지된다. 변형이 확정되면 이 순환 코드와 DEV 분기를 지우고 확정 조합만 남긴다.
 */

type Combo = { variant: TicketVfxVariant; particles: boolean; label: string };

/** 순환 순서 = 비교 화면(/dev/vfx)과 같은 6종. */
const COMBOS: Combo[] = [
	{ variant: "orb", particles: false, label: "A Orb" },
	{ variant: "orb", particles: true, label: "A Orb +입자" },
	{ variant: "aura", particles: false, label: "B Aura" },
	{ variant: "aura", particles: true, label: "B Aura +입자" },
	{ variant: "specter", particles: false, label: "C Specter" },
	{ variant: "specter", particles: true, label: "C Specter +입자" },
];

/** 확정 전 기본값 — 다크에서 Epic/Legendary 느낌이 가장 잘 나는 조합. */
const DEFAULT_INDEX = 3;

const STORE_KEY = "cocktime.vfxCombo";

function readStored(): number {
	// 스토리지는 사생활 모드·차단 설정에서 접근 자체가 throw 한다 → 항상 감싼다.
	try {
		const raw = localStorage.getItem(STORE_KEY);
		// 키가 없으면 null 이고 Number(null) 은 **0** 이다 — 그대로 쓰면 기본값 대신
		// 항상 0번(A Orb)으로 시작한다. null 을 먼저 걸러낸다.
		if (raw == null) return DEFAULT_INDEX;
		const n = Number(raw);
		return Number.isInteger(n) && n >= 0 && n < COMBOS.length ? n : DEFAULT_INDEX;
	} catch {
		return DEFAULT_INDEX;
	}
}

export default function HeaderTicketBadge() {
	const [index, setIndex] = useState(() =>
		import.meta.env.DEV ? readStored() : DEFAULT_INDEX,
	);
	const combo = COMBOS[index];

	// 프로덕션 — 장식 전용. AppHeader 의 center 슬롯이 pointer-events:none 이라
	// 여기서 auto 로 올리지 않는 한 로고·알림벨 클릭을 가리지 않는다.
	if (!import.meta.env.DEV) {
		return <TicketVfx variant={combo.variant} particles={combo.particles} size={23} stage={52} />;
	}

	const next = () => {
		const n = (index + 1) % COMBOS.length;
		setIndex(n);
		try {
			localStorage.setItem(STORE_KEY, String(n));
		} catch {
			/* 저장 실패는 무시 — 이번 세션에만 유지된다 */
		}
	};

	return (
		<span
			style={{
				position: "relative",
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				// center 슬롯이 none 이므로 개발용 탭을 받으려면 여기서 되살린다.
				pointerEvents: "auto",
			}}
		>
			<button
				type="button"
				onClick={next}
				title={`${combo.label} — 탭하면 다음 조합`}
				aria-label={`우선참여권 보유 중. 개발용: 탭하면 다음 VFX 조합(${combo.label})`}
				style={{
					padding: 0,
					border: "none",
					background: "none",
					cursor: "pointer",
					display: "inline-flex",
					lineHeight: 0,
				}}
			>
				<TicketVfx variant={combo.variant} particles={combo.particles} size={23} stage={52} />
			</button>
			{/* 지금 무엇을 보고 있는지 — 개발 중에만. 헤더 높이를 밀지 않게 절대 배치한다. */}
			<span
				aria-hidden="true"
				style={{
					position: "absolute",
					top: "100%",
					left: "50%",
					transform: "translateX(-50%)",
					marginTop: -6,
					whiteSpace: "nowrap",
					fontSize: 9,
					fontWeight: 700,
					letterSpacing: ".02em",
					color: "var(--ticket-gold)",
					opacity: 0.75,
					pointerEvents: "none",
				}}
			>
				{combo.label}
			</span>
		</span>
	);
}
