import { SKILL_LEVEL_LABEL } from "../../lib/constants";
import type { SkillLevel } from "../../types";

const activeStyles: Record<SkillLevel, React.CSSProperties> = {
	O: {
		background: "linear-gradient(175deg,#38de72 0%,#28c75e 100%)",
		color: "#fff",
		border: "1px solid rgba(20,148,58,0.28)",
		boxShadow: "0 3px 10px rgba(40,199,94,0.28)",
	},
	V: {
		background: "linear-gradient(175deg,#ffd14a 0%,#f0b000 100%)",
		color: "#fff",
		border: "1px solid rgba(200,140,0,0.28)",
		boxShadow: "0 3px 10px rgba(240,176,0,0.28)",
	},
	X: {
		background: "rgba(110,110,130,0.32)",
		color: "#fff",
		border: "1px solid rgba(120,120,140,0.42)",
	},
};

export function SkillButton({
	level,
	active,
	onClick,
}: {
	level: SkillLevel;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			style={{
				flex: 1,
				padding: "6px 0",
				borderRadius: 10,
				fontSize: 12,
				fontWeight: 700,
				cursor: "pointer",
				transition: "all 0.15s",
				...(active
					? activeStyles[level]
					: {
							background: "rgba(241,245,249,1)",
							color: "#98a0ab",
							border: "1px solid rgba(0,0,0,0.04)",
						}),
			}}
		>
			{SKILL_LEVEL_LABEL[level]}
		</button>
	);
}
