import type { ReactNode } from "react";
import type { Gender } from "../../types";
import PlayerCard from "./PlayerCard";

export interface MatchPreviewPlayer {
	id: string;
	name: string;
	gender: Gender | string;
	skillScore?: number;
	disabled?: boolean;
	opacity?: number;
	overlay?: ReactNode;
	onClick?: (e: React.MouseEvent) => void;
}

interface Props {
	left: (MatchPreviewPlayer | null)[];
	right: (MatchPreviewPlayer | null)[];
	size?: "sm" | "md" | "lg";
}

const SIZES = {
	sm: { photo: 56, width: 68, fontSize: 10 },
	md: { photo: 72, width: 84, fontSize: 11 },
	lg: { photo: 88, width: 100, fontSize: 12 },
} as const;

function EmptySlot({ size = "sm" }: { size?: "sm" | "md" | "lg" }) {
	const s = SIZES[size];
	return (
		<div style={{ width: s.width, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
			<div
				style={{
					width: s.photo,
					height: s.photo,
					borderRadius: 12,
					border: "2px dashed rgba(128,128,128,0.25)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					color: "rgba(128,128,128,0.35)",
					fontSize: s.photo * 0.35,
				}}
			>
				+
			</div>
			<span style={{ fontSize: s.fontSize, lineHeight: 1.2, visibility: "hidden" }}>&nbsp;</span>
		</div>
	);
}

export default function MatchPreview({ left, right, size = "sm" }: Props) {
	const renderSlot = (item: MatchPreviewPlayer | null, key: string) => {
		if (!item) return <EmptySlot key={key} size={size} />;
		return (
			<div key={item.id} style={{ position: "relative", opacity: item.opacity ?? 1 }}>
				<PlayerCard
					name={item.name}
					gender={item.gender}
					skillScore={item.skillScore}
					size={size}
					disabled={item.disabled}
					onClick={item.onClick}
				/>
				{item.overlay}
			</div>
		);
	};

	return (
		<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
			<div style={{ display: "flex", gap: 2, flex: 1, justifyContent: "center" }}>
				{left.map((item, i) => renderSlot(item, `l${i}`))}
			</div>
			<span
				style={{
					fontSize: 8,
					fontWeight: 700,
					color: "var(--text-secondary)",
					background: "var(--mat-ultra-thin)",
					borderRadius: 99,
					padding: "1px 5px",
					flexShrink: 0,
					margin: "0 2px",
				}}
			>
				VS
			</span>
			<div style={{ display: "flex", gap: 2, flex: 1, justifyContent: "center" }}>
				{right.map((item, i) => renderSlot(item, `r${i}`))}
			</div>
		</div>
	);
}
