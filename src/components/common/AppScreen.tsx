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

	// 네비 높이 = safe-area-top + inner 52 + border 1. 네비를 fixed 로 흐름에서 빼므로
	// 본문은 이만큼 아래에서 시작하고, 인디케이터도 이 지점(네비 바로 아래)에 고정한다.
	const NAV_H = "calc(env(safe-area-inset-top) + 53px)";

	return (
		<div
			ref={rootRef}
			className="min-h-[100dvh] bg-[#fafbff] dark:bg-[#0f172a]"
			style={{ paddingTop: NAV_H }}
		>
			{/* 네비를 fixed 로 고정 — iOS 오버스크롤 시 본문(문서)만 바운스로 내려가고 네비는 안 움직인다. */}
			<AppHeader
				title={title}
				onBack={onBack}
				logo={logo}
				right={right}
				positioning="fixed"
			/>
			{/* 당김/새로고침 인디케이터 — 네비 바로 아래(본문과의 사이)에 고정. 당기면 네이티브 바운스로
			    본문이 내려가며 네비 아래 gap 이 열리고, 그 자리에 스피너가 드러난다(콘텐츠 위 z-40). */}
			<div
				className="fixed left-0 right-0 flex justify-center pointer-events-none z-40"
				style={{
					top: NAV_H,
					paddingTop: 10,
					opacity: pull > 8 || refreshing ? 1 : 0,
					transform: `translateY(${refreshing ? 0 : Math.min(pull, 24) - 24}px)`,
					transition: refreshing
						? "none"
						: "opacity 0.2s ease, transform 0.2s ease",
				}}
			>
				<div className="rounded-full bg-white/85 dark:bg-white/10 shadow-sm p-1.5 backdrop-blur-sm">
					<div
						style={{
							transform: refreshing ? undefined : `rotate(${pull * 3}deg)`,
						}}
					>
						<Spinner size={18} />
					</div>
				</div>
			</div>
			<div
				className={contentClassName}
				style={{
					padding: "1.25rem",
					paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
				}}
			>
				{children}
			</div>
		</div>
	);
}
