// 회비 관리 카드의 공용 조각 — 컴포넌트 편. 스타일은 duesCardStyles(react-refresh 규칙상 파일을 가른다).

/** 진행 막대(회비·대관비 수납·수동 부과 수납 공용). */
export function Meter({ ratio, done }: { ratio: number; done: boolean }) {
	return (
		<div style={{ height: 7, borderRadius: 999, background: "rgba(120,120,128,0.16)", overflow: "hidden" }}>
			<i style={{ display: "block", height: "100%", width: `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`, background: done ? "#1c8a3b" : "#0b84ff", transition: "width 0.2s" }} />
		</div>
	);
}

/**
 * 카드 안에서 상세로 들어가는 링크(세션은 [정산 대조], 수동 부과는 [명단·수정]).
 * '›' 만으로 버튼임이 읽히므로 배경·강조색 없이 옆 글자와 같은 톤으로 둔다.
 */
export function MoreLink({ label, onClick }: { label: string; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="text-muted flex items-center"
			style={{ gap: 3, fontSize: 11.5, background: "none", border: "none", padding: "2px 0 2px 8px", cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}
		>
			{label}
			{/* '›' 는 글리프가 x-height 기준이라 한글과 나란히 두면 아래로 처진다.
			    lineHeight:1 로 자기 박스를 만들어 flex items-center 로 세로 가운데. */}
			<span aria-hidden style={{ fontSize: 14, lineHeight: 1, fontWeight: 600, display: "block" }}>›</span>
		</button>
	);
}

