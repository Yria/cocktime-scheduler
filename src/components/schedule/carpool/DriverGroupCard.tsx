import PlayerAvatar from "../../shared/PlayerAvatar";
import type { CarpoolMember } from "../../../lib/supabase/carpool";

// 운전자 1명 + 그 차에 배정된 동승자 칩. 선택된 동승자가 있으면 '여기 태우기' 노출.
// 단 지도로 배정 가능한 상태(showAssignButton=false)면 버튼을 숨기고 지도 마커 탭으로 배정한다.

interface Props {
	driver: CarpoolMember;
	riders: CarpoolMember[];
	selectedCount: number;
	/** 지도가 없어 지도 배정이 불가할 때만 '여기 태우기' 버튼 노출(기본 true) */
	showAssignButton?: boolean;
	onAssignSelected: () => void;
	onRemoveRider: (riderId: string) => void;
}

export default function DriverGroupCard({
	driver,
	riders,
	selectedCount,
	showAssignButton = true,
	onAssignSelected,
	onRemoveRider,
}: Props) {
	const count =
		driver.seats != null
			? `${riders.length}/${driver.seats}`
			: `${riders.length}명`;
	const over = driver.seats != null && riders.length > driver.seats;

	return (
		<div
			className="bg-white dark:bg-[rgba(30,30,35,0.6)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.1)]"
			style={{ borderRadius: 14, padding: 12 }}
		>
			<div className="flex items-center gap-2.5">
				<PlayerAvatar name={driver.name} gender={driver.gender} size={34} />
				<div className="min-w-0 flex-1">
					<div
						className="text-strong truncate"
						style={{ fontSize: 14, fontWeight: 800 }}
					>
						🚗 {driver.name}
					</div>
					<div
						className="text-faint"
						style={{ fontSize: 11.5 }}
					>
						{driver.residence ?? "동네 미상"}
					</div>
				</div>
				<span
					style={{
						fontSize: 11.5,
						fontWeight: 800,
						padding: "4px 9px",
						borderRadius: 999,
						whiteSpace: "nowrap",
						fontVariantNumeric: "tabular-nums",
						color: over ? "#b4762b" : "#2c7a57",
						background: over ? "rgba(180,118,43,0.14)" : "rgba(44,122,87,0.13)",
					}}
				>
					{count}
				</span>
			</div>

			{riders.length > 0 && (
				<div className="flex flex-wrap gap-1.5 mt-2.5">
					{riders.map((r) => (
						<button
							key={r.member_id}
							type="button"
							onClick={() => onRemoveRider(r.member_id)}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 5,
								fontSize: 12.5,
								fontWeight: 700,
								padding: "5px 8px 5px 10px",
								borderRadius: 999,
								border: "none",
								cursor: "pointer",
								color: "#145e3d",
								background: "rgba(44,122,87,0.13)",
							}}
						>
							{r.name}
							<span style={{ color: "#98a0ab", fontWeight: 800, fontSize: 13 }}>
								×
							</span>
						</button>
					))}
				</div>
			)}

			{selectedCount > 0 && showAssignButton && (
				<button
					type="button"
					onClick={onAssignSelected}
					style={{
						width: "100%",
						marginTop: 11,
						padding: "9px",
						borderRadius: 11,
						fontSize: 13,
						fontWeight: 800,
						border: "none",
						cursor: "pointer",
						color: "#2c7a57",
						background: "rgba(44,122,87,0.13)",
					}}
				>
					＋ 선택한 {selectedCount}명 여기 태우기
				</button>
			)}
		</div>
	);
}
