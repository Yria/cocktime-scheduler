import type { ReactNode } from "react";

interface SectionHeaderProps {
	icon: ReactNode;
	iconBg: string;
	iconSize?: number;
	title: string;
	badge?: ReactNode;
	rightContent?: ReactNode;
	topPadding?: number;
}

export default function SectionHeader({
	icon,
	iconBg,
	iconSize = 24,
	title,
	badge,
	rightContent,
	topPadding = 16,
}: SectionHeaderProps) {
	const borderRadius = iconSize >= 28 ? 8 : 6;

	return (
		<div
			style={{
				padding: `${topPadding}px 16px 10px 16px`,
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<div
					style={{
						width: iconSize,
						height: iconSize,
						borderRadius,
						background: iconBg,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						flexShrink: 0,
					}}
				>
					{icon}
				</div>
				<span
					className="text-[#0f1724] dark:text-white"
					style={{ fontSize: iconSize >= 28 ? 16 : 15, fontWeight: 600 }}
				>
					{title}
				</span>
			</div>
			{(badge || rightContent) && (
				<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
					{badge}
					{rightContent}
				</div>
			)}
		</div>
	);
}
