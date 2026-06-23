import { useRef } from "react";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";
import Spinner from "../shared/Spinner";
import AppHeader from "./AppHeader";

interface Props {
	title?: string;
	onBack?: () => void;
	logo?: boolean;
	right?: React.ReactNode;
	/** 당겨서 새로고침 동작(기본: location.reload). 재쿼리(Promise) 시 완료까지 인디케이터 유지. */
	onRefresh?: () => void | Promise<void>;
	/** 콘텐츠 래퍼에 추가할 클래스(기본 패딩 외 커스텀). */
	contentClassName?: string;
	children: React.ReactNode;
}

/**
 * 앱 셸 — 고정 헤더(AppHeader) + 스크롤 영역(main). 헤더는 스크롤되지 않고 main 만 스크롤된다
 * (overscroll-contain 으로 body 바운스 차단 → "아래로 당기면 상단도 내려오는" 문제 해결).
 * main 최상단에서 당기면 pull-to-refresh(usePullToRefresh)로 새로고침한다.
 */
export default function AppScreen({
	title,
	onBack,
	logo,
	right,
	onRefresh,
	contentClassName,
	children,
}: Props) {
	const scrollRef = useRef<HTMLElement>(null);
	const { pull, refreshing } = usePullToRefresh(scrollRef, onRefresh);

	return (
		<div
			className="flex flex-col bg-[#fafbff] dark:bg-[#0f172a]"
			// iOS PWA에서 100dvh 는 콜드스타트 시 잘못된(작은) 값을 보고해 하단 home
			// indicator 영역만큼 짧아진다 → 내부 스크롤 영역이 그만큼 안 그려진다.
			// position:fixed; inset:0 은 layout viewport(safe-area 포함) 전체를 안정적으로 덮는다.
			style={{ position: "fixed", inset: 0 }}
		>
			<AppHeader title={title} onBack={onBack} logo={logo} right={right} />
			<main
				ref={scrollRef}
				className="flex-1 overflow-y-auto overscroll-contain relative"
				style={{ WebkitOverflowScrolling: "touch" }}
			>
				{/* 당김 인디케이터 — 당김 거리만큼 상단에 스피너 노출 */}
				<div
					className="absolute left-0 right-0 flex items-end justify-center pointer-events-none z-10"
					style={{
						top: 0,
						height: pull,
						paddingBottom: 8,
						opacity: pull > 8 ? 1 : 0,
						transition: refreshing ? "none" : "height 0.2s ease, opacity 0.2s ease",
					}}
				>
					<div
						style={{
							transform: refreshing ? undefined : `rotate(${pull * 3}deg)`,
							opacity: 0.7,
						}}
					>
						<Spinner size={18} />
					</div>
				</div>
				<div
					className={contentClassName}
					style={{
						transform: pull > 0 ? `translateY(${pull}px)` : undefined,
						transition:
							refreshing || pull === 0 ? "transform 0.2s ease" : "none",
						padding: "1.25rem",
						paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
					}}
				>
					{children}
				</div>
			</main>
		</div>
	);
}
