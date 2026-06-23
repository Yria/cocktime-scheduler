// ⚠️ [임시 디버그/실험] 풀블리드 검증용.
// 가설: CSS 단위(lvh=869)가 화면(956)에 못 닿으니, scroll 컨테이너 높이를
//       window.screen.height(956)로 "강제"하면 웹뷰가 869 아래(홈 인디케이터 밑)까지
//       콘텐츠를 그리는가? 맨 아래 빨강 블록이 홈 인디케이터 밑까지 보이면 → JS 주입이 답.
// 켜기: eruda 콘솔에서 localStorage.setItem('cocktime_demo','1') 후 새로고침.
// 진단 끝나면: App.tsx 게이트 + 이 파일 삭제.
export default function DemoScheduleList() {
	const sh = typeof window !== "undefined" ? window.screen.height : 0;
	return (
		<div
			style={{
				height: `${sh}px`, // ★ screen.height(956) 강제 — lvh(869) 대신
				overflowY: "auto",
				WebkitOverflowScrolling: "touch",
				background: "#fafbff",
			}}
		>
			<div
				style={{
					position: "sticky",
					top: 0,
					paddingTop: "calc(env(safe-area-inset-top) + 12px)",
					padding: "12px 16px",
					fontWeight: 800,
					background: "rgba(250,250,255,0.92)",
					backdropFilter: "blur(10px)",
					WebkitBackdropFilter: "blur(10px)",
				}}
			>
				DEMO height=screen.height({sh})
			</div>
			<div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
				{Array.from({ length: 22 }).map((_, i) => (
					<div
						key={i}
						style={{
							borderRadius: 12,
							padding: "20px 16px",
							fontSize: 15,
							fontWeight: 700,
							background: "#fff",
							border: "1px solid rgba(0,0,0,0.08)",
						}}
					>
						데모 카드 #{i + 1}
					</div>
				))}
				{/* 마지막: 패딩 크게 줘서 홈 인디케이터 밑까지 빨강이 보이는지 본다 */}
				<div
					style={{
						borderRadius: "12px 12px 0 0",
						padding: "20px 16px 80px",
						fontSize: 15,
						fontWeight: 800,
						background: "#ff3b30",
						color: "#fff",
					}}
				>
					🔴 마지막 — 이 빨강이 홈 인디케이터 밑까지 닿으면 풀블리드 성공
				</div>
			</div>
		</div>
	);
}
