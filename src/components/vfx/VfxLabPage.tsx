import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppScreen from "../common/AppScreen";
import TicketVfx, { type TicketVfxVariant } from "./TicketVfx";

/**
 * 개발용 VFX 비교 화면(`/dev/vfx`). 라우트는 `import.meta.env.DEV` 에서만 등록된다.
 *
 * 6종(3 변형 × 파티클 유무)을 **같은 티켓 크기·같은 위치**로 나란히 두어 VFX 차이만
 * 보이게 한다. hover/click 없이 페이지가 뜨는 순간부터 계속 loop 한다.
 * 헤더 실사용 크기(23px)와 판단용 확대(44px)를 함께 보여주고, 라이트/다크 두 바탕을
 * 토글로 바꿔 볼 수 있다 — 금색 토큰이 테마마다 달라 다크에서 인상이 크게 바뀐다.
 */

const VARIANTS: { key: TicketVfxVariant; name: string; note: string }[] = [
	{
		key: "orb",
		name: "A · Orb",
		note: "무지갯빛 에너지 덩어리가 반대 방향 두 겹으로 천천히 흐른다. 정적인 유리 림이 테두리를 잡아 준다.",
	},
	{
		key: "aura",
		name: "B · Aura Blob",
		note: "금색 코어 + 보라 기운의 오라가 티켓을 감싼다. blob 셋이 각자 다른 주기로 떠돌아 한 덩어리로 보이지 않는다.",
	},
	{
		key: "specter",
		name: "C · Specter Orb",
		note: "마력 가닥이 서로 반대로 돌고, 옅은 안개가 좌우로 흐른다. 밝은 색만 써서 어두운 덩어리가 생기지 않는다.",
	},
];

/** 헤더 재현 — 실제 AppHeader 의 치수(52px 높이, 좌 로고 / 우 아이콘 2개)를 그대로 쓴다. */
function HeaderMock({
	variant,
	particles,
	dark,
}: {
	variant: TicketVfxVariant;
	particles: boolean;
	dark: boolean;
}) {
	return (
		<div
			className={dark ? "dark" : undefined}
			style={{
				background: dark ? "#0f172a" : "#fafbff",
				color: dark ? "#fff" : "#0f1724",
				borderRadius: 12,
				overflow: "hidden",
			}}
		>
			<div style={{ padding: "0 1.25rem" }}>
				<div
					style={{
						height: 52,
						display: "flex",
						alignItems: "center",
						position: "relative",
					}}
				>
					<span style={{ fontSize: 18, fontWeight: 900, letterSpacing: "-.02em" }}>
						콕타임
					</span>
					<span style={{ flex: 1 }} />
					<span style={{ display: "flex", gap: 2, opacity: 0.72, marginRight: -18 }}>
						<span
							style={{
								width: 40,
								height: 40,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
								<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
							</svg>
						</span>
						<span
							style={{
								width: 40,
								height: 40,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								fontSize: 19,
								fontWeight: 700,
							}}
						>
							⋮
						</span>
					</span>
					{/* AppHeader 의 center 슬롯과 동일한 절대 배치 */}
					<span
						style={{
							position: "absolute",
							top: 0,
							bottom: 0,
							left: "50%",
							transform: "translateX(-50%)",
							display: "flex",
							alignItems: "center",
							pointerEvents: "none",
						}}
					>
						<TicketVfx variant={variant} particles={particles} size={23} stage={52} />
					</span>
				</div>
			</div>
		</div>
	);
}

function Cell({
	variant,
	particles,
	dark,
}: {
	variant: TicketVfxVariant;
	particles: boolean;
	dark: boolean;
}) {
	return (
		<div
			className={dark ? "dark" : undefined}
			style={{
				background: dark ? "#0f172a" : "#fafbff",
				borderRadius: 12,
				padding: "18px 8px 12px",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 12,
			}}
		>
			<TicketVfx variant={variant} particles={particles} size={44} stage={104} />
			<TicketVfx variant={variant} particles={particles} size={23} stage={58} />
			<span
				style={{
					fontSize: 10.5,
					letterSpacing: ".04em",
					color: dark ? "rgba(235,235,245,.45)" : "#a8a29e",
				}}
			>
				{particles ? "+ 파티클" : "기본"}
			</span>
		</div>
	);
}

export default function VfxLabPage() {
	const navigate = useNavigate();
	const [dark, setDark] = useState(false);

	return (
		<AppScreen title="티켓 VFX 비교" onBack={() => navigate("/")}>
			<div className="app-card flex flex-col" style={{ gap: 18 }}>
				<div>
					<p className="text-muted" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
						티켓은 세 변형에서 <b>동일한 크기·위치로 완전히 정적</b>이고, 뒤·주변의 VFX
						레이어만 움직입니다. 위가 판단용 확대(44px), 아래가 헤더 실사용 크기(23px)예요.
						hover 없이 계속 돕니다.
					</p>
				</div>

				<button
					type="button"
					onClick={() => setDark((v) => !v)}
					className="text-strong"
					style={{
						alignSelf: "flex-start",
						padding: "7px 14px",
						borderRadius: 9,
						fontSize: 13,
						fontWeight: 700,
						border: "1px solid rgba(120,120,128,0.28)",
						background: "transparent",
						cursor: "pointer",
					}}
				>
					{dark ? "라이트 바탕으로" : "다크 바탕으로"}
				</button>

				{VARIANTS.map((v) => (
					<section key={v.key} className="flex flex-col" style={{ gap: 8 }}>
						<div>
							<h2 className="text-strong" style={{ fontSize: 15.5, fontWeight: 800, margin: 0 }}>
								{v.name}
							</h2>
							<p className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.55, margin: "3px 0 0" }}>
								{v.note}
							</p>
						</div>
						<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
							<Cell variant={v.key} particles={false} dark={dark} />
							<Cell variant={v.key} particles dark={dark} />
						</div>
						{/* 실제 헤더 맥락 — 로고·알림벨과 함께 봐야 강도 판단이 된다. */}
						<HeaderMock variant={v.key} particles dark={dark} />
					</section>
				))}
			</div>
		</AppScreen>
	);
}
