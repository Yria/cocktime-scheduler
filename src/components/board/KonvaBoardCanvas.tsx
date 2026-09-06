import { useMemo } from "react";
import { Layer, Stage } from "react-konva";
import { useShallow } from "zustand/react/shallow";
import { useBoardStore } from "../../store/boardStore";
import { useSessionStore } from "../../store/sessionStore";
import { playingIdsFromCourts } from "../../lib/board/membership";
import { TEAM_W, TEAM_BOX_ABOVE } from "../../lib/board/constants";
import PlayerMagnet from "./PlayerMagnet";
import TeamBackground from "./TeamBackground";
import CourtMatchCard from "./CourtMatchCard";
import type { BoardRendererProps } from "./SessionBoardRenderer";

/** Temporary compatibility backend. Session effects stay in the shared DOM shell. */
export default function KonvaBoardCanvas(props: BoardRendererProps) {
	const courts = useSessionStore((s) => s.courts);
	const restingIds = useSessionStore((s) => s.restingIds);
	const playingIds = useMemo(() => playingIdsFromCourts(courts), [courts]);
	const resting = useMemo(() => new Set(restingIds), [restingIds]);
	const freeIds = useBoardStore(useShallow((s) => [...s.magnets.values()].filter((m) => m.teamId === null).map((m) => m.playerId)));
	const drafts = useBoardStore(useShallow((s) => [...s.drafts.keys()]));
	return <Stage width={props.width} height={props.height} scaleX={props.scale} scaleY={props.scale}
		onWheel={props.onStageWheel} onTouchMove={props.onStageTouchMove} onTouchEnd={props.onStageTouchEnd}>
		<Layer>
			{drafts.map((id) => <TeamBackground key={id} teamId={id} hasEmptyCourt={courts.some((c) => !c.match)} playingIds={playingIds}
				onMagnetDragEnd={props.onMagnetDragEnd} onGhostDragEnd={props.onGhostDragEnd} onMagnetDragMove={props.onMagnetDragMove} onSlotClick={props.onSlotClick} />)}
			{freeIds.filter((id) => !playingIds.has(id)).map((id) => <PlayerMagnet key={id} playerId={id} resting={resting.has(id)}
				onDragEnd={props.onMagnetDragEnd} onDragMove={props.onMagnetDragMove} onClick={props.onMagnetClick} onCockCheck={props.onCockCheck} />)}
			{courts.filter((c) => c.match).map((court, i) => <CourtMatchCard key={court.id} court={court}
				x={TEAM_W / 2 + 12 + i * (TEAM_W + 20)} y={TEAM_BOX_ABOVE + 8} onEditMatch={props.onEditMatch} />)}
		</Layer>
	</Stage>;
}
