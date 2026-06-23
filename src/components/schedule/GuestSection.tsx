import { useMemo, useState } from "react";
import type { Gender, PlayerSkills, SkillLevel } from "../../types";
import type { AttendanceRow } from "../../lib/supabase/types";
import { DEFAULT_SKILLS } from "../../lib/constants";
import { GuestModal } from "../setup/GuestModal";

interface Props {
	/** 이 세션의 참석 행(취소 제외) */
	attendances: AttendanceRow[];
	memberId: string | null;
	/** 세션이 모집 중(open)인가 — 신청/취소 가능 여부 */
	isOpen: boolean;
	busy: boolean;
	/** 게스트 신청 — 성공/실패 반환(실패 시 모달 유지 + 알림). */
	onAddGuest: (guest: { name: string; gender: Gender; skills: PlayerSkills }) => Promise<{ ok: boolean; error?: string }>;
	onCancelGuest: (guestMemberId: string) => void;
}

/**
 * 일정 카드의 게스트 영역 — 회원이 게스트(계정 없는 선수)를 신청하고, 본인이 데려온 게스트를 취소한다.
 * 게스트는 정원/대기 규칙을 회원과 동일하게 따른다(서버 RPC 판정).
 */
export default function GuestSection({
	attendances,
	memberId,
	isOpen,
	busy,
	onAddGuest,
	onCancelGuest,
}: Props) {
	const [showModal, setShowModal] = useState(false);
	const [name, setName] = useState("");
	const [gender, setGender] = useState<Gender>("M");
	const [skills, setSkills] = useState<PlayerSkills>({ ...DEFAULT_SKILLS });
	const [submitting, setSubmitting] = useState(false);

	// 내가 데려온 게스트(취소 제외는 상위에서 필터됨)
	const myGuests = useMemo(
		() => (memberId ? attendances.filter((a) => a.invited_by === memberId) : []),
		[attendances, memberId],
	);
	const waiting = useMemo(() => attendances.filter((a) => a.status === "waitlisted"), [attendances]);

	if (!memberId) return null;

	const openModal = () => {
		setName("");
		setGender("M");
		setSkills({ ...DEFAULT_SKILLS });
		setShowModal(true);
	};

	const submit = async () => {
		if (!name.trim() || submitting) return;
		setSubmitting(true);
		const res = await onAddGuest({ name: name.trim(), gender, skills });
		setSubmitting(false);
		if (res.ok) setShowModal(false);
		else alert(res.error ? `게스트 신청 실패: ${res.error}` : "게스트 신청에 실패했습니다.");
	};

	return (
		<div className="mt-2.5">
			{/* 내가 데려온 게스트 목록 */}
			{myGuests.length > 0 && (
				<div className="flex flex-col gap-1.5">
					{myGuests.map((g) => {
						const rank =
							g.status === "waitlisted"
								? waiting.filter((w) => w.position <= g.position).length
								: 0;
						return (
							<div
								key={g.member_id}
								className="flex items-center justify-between rounded-lg px-3 py-1.5 bg-[rgba(0,0,0,0.035)] dark:bg-white/5"
							>
								<span className="text-[#0f1724] dark:text-gray-100" style={{ fontSize: 12.5, fontWeight: 600 }}>
									🎫 {g.member?.name ?? "게스트"}
									<span
										className="ml-1.5"
										style={{
											fontSize: 11,
											fontWeight: 700,
											color: g.status === "confirmed" ? "#30d158" : "#f59e0b",
										}}
									>
										{g.status === "confirmed" ? "확정" : `대기 ${rank}번째`}
									</span>
								</span>
								{isOpen && (
									<button
										type="button"
										onClick={() => onCancelGuest(g.member_id)}
										disabled={busy}
										style={{
											fontSize: 12,
											fontWeight: 600,
											color: "#ef4444",
											background: "none",
											border: "none",
											cursor: busy ? "not-allowed" : "pointer",
											opacity: busy ? 0.5 : 1,
										}}
									>
										취소
									</button>
								)}
							</div>
						);
					})}
				</div>
			)}

			{/* 게스트 신청 버튼 — 모집 중에만 */}
			{isOpen && (
				<button
					type="button"
					onClick={openModal}
					disabled={busy}
					className="mt-1.5"
					style={{
						fontSize: 12.5,
						fontWeight: 600,
						color: "#64748b",
						background: "rgba(0,0,0,0.04)",
						border: "1px dashed rgba(128,128,128,0.4)",
						borderRadius: 8,
						padding: "6px 12px",
						cursor: busy ? "not-allowed" : "pointer",
						width: "100%",
					}}
				>
					+ 게스트 신청
				</button>
			)}

			{showModal && (
				<GuestModal
					title="게스트 신청"
					ctaLabel={submitting ? "신청 중…" : "신청"}
					guestName={name}
					guestGender={gender}
					guestSkills={skills}
					onClose={() => setShowModal(false)}
					onAdd={submit}
					onChangeName={setName}
					onChangeGender={setGender}
					onChangeSkill={(skill, level: SkillLevel) => setSkills((prev) => ({ ...prev, [skill]: level }))}
				/>
			)}
		</div>
	);
}
