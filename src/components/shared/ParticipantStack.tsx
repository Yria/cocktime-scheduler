import type { AttendanceRow } from "../../lib/supabase/types";
import PlayerAvatar from "./PlayerAvatar";

/** 인라인 아바타 스택에 노출할 최대 인원(초과분은 +N 칩) */
export const STACK_MAX = 6;

/** 아바타 지름(px)과 겹침 폭 — 스택·+N 칩이 같은 크기로 붙게 고정. */
const AVATAR = 28;
const OVERLAP = -8;

interface Props {
	/** 표시 순서대로 담긴 참석 행(확정 → 대기 → 정원 외 늦참). */
	roster: AttendanceRow[];
	/** 노출 최대 인원(기본 STACK_MAX). 초과분은 +N 칩. */
	max?: number;
}

/**
 * 참가자 아바타 겹침 스택 — 메인 일정 카드와 일정 관리 달력의 회차 시트가 함께 쓰는 공용 표시.
 * 대기자는 그레이스케일+감광, 정원 외 늦참은 바이올렛 링으로 확정자와 구분한다.
 * (탭 동작·화살표는 호출부가 감싸는 버튼에서 처리 — 이 컴포넌트는 표시만 한다.)
 */
export default function ParticipantStack({ roster, max = STACK_MAX }: Props) {
	const list = roster.slice(0, max);
	const extra = roster.length - list.length;

	return (
		<div className="flex items-center">
			{list.map((a, i) => {
				const isWaiting = a.status === "waitlisted";
				const isPool = a.status === "late_pool";
				return (
					<div
						key={a.member_id}
						className={
							isPool
								? "rounded-full ring-2 ring-[#8b5cf6] dark:ring-[#a78bfa]"
								: "rounded-full ring-2 ring-white dark:ring-[#1e1e23]"
						}
						style={{
							position: "relative",
							marginLeft: i === 0 ? 0 : OVERLAP,
							zIndex: list.length - i,
							filter: isWaiting ? "grayscale(1)" : undefined,
							opacity: isWaiting ? 0.55 : 1,
						}}
					>
						<PlayerAvatar
							name={a.member?.name ?? "회원"}
							gender={a.member?.gender ?? null}
							photoId={
								(a.member?.is_guest ?? a.invited_by != null)
									? undefined
									: (a.member_id ?? undefined)
							}
							size={AVATAR}
						/>
					</div>
				);
			})}
			{extra > 0 && (
				<div
					className="rounded-full ring-2 ring-white dark:ring-[#1e1e23] flex items-center justify-center text-muted bg-[rgba(0,0,0,0.06)] dark:bg-white/10"
					style={{
						width: AVATAR,
						height: AVATAR,
						marginLeft: OVERLAP,
						fontSize: 11,
						fontWeight: 700,
					}}
				>
					+{extra}
				</div>
			)}
		</div>
	);
}
