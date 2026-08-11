import { ChevronRight } from "lucide-react";
import { buildPlaceMapTarget, openPlaceMap } from "../../lib/kakaoMap";

interface Props {
	/** 회식 가게 이름(sessions.meal_place). 빈 값이면 아무것도 렌더하지 않는다. */
	name: string | null;
	/** 카카오 검색으로 고른 좌표(sessions.meal_place_lat/lng). 없으면 이름으로 지도 검색. */
	lat: number | null;
	lng: number | null;
	/**
	 * - `"segment"`: 일정 카드의 `.ctl-seg` 트랙 안 한 칸(flex:1) — 카풀 세그먼트와 같은 격자로 3등분된다.
	 * - `"pill"`: 트랙 밖 알약(안내 페이지, 미참석자 카드).
	 */
	variant?: "segment" | "pill";
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
	variant = "pill",
}: Props) {
	const label = name?.trim();
	if (!label) return null;
	const seg = variant === "segment";
	const target = buildPlaceMapTarget({ name: label, lat, lng });
	// 이름이 있으면 검색 URL 이 항상 생기지만, 타입상 null 가능이라 링크 없는 경우도 처리.
	if (!target) {
		return (
			<span
				className="text-muted truncate"
				style={
					seg
						? { flex: 1, fontSize: 12, fontWeight: 600, textAlign: "center" }
						: { fontSize: 13 }
				}
			>
				🍚 {label}
			</span>
		);
	}
	if (seg) {
		// 세그먼트 칸 — 버튼 형제와 같은 flex:1·폰트·라운드. 탭 가능함이 드러나게 링크색을 쓴다
		// (트랙 안에서 회색이면 비활성 버튼처럼 보인다). 좁은 칸이라 화살표는 생략하고 이름을 자른다.
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
				className="inline-flex items-center justify-center min-w-0 active:opacity-70 transition-opacity"
				style={{
					flex: 1,
					padding: "6px 4px",
					fontSize: 12,
					fontWeight: 600,
					borderRadius: 7,
					color: "#0b84ff",
					whiteSpace: "nowrap",
				}}
			>
				<span className="truncate">🍚 {label}</span>
			</a>
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
			style={{ fontSize: 13, fontWeight: 500, padding: "4px 12px" }}
		>
			<span className="truncate">🍚 {label}</span>
			<ChevronRight size={13} style={{ opacity: 0.65, flexShrink: 0 }} />
		</a>
	);
}
