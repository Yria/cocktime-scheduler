import { memo, useMemo } from "react";
import { useAppStore } from "../../store/appStore";
import { useSessionStore } from "../../store/sessionStore";
import SectionHeader from "../shared/SectionHeader";
import WaitingPlayerChip from "./WaitingPlayerChip";

const EMPTY_SINGLE_WOMAN_IDS: string[] = [];

const STYLES = `
.wl-chip {
  display: flex;
  align-items: center;
  background: rgba(255,255,255,0.72);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.55);
  border-radius: 14px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  overflow: hidden;
  transition: transform 0.18s cubic-bezier(0.25,1,0.5,1), box-shadow 0.18s ease;
  position: relative;
}
.wl-chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.06);
}
.wl-chip.mixed-single {
  background: rgba(255,149,0,0.07);
  border-color: rgba(255,149,0,0.35);
  box-shadow: 0 2px 8px rgba(255,149,0,0.1);
}
.dark .wl-chip {
  background: rgba(44,44,46,0.9);
  border-color: rgba(255,255,255,0.12);
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}
.dark .wl-chip.mixed-single {
  background: rgba(255,149,0,0.15);
  border-color: rgba(255,149,0,0.3);
}
.wl-chip-gradient {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  border-radius: 14px;
}
.wl-name-btn {
  padding: 7px 4px 7px 10px;
  font-size: 14px;
  font-weight: 600;
  color: #1f2937;
  cursor: pointer;
  background: none;
  border: none;
  display: flex;
  align-items: center;
  gap: 6px;
  letter-spacing: -0.01em;
  transition: opacity 0.1s;
  position: relative;
  z-index: 1;
}
.dark .wl-name-btn {
  color: rgba(255,255,255,0.95);
}
.wl-name-btn:active {
  opacity: 0.55;
}
.wl-gender-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.wl-game-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 99px;
  background: rgba(255,149,0,0.12);
  color: #b06000;
  letter-spacing: 0.01em;
}
.dark .wl-game-badge {
  background: rgba(255,149,0,0.2);
  color: #ff9f0a;
}
`;

const WaitingList = memo(function WaitingList() {
	const sessionPlayers = useSessionStore((s) => s.sessionPlayers);
	const waitingIds = useSessionStore((s) => s.waitingIds);
	const singleWomanIds =
		useAppStore((s) => s.sessionMeta?.singleWomanIds) ?? EMPTY_SINGLE_WOMAN_IDS;
	const onToggleResting = useSessionStore((s) => s.toggleResting);
	const totalCount = useSessionStore((s) => s.sessionPlayers.size);

	const waiting = useMemo(
		() =>
			waitingIds
				.map((id) => sessionPlayers.get(id))
				.filter(
					(p): p is import("../../types").SessionPlayer => p !== undefined,
				),
		[waitingIds, sessionPlayers],
	);

	return (
		<div>
			<style>{STYLES}</style>

			<SectionHeader
				icon={
					<svg
						width="16"
						height="16"
						viewBox="0 0 20 20"
						fill="none"
						aria-hidden="true"
					>
						<circle cx="7" cy="6" r="2.5" stroke="#007aff" strokeWidth="1.6" />
						<circle cx="13" cy="6" r="2.5" stroke="#007aff" strokeWidth="1.6" />
						<path
							d="M2 17c0-3 2.2-4.5 5-4.5h6c2.8 0 5 1.5 5 4.5"
							stroke="#007aff"
							strokeWidth="1.6"
							strokeLinecap="round"
						/>
					</svg>
				}
				iconBg="rgba(0,122,255,0.1)"
				iconSize={28}
				topPadding={24}
				title="대기 명단"
				badge={
					<div style={{ display: "flex", alignItems: "center", gap: 5 }}>
						<span
							style={{
								fontSize: 11,
								fontWeight: 600,
								color: "#8e8e93",
								background: "rgba(0,0,0,0.04)",
								borderRadius: 99,
								padding: "2px 8px",
							}}
						>
							{waiting.length} 명 / 총 {totalCount} 명
						</span>
					</div>
				}
			/>

			{/* Player chips */}
			{waiting.length === 0 ? (
				<p
					style={{
						padding: "4px 16px 16px",
						fontSize: 13,
						color: "#98a0ab",
						fontStyle: "italic",
					}}
				>
					대기 중인 선수가 없습니다
				</p>
			) : (
				<div
					style={{
						padding: "0 16px 14px",
						display: "flex",
						flexWrap: "wrap",
						gap: 7,
					}}
				>
					{waiting.map((p) => {
						const isMixedSingle =
							p.gender === "F" &&
							(p.allowMixedSingle || singleWomanIds.includes(p.playerId));

						return (
							<WaitingPlayerChip
								key={p.id}
								player={p}
								isMixedSingle={isMixedSingle}
								onToggleResting={onToggleResting}
							/>
						);
					})}
				</div>
			)}
		</div>
	);
});

export default WaitingList;
