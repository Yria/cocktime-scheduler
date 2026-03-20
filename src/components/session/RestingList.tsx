import { memo, useMemo } from "react";
import type { SessionPlayer } from "../../types";
import { useSessionStore } from "../../store/sessionStore";
import SectionHeader from "../shared/SectionHeader";

const RestingList = memo(function RestingList() {
	const sessionPlayers = useSessionStore((s) => s.sessionPlayers);
	const restingIds = useSessionStore((s) => s.restingIds);
	const onToggleResting = useSessionStore((s) => s.toggleResting);

	const resting = useMemo(
		() => restingIds.map((id) => sessionPlayers.get(id)).filter((p): p is SessionPlayer => p !== undefined),
		[restingIds, sessionPlayers],
	);

	if (resting.length === 0) return null;

	return (
		<div>
			<SectionHeader
				icon={
					<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
						<circle cx="10" cy="10" r="7.5" stroke="#64748b" strokeWidth="1.5" />
						<rect x="7.5" y="6" width="1.8" height="8" rx="0.9" fill="#64748b" />
						<rect x="10.7" y="6" width="1.8" height="8" rx="0.9" fill="#64748b" />
					</svg>
				}
				iconBg="rgba(100,116,139,0.1)"
				iconSize={28}
				topPadding={24}
				title="휴식중"
				badge={
					<span
						className="text-[#64748b] dark:text-[rgba(235,235,245,0.5)] bg-[rgba(241,245,249,1)] dark:bg-[rgba(255,255,255,0.08)]"
						style={{ fontSize: 12, fontWeight: 600, borderRadius: 99, padding: "2px 8px" }}
					>
						{resting.length}명
					</span>
				}
			/>

			{/* Player chips */}
			<div
				style={{
					padding: "0 16px 16px",
					display: "flex",
					flexWrap: "wrap",
					gap: 8,
				}}
			>
				{resting.map((p) => (
					<button
						key={p.id}
						type="button"
						onClick={() => onToggleResting(p.id)}
						className="bg-[rgba(241,245,249,1)] dark:bg-[rgba(255,255,255,0.1)] text-[#98a0ab] dark:text-[rgba(235,235,245,0.75)] border border-[rgba(0,0,0,0.04)] dark:border-[rgba(255,255,255,0.08)]"
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
							borderRadius: 12,
							padding: "8px 12px",
							fontSize: 14,
							fontWeight: 500,
							cursor: "pointer",
						}}
					>
						<span
							style={{
								width: 7,
								height: 7,
								borderRadius: "50%",
								background: p.gender === "F" ? "#ff2d55" : "#007aff",
								flexShrink: 0,
								display: "inline-block",
							}}
						/>
						{p.name}
					</button>
				))}
			</div>
		</div>
	);
});

export default RestingList;
