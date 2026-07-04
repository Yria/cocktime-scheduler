import { useMemo, useState } from "react";
import { fmtRange } from "../../../lib/schedule/timeFmt";
import type { SessionRow } from "../../../lib/supabase/types";
import ModalSheet from "../../common/ModalSheet";
import {
	type AnnounceGroup,
	autoHeader,
	buildAnnouncement,
	DEFAULT_FOOTER,
} from "./announcementText";
import EmptyState from "../../shared/EmptyState";
import AnnouncePreview from "./AnnouncePreview";
import { SECTION_LABEL, sectionLabelStyle } from "./announceStyles";
import CarpoolMap from "./CarpoolMap";
import DriverGroupCard from "./DriverGroupCard";
import RiderPool from "./RiderPool";
import { useCarpoolAssignment } from "./useCarpoolAssignment";

interface Props {
	session: SessionRow;
	placeName: string | null;
	onClose: () => void;
}

/**
 * 운영자 카풀 공지 빌더(라이트) — 지도로 보며 운전자별 동승자를 2탭 편성하고,
 * 편성으로 공지 텍스트를 자동 생성해 복사한다. 편성은 sessions.carpool_groups 에 자동 저장.
 */
export default function CarpoolAnnounceBuilder({
	session: s,
	placeName,
	onClose,
}: Props) {
	const place = placeName ?? "";
	const auto = useMemo(
		() => autoHeader(s.scheduled_at, place),
		[s.scheduled_at, place],
	);

	const [header, setHeader] = useState(() => s.carpool_groups?.header ?? auto);
	const [footer, setFooter] = useState(
		() => s.carpool_groups?.footer ?? DEFAULT_FOOTER,
	);
	const {
		roster,
		drivers,
		riders,
		ridersByDriver,
		unassigned,
		assignedRiderIds,
		assignedCount,
		mapAssign,
		showMap,
		setShowMap,
		setMapActive,
		selected,
		toggleSelect,
		assignSelectedTo,
		removeRider,
	} = useCarpoolAssignment(s, header, footer, auto);

	const announceGroups: AnnounceGroup[] = useMemo(
		() =>
			drivers.map((d) => ({
				driver: d.name,
				riders: (ridersByDriver.get(d.member_id) ?? []).map((r) => r.name),
			})),
		[drivers, ridersByDriver],
	);
	const groupLines = announceGroups
		.filter((g) => g.riders.length > 0)
		.map((g) => `${g.driver}-${g.riders.join(",")}`);
	const fullText = buildAnnouncement(header, announceGroups, footer);

	const empty =
		roster != null && drivers.length === 0 && riders.length === 0;

	return (
		<ModalSheet position="bottom" onClose={onClose}>
			<div className="px-5 pt-5 pb-2">
				<div
					className="text-strong"
					style={{ fontSize: 16, fontWeight: 800 }}
				>
					🚗 카풀 공지 만들기
				</div>
				<div
					className="text-faint mt-0.5"
					style={{ fontSize: 12.5 }}
				>
					{fmtRange(s.scheduled_at, s.ends_at)} · {placeName ?? "장소 미정"}
				</div>
			</div>

			<div className="px-5 pb-5 flex flex-col gap-4">
				{roster == null ? (
					<EmptyState style={{ padding: "28px 0" }}>불러오는 중…</EmptyState>
				) : empty ? (
					<EmptyState style={{ lineHeight: 1.6 }}>
						아직 카풀 운전/탑승 신청자가 없어요.
						<br />
						회원이 일정 카드에서 의향을 고르면 여기에 표시됩니다.
					</EmptyState>
				) : (
					<>
						{/* 지도 */}
						<div>
							<div className="flex items-center justify-between mb-1.5">
								<span className={SECTION_LABEL} style={sectionLabelStyle}>
									위치
								</span>
								<button
									type="button"
									onClick={() => setShowMap((v) => !v)}
									className="text-[#0b84ff]"
									style={{
										fontSize: 12,
										fontWeight: 700,
										background: "none",
										border: "none",
										cursor: "pointer",
									}}
								>
									{showMap ? "지도 접기 ⌃" : "지도 펼치기 ⌄"}
								</button>
							</div>
							{showMap && (
								<CarpoolMap
									roster={roster}
									selected={selected}
									assignedRiderIds={assignedRiderIds}
									assignedCount={assignedCount}
									onAssignToDriver={assignSelectedTo}
									onReady={setMapActive}
								/>
							)}
						</div>

						{/* 그룹 편성 */}
						<div className="flex flex-col gap-2.5">
							<span className={SECTION_LABEL} style={sectionLabelStyle}>
								그룹 편성 · 운전 {drivers.length} · 탑승 {riders.length}
							</span>

							{drivers.length === 0 ? (
								<div
									style={{
										fontSize: 12.5,
										fontWeight: 700,
										color: "#b4762b",
										background: "rgba(180,118,43,0.13)",
										borderRadius: 12,
										padding: "10px 12px",
									}}
								>
									운전 가능한 회원이 없어요. 탑승 필요자만 있습니다.
								</div>
							) : (
								drivers.map((d) => (
									<DriverGroupCard
										key={d.member_id}
										driver={d}
										riders={ridersByDriver.get(d.member_id) ?? []}
										selectedCount={selected.size}
										// 거주지 미상 운전자는 지도에 마커가 없어 지도 배정 불가 → 버튼 유지
										showAssignButton={!mapAssign || !d.residence?.trim()}
										onAssignSelected={() => assignSelectedTo(d.member_id)}
										onRemoveRider={removeRider}
									/>
								))
							)}
						</div>

						{/* 미배정 동승자 */}
						<div className="flex flex-col gap-2">
							<span className={SECTION_LABEL} style={sectionLabelStyle}>
								미배정 동승자 · {unassigned.length}명
							</span>
							{selected.size > 0 && drivers.length > 0 && (
								<div
									className="text-[#0a5cb0] dark:text-[#7ab6ff]"
									style={{ fontSize: 12, fontWeight: 700 }}
								>
									{mapAssign
										? `${selected.size}명 선택됨 · 지도에서 태울 운전자를 누르세요`
										: `${selected.size}명 선택됨 · 위 운전자 카드의 '여기 태우기'를 누르세요`}
								</div>
							)}
							<RiderPool
								riders={unassigned}
								selected={selected}
								onToggle={toggleSelect}
							/>
						</div>

						{/* 공지 미리보기 + 복사 */}
						<AnnouncePreview
							header={header}
							onHeaderChange={setHeader}
							footer={footer}
							onFooterChange={setFooter}
							groupLines={groupLines}
							fullText={fullText}
						/>
					</>
				)}
			</div>
		</ModalSheet>
	);
}
