import type { SessionPlayer } from "../../types";
import ClickablePlayerBadge from "./ClickablePlayerBadge";

interface PlayerGenderGroupProps {
	label: string;
	dotColor: string;
	players: { player: SessionPlayer; matchCount: number }[];
	onReplace: (player: SessionPlayer) => void;
}

export default function PlayerGenderGroup({
	label,
	dotColor,
	players,
	onReplace,
}: PlayerGenderGroupProps) {
	if (players.length === 0) return null;

	return (
		<div>
			<div className="flex items-center gap-2 mb-3">
				<span
					style={{
						width: 10,
						height: 10,
						borderRadius: "50%",
						background: dotColor,
						display: "inline-block",
					}}
				/>
				<h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
					{label} ({players.length})
				</h4>
			</div>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
				{players.map(({ player, matchCount }) => (
					<ClickablePlayerBadge
						key={player.id}
						player={player}
						onClick={() => onReplace(player)}
						className="glass-item hover:bg-[rgba(0,0,0,0.02)] dark:hover:bg-[rgba(255,255,255,0.08)] transition-colors"
						overlay={
							matchCount > 0 ? (
								<div
									style={{
										position: "absolute",
										top: -6,
										right: -6,
										fontSize: 9,
										fontWeight: 700,
										color: "#ff3b30",
										background: "#fff",
										borderRadius: "50%",
										width: 16,
										height: 16,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										border: "1.5px solid #ff3b30",
									}}
								>
									{matchCount}
								</div>
							) : undefined
						}
						caption={
							<div style={{ fontSize: 10, color: "#98a0ab", marginTop: 4, fontWeight: 500 }}>
								경기 {player.gameCount}회
							</div>
						}
					/>
				))}
			</div>
		</div>
	);
}
