import { useEffect, useMemo, useRef, useState } from "react";
import { fmtRange } from "../../../lib/schedule/timeFmt";
import {
	type CarpoolMember,
	fetchCarpoolRoster,
} from "../../../lib/supabase/carpool";
import type {
	CarpoolGroup,
	CarpoolGroups,
	SessionRow,
} from "../../../lib/supabase/types";
import { scheduleActions } from "../../../store/scheduleStore";
import ModalSheet from "../../common/ModalSheet";
import {
	type AnnounceGroup,
	autoHeader,
	buildAnnouncement,
	DEFAULT_FOOTER,
} from "./announcementText";
import CarpoolMap from "./CarpoolMap";
import DriverGroupCard from "./DriverGroupCard";
import RiderPool from "./RiderPool";

interface Props {
	session: SessionRow;
	placeName: string | null;
	onClose: () => void;
}

const SECTION_LABEL =
	"text-[#98a0ab] dark:text-[rgba(235,235,245,0.45)] uppercase";
const sectionLabelStyle = {
	fontSize: 11.5,
	fontWeight: 800,
	letterSpacing: 0.4,
} as const;

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

	const [roster, setRoster] = useState<CarpoolMember[] | null>(null);
	const [assignment, setAssignment] = useState<Record<string, string>>({});
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [header, setHeader] = useState(() => s.carpool_groups?.header ?? auto);
	const [footer, setFooter] = useState(
		() => s.carpool_groups?.footer ?? DEFAULT_FOOTER,
	);
	const [showMap, setShowMap] = useState(true);
	const [copied, setCopied] = useState(false);
	// 마운트 시점의 저장 편성만 사용 — 저장→스토어 갱신으로 prop 이 바뀌어도 편성을 리셋하지 않도록.
	const savedRef = useRef(s.carpool_groups);

	// 명단 로드 + 저장된 편성 재조정(현재 confirmed·role 기준으로만 유지). 마운트 1회.
	useEffect(() => {
		let cancelled = false;
		fetchCarpoolRoster(s.id).then((r) => {
			if (cancelled) return;
			const driverIds = new Set(
				r.filter((m) => m.role === "can_drive").map((m) => m.member_id),
			);
			const riderIds = new Set(
				r.filter((m) => m.role === "need_ride").map((m) => m.member_id),
			);
			const a: Record<string, string> = {};
			for (const g of savedRef.current?.groups ?? []) {
				if (!driverIds.has(g.driver_member_id)) continue;
				for (const rid of g.rider_member_ids) {
					if (riderIds.has(rid) && !(rid in a)) a[rid] = g.driver_member_id;
				}
			}
			setAssignment(a);
			setRoster(r);
		});
		return () => {
			cancelled = true;
		};
	}, [s.id]);

	const drivers = useMemo(
		() => (roster ?? []).filter((m) => m.role === "can_drive"),
		[roster],
	);
	const riders = useMemo(
		() => (roster ?? []).filter((m) => m.role === "need_ride"),
		[roster],
	);
	const ridersByDriver = useMemo(() => {
		const map = new Map<string, CarpoolMember[]>();
		for (const d of drivers) map.set(d.member_id, []);
		for (const r of riders) {
			const did = assignment[r.member_id];
			if (did && map.has(did)) map.get(did)?.push(r);
		}
		return map;
	}, [drivers, riders, assignment]);
	const unassigned = useMemo(
		() => riders.filter((r) => !(r.member_id in assignment)),
		[riders, assignment],
	);

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

	// 편성/헤더/푸터 변경 자동 저장(디바운스, 로드 직후 1회는 스킵)
	const dirtyRef = useRef(false);
	useEffect(() => {
		if (!roster) return;
		if (!dirtyRef.current) {
			dirtyRef.current = true;
			return;
		}
		const t = setTimeout(() => {
			const groups: CarpoolGroup[] = drivers
				.map((d) => ({
					driver_member_id: d.member_id,
					rider_member_ids: (ridersByDriver.get(d.member_id) ?? []).map(
						(r) => r.member_id,
					),
				}))
				.filter((g) => g.rider_member_ids.length > 0);
			const payload: CarpoolGroups = {
				v: 1,
				groups,
				header: header.trim() === auto ? null : header,
				footer: footer === DEFAULT_FOOTER ? null : footer,
			};
			void scheduleActions.saveCarpoolGroups(s.id, payload);
		}, 700);
		return () => clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [assignment, header, footer, roster]);

	const toggleSelect = (id: string) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	const assignSelectedTo = (driverId: string) => {
		if (selected.size === 0) return;
		setAssignment((prev) => {
			const next = { ...prev };
			for (const id of selected) next[id] = driverId;
			return next;
		});
		setSelected(new Set());
	};
	const removeRider = (id: string) =>
		setAssignment((prev) => {
			const next = { ...prev };
			delete next[id];
			return next;
		});

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(fullText);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			setCopied(false);
		}
	};

	const empty =
		roster != null && drivers.length === 0 && riders.length === 0;

	return (
		<ModalSheet position="bottom" onClose={onClose}>
			<div className="px-5 pt-5 pb-2">
				<div
					className="text-[#0f1724] dark:text-white"
					style={{ fontSize: 16, fontWeight: 800 }}
				>
					🚗 카풀 공지 만들기
				</div>
				<div
					className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.45)] mt-0.5"
					style={{ fontSize: 12.5 }}
				>
					{fmtRange(s.scheduled_at, s.ends_at)} · {placeName ?? "장소 미정"}
				</div>
			</div>

			<div className="px-5 pb-5 flex flex-col gap-4">
				{roster == null ? (
					<div
						className="text-center text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
						style={{ fontSize: 13.5, padding: "28px 0" }}
					>
						불러오는 중…
					</div>
				) : empty ? (
					<div
						className="text-center text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
						style={{ fontSize: 13.5, padding: "24px 0", lineHeight: 1.6 }}
					>
						아직 카풀 운전/탑승 신청자가 없어요.
						<br />
						회원이 일정 카드에서 의향을 고르면 여기에 표시됩니다.
					</div>
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
							{showMap && <CarpoolMap roster={roster} />}
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
									{selected.size}명 선택됨 · 위 운전자 카드의 '여기 태우기'를 누르세요
								</div>
							)}
							<RiderPool
								riders={unassigned}
								selected={selected}
								onToggle={toggleSelect}
							/>
						</div>

						{/* 공지 미리보기 + 복사 */}
						<div className="flex flex-col gap-2">
							<span className={SECTION_LABEL} style={sectionLabelStyle}>
								공지 미리보기
							</span>

							<input
								type="text"
								value={header}
								onChange={(e) => setHeader(e.target.value)}
								className="w-full bg-white dark:bg-[rgba(30,30,35,0.8)] text-[#0f1724] dark:text-white border border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.12)]"
								style={{
									padding: "10px 12px",
									borderRadius: 10,
									fontSize: 14,
									fontWeight: 700,
									outline: "none",
								}}
							/>

							<div
								className="bg-[rgba(100,116,139,0.07)] dark:bg-[rgba(255,255,255,0.04)] text-[#0f1724] dark:text-white"
								style={{
									borderRadius: 10,
									padding: "11px 13px",
									fontSize: 13.5,
									lineHeight: 1.7,
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
									minHeight: 40,
								}}
							>
								{groupLines.length > 0 ? (
									groupLines.join("\n")
								) : (
									<span className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]">
										운전자에 동승자를 배정하면 여기에 표시돼요
									</span>
								)}
							</div>

							<textarea
								value={footer}
								onChange={(e) => setFooter(e.target.value)}
								rows={3}
								className="w-full bg-white dark:bg-[rgba(30,30,35,0.8)] text-[#64748b] dark:text-[rgba(235,235,245,0.7)] border border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.12)]"
								style={{
									padding: "10px 12px",
									borderRadius: 10,
									fontSize: 12.5,
									lineHeight: 1.6,
									outline: "none",
									resize: "vertical",
								}}
							/>

							<div className="flex items-center gap-3 mt-0.5">
								<button
									type="button"
									onClick={copy}
									style={{
										flex: 1,
										padding: "13px",
										borderRadius: 12,
										fontSize: 15,
										fontWeight: 800,
										color: "#fff",
										background: "#0b84ff",
										border: "none",
										cursor: "pointer",
										boxShadow: "0 4px 16px rgba(11,132,255,0.3)",
									}}
								>
									📋 공지 복사
								</button>
								{copied && (
									<span
										className="text-[#2c7a57]"
										style={{ fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap" }}
									>
										✓ 복사됐어요
									</span>
								)}
							</div>
							<p
								className="text-[#98a0ab] dark:text-[rgba(235,235,245,0.4)]"
								style={{ fontSize: 11.5, lineHeight: 1.5 }}
							>
								제목·안내문은 수정하면 다음에도 유지돼요. 이름은 편성한 회원에서 자동으로 들어갑니다.
							</p>
						</div>
					</>
				)}
			</div>
		</ModalSheet>
	);
}
