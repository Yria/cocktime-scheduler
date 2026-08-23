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
 * 카드 안에서 '상세로 들어감'을 알리는 글자(`정산 대조 ›`). **누를 수 없다** — 부과 카드는
 * 카드 전체가 버튼이라(조작이 하나뿐) 안에 button 을 또 넣을 수 없기 때문.
 * '›' 만으로 읽히므로 배경·강조색 없이 옆 글자와 같은 톤으로 둔다.
 */
export function MoreHint({ label }: { label: string }) {
	return (
		<span className="text-muted flex items-center" style={{ gap: 3, fontSize: 11.5, flexShrink: 0, whiteSpace: "nowrap", paddingLeft: 8 }}>
			<Chevron label={label} />
		</span>
	);
}

function Chevron({ label }: { label: string }) {
	return (
		<>
			{label}
			{/* '›' 는 글리프가 x-height 기준이라 한글과 나란히 두면 아래로 처진다.
			    lineHeight:1 로 자기 박스를 만들어 flex items-center 로 세로 가운데. */}
			<span aria-hidden style={{ fontSize: 14, lineHeight: 1, fontWeight: 600, display: "block" }}>›</span>
		</>
	);
}

