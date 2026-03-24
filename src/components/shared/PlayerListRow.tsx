import type { CSSProperties, ReactNode } from "react";
import type { SessionPlayer } from "../../types";
import { skillScore } from "../../lib/teamSelection";
import PlayerBadge from "./PlayerBadge";

interface PlayerListRowProps {
	player: SessionPlayer;
	isPlaying: boolean;
	onClick: () => void;
	/** PlayerBadge 앞에 렌더할 슬롯 (선택 순서 원 등) */
	leading?: ReactNode;
	/** PlayerBadge 바로 뒤, 경기수 앞에 렌더할 슬롯 (스킬 스코어 등) */
	afterBadge?: ReactNode;
	/** 경기수 자리에 대신 표시할 커스텀 라벨 (없으면 기본 "N회") */
	infoLabel?: ReactNode;
	/** 상태뱃지 앞에 렌더할 슬롯 */
	beforeTrailing?: ReactNode;
	/** 버튼 추가 스타일 (선택 상태 border/background 등) */
	buttonStyle?: CSSProperties;
	/** 버튼 disabled */
	disabled?: boolean;
}

const STATUS_BADGE_PLAYING: CSSProperties = {
	fontSize: 10,
	fontWeight: 600,
	color: "#34c759",
	background: "rgba(52,199,89,0.1)",
	borderRadius: 4,
	padding: "2px 7px",
};

const STATUS_BADGE_WAITING: CSSProperties = {
	fontSize: 10,
	fontWeight: 600,
	color: "#0b84ff",
	background: "rgba(11,132,255,0.1)",
	borderRadius: 4,
	padding: "2px 7px",
};

export default function PlayerListRow({
	player,
	isPlaying,
	onClick,
	leading,
	afterBadge,
	infoLabel,
	beforeTrailing,
	buttonStyle,
	disabled,
}: PlayerListRowProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="hover:bg-[rgba(0,0,0,0.03)] dark:hover:bg-[rgba(255,255,255,0.06)] transition-colors"
			style={{
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "8px 10px",
				borderRadius: 8,
				border: "2px solid transparent",
				background: "transparent",
				cursor: "pointer",
				width: "100%",
				textAlign: "left",
				...buttonStyle,
			}}
		>
			{leading}

			<PlayerBadge
				name={player.name}
				gender={player.gender}
				skillScore={skillScore(player)}
			/>

			{afterBadge}

			{/* 정보 라벨 (기본: 경기수) */}
			<span style={{ fontSize: 11, fontWeight: 500, color: "#98a0ab" }}>
				{infoLabel ?? `${player.gameCount}회`}
			</span>

			<span style={{ flex: 1 }} />

			{beforeTrailing}

			{/* 상태 뱃지 */}
			<span style={isPlaying ? STATUS_BADGE_PLAYING : STATUS_BADGE_WAITING}>
				{isPlaying ? "경기중" : "대기"}
			</span>
		</button>
	);
}
