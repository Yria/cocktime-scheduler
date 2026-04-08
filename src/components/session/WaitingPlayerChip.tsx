import { memo } from "react";
import type { SessionPlayer } from "../../types";
import { skillScore } from "../../lib/teamSelection";
import PlayerCard from "../shared/PlayerCard";

interface WaitingPlayerChipProps {
	player: SessionPlayer;
	isMixedSingle: boolean;
	onToggleResting: (playerId: string) => void;
}

const WaitingPlayerChip = memo(function WaitingPlayerChip({
	player: p,
	isMixedSingle,
	onToggleResting,
}: WaitingPlayerChipProps) {
	const score = skillScore(p);

	return (
		<div style={{ position: "relative" }}>
			<PlayerCard
				name={p.name}
				gender={p.gender}
				skillScore={isMixedSingle ? undefined : score}
				size="sm"
				onClick={() => onToggleResting(p.id)}
			/>
			{p.gameCount > 0 && (
				<span
					style={{
						position: "absolute",
						top: -4,
						right: -4,
						background: "#ff9500",
						color: "#fff",
						fontSize: 9,
						fontWeight: 700,
						borderRadius: 8,
						padding: "1px 5px",
						lineHeight: "14px",
					}}
				>
					{p.gameCount}
				</span>
			)}
		</div>
	);
});

export default WaitingPlayerChip;
