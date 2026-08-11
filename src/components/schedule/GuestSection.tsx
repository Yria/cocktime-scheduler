import { useMemo, useState } from "react";
import type { Gender, PlayerSkills } from "../../types";
import type { AttendanceRow } from "../../lib/supabase/types";
import { DEFAULT_SKILLS } from "../../lib/constants";
import { waitDisplay } from "../../lib/schedule/waitStatus";
import { GuestModal } from "../setup/GuestModal";
import ConfirmDialog from "../common/ConfirmDialog";

interface Props {
	/** 이 세션의 참석 행(취소 제외) */
	attendances: AttendanceRow[];
	memberId: string | null;
	/** 세션이 모집 중(open)인가 — 신청/취소 가능 여부 */
	isOpen: boolean;
	/** 본인이 이 세션에 참석(확정/대기) 중인가 — 게스트 신청은 참석자만 가능 */
	attending: boolean;
	busy: boolean;
	/** 게스트 확정 상한 — 주말 null(무제한)/평일 2. 서버 session_guest_cap 미러. */
	guestCap: number | null;
	/** 정모 식사(회식) 체크 회차 — 게스트 행에도 식사 참여 토글을 노출한다. */
	mealOn: boolean;
	/** 게스트 신청 — 성공/실패 반환(실패 시 모달 유지 + 알림). */
	onAddGuest: (guest: { name: string; gender: Gender; skills: PlayerSkills }) => Promise<{ ok: boolean; error?: string }>;
	onCancelGuest: (guestMemberId: string) => void;
	/** 게스트 식사 참여 변경 — 게스트는 계정이 없어 데려온 회원이 대신 고른다. */
	onSetGuestMeal: (guestMemberId: string, joining: boolean) => void;
}

/**
 * 일정 카드의 게스트 영역 — 회원이 게스트(계정 없는 선수)를 신청하고, 본인이 데려온 게스트를 취소한다.
 * 게스트 확정은 세션당 최대 2명(서버 RPC가 상한 판정) — 초과 신청은 대기로 접수되고, 확정 게스트가
 * 빠져야 순서대로 승급된다. 이미 확정 게스트가 2명이면 "대기로 들어간다"는 안내를 확인받은 뒤 신청 폼을 연다.
 */
