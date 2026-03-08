import type { SessionPlayer } from "../../types";
import PlayerBadge from "./PlayerBadge";
import { skillScore } from "../../lib/teamGenerator";

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
					<button
						key={player.id}
						type="button"
						onClick={() => onReplace(player)}
						className="glass-item hover:bg-[rgba(0,0,0,0.02)] dark:hover:bg-[rgba(255,255,255,0.08)] transition-colors"
						style={{
							border: "none",
							background: "transparent",
							cursor: "pointer",
							padding: 0,
							position: "relative",
						}}
					>
						<div style={{ position: "relative" }}>
							<PlayerBadge
								name={player.name}
								gender={player.gender}
								skillScore={skillScore(player)}
							/>
							{matchCount > 0 && (
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
							)}
						</div>
						<div
							style={{
								fontSize: 10,
								color: "#98a0ab",
								marginTop: 4,
								fontWeight: 500,
							}}
						>
							경기 {player.gameCount}회
						</div>
					</button>
				))}
			</div>
		</div>
	);
}
