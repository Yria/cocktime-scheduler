import { ChevronLeft } from "lucide-react";

interface Props {
	/** 제목(logo=true면 로고가 우선). */
	title?: string;
	/** 있으면 좌측에 뒤로가기 화살표 표시. */
	onBack?: () => void;
	/** 제목 대신 로고 표시. */
	logo?: boolean;
	/** 우측 액션 영역(알림 벨·메뉴 등). */
	right?: React.ReactNode;
}

/**
 * 앱 스타일 상단 네비 바. body 자연 스크롤에서 sticky 로 상단에 고정된다(flex 셸에선 flex-shrink-0).
 * safe-area-inset-top 을 흡수해 노치/상태바 영역까지 덮는다.
 *
 * 가로 정렬: 본문 콘텐츠와 동일한 중첩 컨테이너(외부 1.25rem 좌우 패딩 + 내부 .app-card)를
 * 써서 모든 화면폭에서 nav 내용이 본문 거터(20px)와 정확히 맞물린다. .app-card 가 카드 폭
 * (--card-max)을 패딩 안쪽에서 캡하므로 본문과 같은 기준으로 중앙 정렬되어 좌우가 어긋나지 않는다.
 */
export default function AppHeader({ title, onBack, logo, right }: Props) {
	return (
		<header
			className="sticky top-0 z-50 flex-shrink-0 bg-[#fafbff] dark:bg-[#0f172a] border-b border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]"
			style={{ paddingTop: "env(safe-area-inset-top)" }}
		>
			<div style={{ paddingLeft: "1.25rem", paddingRight: "1.25rem" }}>
				<div
					className="app-card flex items-center"
					style={{ height: 52 }}
				>
					{onBack && (
						<button
							type="button"
							onClick={onBack}
							aria-label="뒤로"
							className="flex items-center justify-center text-[#0f1724] dark:text-white"
							style={{
								width: 40,
								height: 40,
								// 아이콘(26px) 내부 여백(7px)만큼 당겨 글리프 좌측이 본문 거터선에 정렬
								marginLeft: -7,
								background: "none",
								border: "none",
								cursor: "pointer",
							}}
						>
							<ChevronLeft size={26} strokeWidth={2.2} />
						</button>
					)}
					{logo ? (
						<img
							src="logo.png"
							className="h-7 w-auto object-contain dark:[filter:brightness(0)_invert(1)]"
							alt="콕타임"
							style={{ marginLeft: onBack ? 2 : 0 }}
						/>
					) : (
						<h1
							className="text-[#0f1724] dark:text-white truncate"
							style={{ fontSize: 18, fontWeight: 800, marginLeft: onBack ? 4 : 0 }}
						>
							{title}
						</h1>
					)}
					<div className="flex-1" />
					{right && <div className="flex items-center gap-0.5">{right}</div>}
				</div>
			</div>
		</header>
	);
}
