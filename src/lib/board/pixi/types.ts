import type { SessionPlayer } from "../../../types";
import type { StagePoint } from "../../../types/board";

export type BoardSource =
	| { kind: "free"; playerId: string }
	| { kind: "anchor"; playerId: string; teamId: string }
	| { kind: "ghost"; playerId: string; teamId: string; reservationId: string }
	| { kind: "playing"; playerId: string; courtId: number; matchId: string }
	| { kind: "team"; teamId: string }
	| { kind: "court"; courtId: number; matchId: string };

export interface MagnetAppearance {
	player: SessionPlayer;
	ghost: boolean;
	resting: boolean;
	cockPending: boolean;
}

export interface CardAppearance {
	fill: string;
	stroke: string;
	label: string;
	labelColor: string;
	labelBold: boolean;
	showVs: boolean;
	ctaLabel: string;
	ctaColor: string;
	ctaEnabled: boolean;
	showUnconfirm: boolean;
	showEdit: boolean;
	blink: boolean;
}

export interface MagnetView extends MagnetAppearance {
	kind: "magnet";
	key: string;
	source: BoardSource;
	point: StagePoint;
	draggable: boolean;
}

export interface CardView {
	kind: "card";
	key: string;
	source: Extract<BoardSource, { kind: "team" | "court" }>;
	point: StagePoint;
	draggable: boolean;
	appearance: CardAppearance;
	members: MagnetView[];
	emptySlots: number[];
	confirmed: boolean;
}

export type BoardEntity = MagnetView | CardView;

export interface BoardSnapshot {
	entities: BoardEntity[];
	isEditor: boolean;
}

export function sourceKey(source: BoardSource): string {
	switch (source.kind) {
		case "free": return `free:${source.playerId}`;
		case "anchor": return `anchor:${source.teamId}:${source.playerId}`;
		case "ghost": return `ghost:${source.reservationId}`;
		case "playing": return `playing:${source.courtId}:${source.matchId}:${source.playerId}`;
		case "team": return `team:${source.teamId}`;
		case "court": return `court:${source.courtId}:${source.matchId}`;
	}
}
