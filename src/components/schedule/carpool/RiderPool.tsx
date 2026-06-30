import type { CarpoolMember } from "../../../lib/supabase/carpool";

// 미배정 동승자(탑승필요) 풀 — 동(洞)별로 묶고, 거주지 없는 사람은 '위치 미상' 그룹으로.
// 칩 탭 = 선택 토글(2탭 편성: 선택 후 운전자 카드의 '여기 태우기').

interface Props {
	riders: CarpoolMember[];
	selected: Set<string>;
	onToggle: (id: string) => void;
}

const UNKNOWN = "위치 미상";

export default function RiderPool({ riders, selected, onToggle }: Props) {
	if (riders.length === 0) {
		return (
			<div
				className="text-[#2c7a57]"
				style={{
					fontSize: 12.5,
					fontWeight: 700,
					padding: "10px 12px",
					borderRadius: 12,
					background: "rgba(44,122,87,0.1)",
				}}
			>
				✓ 모든 탑승필요자가 배정됐어요
			</div>
		);
	}

	// 동별 그룹핑(거주지 없는 사람은 '위치 미상')
	const groups = new Map<string, CarpoolMember[]>();
	for (const r of riders) {
		const key = r.residence?.trim() || UNKNOWN;
		const arr = groups.get(key);
		if (arr) arr.push(r);
		else groups.set(key, [r]);
	}
	// 위치 미상은 항상 마지막
	const ordered = Array.from(groups.entries()).sort(([a], [b]) =>
		a === UNKNOWN ? 1 : b === UNKNOWN ? -1 : a.localeCompare(b, "ko"),
	);

	return (
		<div className="flex flex-col gap-2.5">
			{ordered.map(([dong, members]) => (
				<div key={dong}>
					<div
						className="text-[#64748b] dark:text-[rgba(235,235,245,0.55)] mb-1.5 flex items-center gap-1.5"
						style={{ fontSize: 12, fontWeight: 800 }}
					>
						{dong === UNKNOWN ? `📍 ${UNKNOWN}` : dong}
						<span
							className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
							style={{ fontSize: 11, fontWeight: 700 }}
						>
							· {members.length}명
						</span>
					</div>
					<div className="flex flex-wrap gap-1.5">
						{members.map((r) => {
							const on = selected.has(r.member_id);
							return (
								<button
									key={r.member_id}
									type="button"
									onClick={() => onToggle(r.member_id)}
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 5,
										fontSize: 12.5,
										fontWeight: 700,
										padding: "6px 11px",
										borderRadius: 999,
										cursor: "pointer",
										color: on ? "#0a5cb0" : "#8a5712",
										background: on
											? "rgba(11,132,255,0.12)"
											: "rgba(180,118,43,0.13)",
										border: on
											? "2px solid #0b84ff"
											: "2px solid transparent",
									}}
								>
									{on && (
										<span
											style={{
												width: 15,
												height: 15,
												borderRadius: "50%",
												background: "#0b84ff",
												color: "#fff",
												fontSize: 9,
												fontWeight: 800,
												display: "grid",
												placeItems: "center",
											}}
										>
											✓
										</span>
									)}
									{r.name}
								</button>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}
