// ⚠️ [임시 검증] "자연 문서 스크롤(body scroll) + sticky 헤더" 방식.
// 고정높이 셸 / 내부 overflow / 100dvh / lvh / screen.height 일절 없음 — dogdrip 같은 일반 웹과 동일.
// safe-area 는 sticky 헤더 padding-top(env) + 콘텐츠 padding-bottom(env) 로만 처리.
// 이 방식이 잘 되면 AppScreen 을 이 구조로 리팩토링한다.
export default function DemoScheduleList() {
	return (
		<div className="bg-[#fafbff] dark:bg-[#0f172a]">
			<header
				className="border-b border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.1)]"
				style={{
					position: "sticky",
					top: 0,
					zIndex: 50,
					paddingTop: "env(safe-area-inset-top)",
					background: "rgba(250,250,255,0.85)",
					backdropFilter: "blur(12px)",
					WebkitBackdropFilter: "blur(12px)",
				}}
			>
				<div style={{ padding: "12px 16px", fontWeight: 800, fontSize: 16 }}>
					데모 (body scroll + sticky header)
				</div>
			</header>
			<div
				style={{
					padding: 16,
					paddingBottom: "max(16px, env(safe-area-inset-bottom))",
					display: "flex",
					flexDirection: "column",
					gap: 12,
				}}
			>
				{Array.from({ length: 24 }).map((_, i) => (
					<div
						key={i}
						className="bg-white dark:bg-[rgba(30,30,35,0.8)] border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.1)]"
						style={{
							borderRadius: 12,
							padding: "20px 16px",
							fontSize: 15,
							fontWeight: 700,
							color: "var(--text-primary)",
						}}
					>
						데모 카드 #{i + 1}
						{i === 23 ? " ← 마지막 (안 잘리고 다 보여야 정상)" : ""}
					</div>
				))}
			</div>
		</div>
	);
}
