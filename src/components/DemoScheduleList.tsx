import AppScreen from "./common/AppScreen";

// ⚠️ [임시 디버그] 로그인 없이 일정 리스트(AppScreen 셸 + 내부 스크롤)의 레이아웃/safe-area 확인용.
// 켜기: eruda 콘솔에서 localStorage.setItem('cocktime_demo','1') 후 새로고침.
// 끄기: localStorage.removeItem('cocktime_demo') 후 새로고침.
// 진단 끝나면: App.tsx 의 게이트 + 이 파일 삭제.
export default function DemoScheduleList() {
	return (
		<AppScreen logo>
			<div className="w-full max-w-sm mx-auto flex flex-col gap-3">
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
		</AppScreen>
	);
}
