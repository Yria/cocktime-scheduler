import type { MatchLogEntry } from "../../lib/supabase/api";
import type { Gender, PlayerSkills, SkillLevel } from "../../types";

// PlayerSkills 객체를 직접 받는 로컬 헬퍼 (skillScore는 SessionPlayer를 받으므로 별도 유지)
const SKILL_VALUES: Record<SkillLevel, number> = { O: 3, V: 2, X: 1 };
function getSkillScore(skills: PlayerSkills): number {
	const values = Object.values(skills) as SkillLevel[];
	return values.reduce((sum, s) => sum + SKILL_VALUES[s], 0) / values.length;
}

interface Participant {
	name: string;
	gender: Gender;
	game_count: number;
	skills: PlayerSkills;
}

interface MatchSummaryProps {
	logs: MatchLogEntry[];
	participants: Participant[];
}

export default function MatchSummary({
	logs,
	participants,
}: MatchSummaryProps) {
	return (
		<div
			className="flex-shrink-0 bg-white dark:bg-[#1c1c1e] border-b border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)]"
			style={{
				padding: "12px 16px",
				display: "flex",
				flexDirection: "column",
				gap: 10,
			}}
		>
			{/* Match count */}
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<span className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.5)]" style={{ fontSize: 12, fontWeight: 500 }}>
					총 경기
				</span>
				<span
					style={{
						fontSize: 13,
						fontWeight: 700,
						color: "#0b84ff",
						background: "rgba(11,132,255,0.08)",
						borderRadius: 6,
						padding: "2px 8px",
					}}
				>
					{logs.length}회
				</span>
			</div>

			{/* Participant list */}
			{participants.length > 0 && (
				<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
					<span className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.5)]" style={{ fontSize: 12, fontWeight: 500 }}>
						참가자 {participants.length}명
					</span>
					<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
						{participants.map((p) => {
							// 스킬 스코어 기반 그라데이션 배경
							const score = getSkillScore(p.skills);
							const scorePercent = ((score - 1.0) / 2.0) * 100;
							const baseColorLight = p.gender === "F" ? "#fee2e2" : "#e0f2fe";
							const baseColorDark = p.gender === "F" ? "#fca5a5" : "#7dd3fc";
							const backgroundGradient = `linear-gradient(to right, ${baseColorDark} 0%, ${baseColorDark} ${scorePercent}%, ${baseColorLight} ${scorePercent}%, ${baseColorLight} 100%)`;

							return (
								<div
									key={p.name}
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 5,
										padding: "4px 10px",
										background: backgroundGradient,
										borderRadius: 14,
										fontSize: 13,
										color: p.gender === "F" ? "#991b1b" : "#075985",
										fontWeight: 600,
									}}
								>
									{p.name}
									<span
										style={{
											marginLeft: 2,
											fontSize: 11,
											fontWeight: 700,
											color: p.gender === "F" ? "#be123c" : "#0369a1",
											background:
												p.gender === "F"
													? "rgba(190,18,60,0.1)"
													: "rgba(3,105,161,0.1)",
											borderRadius: 8,
											padding: "1px 5px",
										}}
									>
										{p.game_count}
									</span>
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
