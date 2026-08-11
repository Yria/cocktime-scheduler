import { ChevronRight } from "lucide-react";
import { buildPlaceMapTarget, openPlaceMap } from "../../lib/kakaoMap";

interface Props {
	/** 회식 가게 이름(sessions.meal_place). 빈 값이면 아무것도 렌더하지 않는다. */
	name: string | null;
	/** 카카오 검색으로 고른 좌표(sessions.meal_place_lat/lng). 없으면 이름으로 지도 검색. */
	lat: number | null;
	lng: number | null;
	/**
	 * - `"card"`: 일정 카드 — 세그먼트 트랙 **밖**의 알약이지만 `flex:1` 로 3등분 격자의 한 칸 폭을 차지한다.
	 * - `"page"`(기본): 내용 폭 알약(정모 안내 페이지, 미참석자 카드).
	 */
	variant?: "card" | "page";
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
	variant = "page",
}: Props) {
	const label = name?.trim();
	if (!label) return null;
	const card = variant === "card";
	const target = buildPlaceMapTarget({ name: label, lat, lng });
	// 이름이 있으면 검색 URL 이 항상 생기지만, 타입상 null 가능이라 링크 없는 경우도 처리.
	if (!target) {
		return (
			<span
				className="text-muted truncate"
				style={card ? { flex: 1, fontSize: 12.5 } : { fontSize: 13 }}
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
			className={`text-muted inline-flex items-center gap-1 min-w-0 rounded-full bg-black/[0.05] dark:bg-white/[0.08] active:opacity-70 transition-opacity ${
				card ? "justify-center" : "w-fit"
			}`}
			style={
				card
					? // 세그먼트 트랙 밖의 알약. flex:1 로 3등분 격자의 한 칸 폭을 차지하고,
						// 세로 padding 은 세그먼트 버튼(6px)과 같게 맞춰 줄 높이가 흔들리지 않게 한다.
						{ flex: 1, fontSize: 12, fontWeight: 500, padding: "6px 10px" }
					: { fontSize: 13, fontWeight: 500, padding: "4px 12px" }
			}
		>
			<span className="truncate">🍚 {label}</span>
			<ChevronRight
				size={card ? 12 : 13}
				style={{ opacity: 0.65, flexShrink: 0 }}
			/>
		</a>
	);
}
