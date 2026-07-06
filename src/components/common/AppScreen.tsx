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
			{/* 당김/새로고침 인디케이터 — 헤더 바로 아래 고정 오버레이. 콘텐츠 이동은 네이티브
			    오버스크롤 바운스가 담당하고(usePullToRefresh 가 preventDefault 안 함), 스피너만
			    여기서 당김 진행도/새로고침 상태로 표시한다. 헤더 아래에 두어 두 상태에서 겹치지 않는다. */}
			<div
				className="fixed left-0 right-0 flex justify-center pointer-events-none z-40"
				style={{
					top: "calc(env(safe-area-inset-top) + 60px)",
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
