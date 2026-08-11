import { ChevronRight } from "lucide-react";
import { buildPlaceMapTarget, openPlaceMap } from "../../lib/kakaoMap";

interface Props {
	/** 회식 가게 이름(sessions.meal_place). 빈 값이면 아무것도 렌더하지 않는다. */
	name: string | null;
	/** 카카오 검색으로 고른 좌표(sessions.meal_place_lat/lng). 없으면 이름으로 지도 검색. */
	lat: number | null;
	lng: number | null;
	/** true=일정 카드용 작은 pill, false=안내 페이지 본문용 인라인 텍스트. */
	compact?: boolean;
}

/**
 * 회식 가게 표시 + 지도 열기. 모임 장소(ScheduleCard 상단)와 같은 경로를 쓴다 —
 * 좌표가 있으면 그 지점 핀, 없으면 가게 이름으로 카카오맵 검색.
 * 모바일은 네이티브 앱 우선(openPlaceMap), 미설치면 웹으로 폴백.
 */
export default function MealPlaceLink({
	name,
	lat,
	lng,
	compact = false,
}: Props) {
	const label = name?.trim();
	if (!label) return null;
	const target = buildPlaceMapTarget({ name: label, lat, lng });
	// 이름이 있으면 검색 URL 이 항상 생기지만, 타입상 null 가능이라 링크 없는 경우도 처리.
	if (!target) {
		return (
			<span
				className="text-muted truncate"
				style={{ fontSize: compact ? 12.5 : 13 }}
			>
				🍚 {label}
			</span>
		);
	}
	return (
		<a
			href={target.webUrl}
			target="_blank"
			rel="noopener noreferrer"
			onClick={(e) => {
				e.stopPropagation();
				e.preventDefault();
				openPlaceMap(target);
			}}
			aria-label={`${label} 지도 열기`}
			className="text-muted inline-flex items-center gap-1 min-w-0 w-fit rounded-full bg-black/[0.05] dark:bg-white/[0.08] active:opacity-70 transition-opacity"
			style={{
				fontSize: compact ? 12 : 13,
				fontWeight: 500,
				padding: compact ? "3px 10px" : "4px 12px",
			}}
		>
			<span className="truncate">🍚 {label}</span>
			<ChevronRight
				size={compact ? 12 : 13}
				style={{ opacity: 0.65, flexShrink: 0 }}
			/>
		</a>
	);
}
