import { useMemo, useState } from "react";
import type { GeneratedTeam, SessionPlayer } from "../types";

interface UsePlayerReplaceParams {
	teams: GeneratedTeam[];
	sessionPlayers: Map<string, SessionPlayer>;
	onReplace: (index: number, oldPlayer: SessionPlayer, newPlayer: SessionPlayer) => void;
}

interface ReplacingPlayer {
	index: number;
	player: SessionPlayer;
}

export function usePlayerReplace({
	teams,
	sessionPlayers,
	onReplace,
}: UsePlayerReplaceParams) {
	const [replacingPlayer, setReplacingPlayer] = useState<ReplacingPlayer | null>(null);

	const handlePlayerClick = (index: number, player: SessionPlayer, e: React.MouseEvent | React.KeyboardEvent) => {
		e.stopPropagation();
		setReplacingPlayer({ index, player });
	};

	const handleReplace = (newPlayer: SessionPlayer) => {
		if (replacingPlayer) {
			onReplace(replacingPlayer.index, replacingPlayer.player, newPlayer);
			setReplacingPlayer(null);
		}
	};

	const cancelReplace = () => setReplacingPlayer(null);

	const getPlayerTeams = (
		index: number,
		player: SessionPlayer,
	) => {
		const team = teams[index];
		if (!team) return { currentTeam: [] as SessionPlayer[], opponentTeam: [] as SessionPlayer[] };
		const isInTeamA = team.teamA.includes(player.id);
		const toPlayers = (ids: [string, string]) =>
			ids.map((id) => sessionPlayers.get(id)).filter((p): p is SessionPlayer => p !== undefined);
		return {
			currentTeam: toPlayers(isInTeamA ? team.teamA : team.teamB),
			opponentTeam: toPlayers(isInTeamA ? team.teamB : team.teamA),
		};
	};

	// PlayerReplaceDialog에 spread로 전달할 수 있는 props 묶음
	const replaceDialogProps = useMemo(() => {
		if (!replacingPlayer) return null;
		const { currentTeam, opponentTeam } = getPlayerTeams(
			replacingPlayer.index,
			replacingPlayer.player,
		);
		return {
			selectedPlayer: replacingPlayer.player,
			currentTeam,
			opponentTeam,
			onReplace: handleReplace,
			onCancel: cancelReplace,
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [replacingPlayer, teams, sessionPlayers]);

	return {
		replacingPlayer,
		handlePlayerClick,
		handleReplace,
		cancelReplace,
		replaceDialogProps,
	};
}
