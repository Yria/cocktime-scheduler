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
	// 본문은 문서(body)가 아니라 자체 스크롤 컨테이너에서 스크롤/바운스한다. 그래야 iOS 오버스크롤
	// 바운스가 이 컨테이너 안에서만 일어나고, 바깥의 네비(AppHeader)는 진짜로 고정된다. P2R 도 이
	// 컨테이너 기준(scrollTop)으로 감지한다.
	const scrollRef = useRef<HTMLDivElement>(null);
	const { pull, refreshing } = usePullToRefresh(scrollRef, onRefresh);

	// 네비 높이 = safe-area-top + inner 52 + border 1. 인디케이터를 이 지점(네비 바로 아래)에 앵커.
	const NAV_H = "calc(env(safe-area-inset-top) + 53px)";

	return (
		// app-shell-h: 고정 높이 셸(100dvh/설치형 100lvh) + position:relative. 셸 자체는 스크롤하지 않고
		// 내부 컨테이너만 스크롤 → 네비 고정. (로그·회원관리와 동일 패턴)
		<div className="app-shell-h flex flex-col overflow-hidden bg-[#fafbff] dark:bg-[#0f172a]">
			<AppHeader title={title} onBack={onBack} logo={logo} right={right} />
			{/* 당김/새로고침 인디케이터 — 네비 바로 아래(네비-본문 사이)에 셸 기준 절대배치. 당기면 내부
			    컨테이너가 바운스로 내려가며 이 자리에 스피너가 드러난다. 네비·셸은 안 움직이므로 중복/이동 없음. */}
			<div
				className="absolute left-0 right-0 flex justify-center pointer-events-none z-40"
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
				ref={scrollRef}
				className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${contentClassName ?? ""}`}
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
