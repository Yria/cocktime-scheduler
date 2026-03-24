import type { ReactNode } from "react";
import type { SessionPlayer } from "../../types";
import { skillScore } from "../../lib/teamSelection";
import PlayerBadge from "./PlayerBadge";

interface ClickablePlayerBadgeProps {
	player: SessionPlayer;
	onClick: (e: React.MouseEvent | React.KeyboardEvent) => void;
	isUnavailable?: boolean;
	/** PlayerBadge 위에 절대 위치로 렌더할 오버레이 (matchCount 뱃지 등) */
	overlay?: ReactNode;
	/** 뱃지 아래 추가 텍스트 (경기 횟수 레이블 등) */
	caption?: ReactNode;
	/** 버튼에 추가할 className */
	className?: string;
}

export default function ClickablePlayerBadge({
	player,
	onClick,
	isUnavailable = false,
	overlay,
	caption,
	className,
}: ClickablePlayerBadgeProps) {
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onClick(e);
		}
	};

	return (
		<button
			type="button"
			onClick={onClick}
			onKeyDown={handleKeyDown}
			tabIndex={0}
			className={className}
			style={{
				border: "none",
				background: "transparent",
				cursor: "pointer",
				padding: 0,
				position: "relative",
				display: "inline-flex",
				flexDirection: "column",
				alignItems: "center",
			}}
		>
			<div style={{ position: "relative" }}>
				<PlayerBadge
					name={player.name}
					gender={player.gender}
					skillScore={skillScore(player)}
					isUnavailable={isUnavailable}
				/>
				{overlay}
			</div>
			{caption}
		</button>
	);
}