export default function GuestSection({
	attendances,
	memberId,
	isOpen,
	attending,
	busy,
	guestCap,
	mealOn,
	onAddGuest,
	onCancelGuest,
	onSetGuestMeal,
}: Props) {
	const [showModal, setShowModal] = useState(false);
	const [name, setName] = useState("");
	const [gender, setGender] = useState<Gender>("M");
	const [skills, setSkills] = useState<PlayerSkills>({ ...DEFAULT_SKILLS });
	const [submitting, setSubmitting] = useState(false);
	// 게스트 2명 이상 시 "참여 어려울 수 있음" 경고 다이얼로그
	const [showGuestWarn, setShowGuestWarn] = useState(false);
	// 게스트 취소 재확인 — 실수 취소 시 확정 자리가 대기자에게 넘어가 되돌리기 어렵다.
	const [pendingCancel, setPendingCancel] = useState<AttendanceRow | null>(null);

	// 내가 데려온 게스트(취소 제외는 상위에서 필터됨)
	const myGuests = useMemo(
		() => (memberId ? attendances.filter((a) => a.invited_by === memberId) : []),
		[attendances, memberId],
	);
	// 확정 게스트 수 — 세션당 상한 2명. 이미 2명이면 신규 게스트는 대기로 들어간다(서버 RPC 판정) → pre-check 경고용.
	const confirmedGuestCount = useMemo(
		() => attendances.filter((a) => a.invited_by != null && a.status === "confirmed").length,
		[attendances],
	);
	// 초대자 본인의 참석 상태 — 정원 외 늦참(late_pool)이면 게스트도 late_pool 로 상속되어 확정 상한/대기와 무관.
	const myStatus = useMemo(
		() => attendances.find((a) => a.member_id === memberId && a.invited_by == null)?.status ?? null,
		[attendances, memberId],
	);

	if (!memberId) return null;

	const showAddButton = isOpen && attending;
	// 보여줄 게스트도 없고 신청 버튼도 안 뜨면 아무것도 렌더하지 않는다.
	// (빈 wrapper의 mt-2.5가 카드 하단에 유령 여백을 만들던 문제 방지)
	if (myGuests.length === 0 && !showAddButton) return null;

	// 신청 폼 열기(초기화). 게스트가 이미 2명 이상이면 먼저 경고를 확인받는다.
	const openGuestForm = () => {
		setName("");
		setGender("M");
		setSkills({ ...DEFAULT_SKILLS });
		setShowModal(true);
	};
	const handleAddClick = () => {
		// 초대자 본인이 정원 외 늦참이면 게스트도 late_pool 로 접수되므로 확정 상한 경고는 부정확 → 생략.
		// guestCap null = 주말(무제한) → 경고 없이 바로 신청.
		if (myStatus !== "late_pool" && guestCap != null && confirmedGuestCount >= guestCap)
			setShowGuestWarn(true);
		else openGuestForm();
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
						// 상한이 찬 동안 대기 게스트는 "게스트 정원 대기"(번호 없음), 열려 있으면 통합 순번.
						const wait =
							g.status === "waitlisted" ? waitDisplay(attendances, g, guestCap) : null;
						return (
							<div
								key={g.member_id}
								className="flex items-center justify-between rounded-lg px-3 py-1.5 bg-[rgba(0,0,0,0.035)] dark:bg-white/5"
							>
								<span className="text-strong" style={{ fontSize: 12.5, fontWeight: 600 }}>
									🎫 {g.member?.name ?? "게스트"}
									<span
										className="ml-1.5"
										style={{
											fontSize: 11,
											fontWeight: 700,
											color:
												g.status === "confirmed"
													? "#30d158"
													: g.status === "late_pool"
														? "#8b5cf6"
														: "#f59e0b",
										}}
									>
										{g.status === "confirmed"
											? "확정"
											: g.status === "late_pool"
												? "🌙 늦참"
												: wait?.kind === "guestCap"
													? "게스트 정원 대기"
													: `대기 ${wait?.rank ?? 0}번째`}
									</span>
								</span>
								<div className="flex items-center gap-2 flex-shrink-0">
									{/* 정모 식사 체크 회차: 게스트 몫도 데려온 회원이 대신 고른다(기본 참여) */}
									{mealOn && (
										<button
											type="button"
											onClick={() => onSetGuestMeal(g.member_id, !g.meal_joining)}
											disabled={busy}
											aria-pressed={g.meal_joining}
											style={{
												fontSize: 11,
												fontWeight: 700,
												color: g.meal_joining ? "#2c7a57" : "#94a3b8",
												background: g.meal_joining
													? "rgba(44,122,87,0.12)"
													: "rgba(148,163,184,0.16)",
												border: "none",
												borderRadius: 999,
												padding: "3px 9px",
												cursor: busy ? "not-allowed" : "pointer",
												opacity: busy ? 0.5 : 1,
											}}
										>
											{g.meal_joining ? "식사 참여" : "식사 안 함"}
										</button>
									)}
									{isOpen && (
										<button
											type="button"
											onClick={() => setPendingCancel(g)}
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
							</div>
						);
					})}
				</div>
			)}

			{/* 게스트 신청 버튼 — 모집 중 + 본인이 참석 중일 때만 */}
			{showAddButton && (
				<button
					type="button"
					onClick={handleAddClick}
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

			{showGuestWarn && (
				<ConfirmDialog
					title={`확정 게스트가 이미 ${guestCap}명이에요`}
					message={`세션당 게스트는 최대 ${guestCap}명까지만 참여할 수 있어요. 추가 게스트는 대기로 접수되고, 기존 게스트가 빠지면 순서대로 참여할 수 있어요. 그래도 신청할까요?`}
					confirmLabel="대기로 신청"
					onConfirm={() => {
						setShowGuestWarn(false);
						openGuestForm();
					}}
					onCancel={() => setShowGuestWarn(false)}
					onDismiss={() => setShowGuestWarn(false)}
				/>
			)}

			{/* 게스트 취소 재확인 — 확정 게스트를 실수로 취소하면 자리가 대기자에게 바로 넘어가 복구가 어렵다. */}
			{pendingCancel && (
				<ConfirmDialog
					title={`${pendingCancel.member?.name ?? "게스트"} 님의 참여를 취소할까요?`}
					message={
						pendingCancel.status === "waitlisted"
							? "게스트 대기 신청이 취소됩니다."
							: pendingCancel.status === "late_pool"
								? "게스트의 정원 외 늦참 신청이 취소됩니다."
								: "게스트의 참석 신청이 취소됩니다. 대기자가 있으면 그 자리는 바로 다음 순번에게 넘어가고, 되돌릴 수 없어요."
					}
					confirmLabel="참여 취소"
					cancelLabel="닫기"
					tone="danger"
					busy={busy}
					busyLabel="취소 중…"
					onConfirm={() => {
						const target = pendingCancel;
						setPendingCancel(null);
						onCancelGuest(target.member_id);
					}}
					onCancel={() => setPendingCancel(null)}
					onDismiss={() => setPendingCancel(null)}
				/>
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
					onChangeGrade={(grade) => setSkills({ grade })}
				/>
			)}
		</div>
	);
}
