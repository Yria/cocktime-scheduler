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
 * 앱 셸 — sticky 헤더(AppHeader) + body 자연 스크롤. 고정높이/내부 overflow 없이 일반 웹처럼
 * 문서가 스크롤되므로 iOS safe-area 뷰포트 곡예가 불필요하다(헤더 padding-top·콘텐츠 padding-bottom
 * 의 env() 로만 안전영역 처리). 최상단에서 당기면 pull-to-refresh(usePullToRefresh)로 새로고침.
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
	const rootRef = useRef<HTMLDivElement>(null);
	const { pull, refreshing } = usePullToRefresh(rootRef, onRefresh);

	return (
		<div
			ref={rootRef}
			className="min-h-[100dvh] bg-[#fafbff] dark:bg-[#0f172a]"
		>
			<AppHeader title={title} onBack={onBack} logo={logo} right={right} />
			<div className="relative">
				{/* 당김 인디케이터 — 당김 거리만큼 헤더 아래에 스피너 노출 */}
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
			</div>
		</div>
	);
}
