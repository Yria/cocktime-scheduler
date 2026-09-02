import { Sprout } from "lucide-react";
import { useAuthStore } from "../../store/authStore";
import {
	entryAlertActions,
	useEntryAlertSlot,
} from "../../store/entryAlertStore";
import {
	isNewbieNowKST,
	joinDateKST,
	newbieGraceEndKST,
} from "../../lib/schedule/waitStatus";
import ConfirmDialog from "../common/ConfirmDialog";

/** 유예 마지막 날 "YYYY-MM-DD" → "9월 17일". 형식이 어긋나면 원문 그대로. */
function fmtGraceEnd(ymd: string): string {
	const [, m, d] = ymd.split("-");
	return m && d ? `${Number(m)}월 ${Number(d)}일` : ymd;
}

/**
 * 신규회원 프리패스 안내 — 가입 2주 안이면 앱을 열 때 "대기 없이 참여된다"를 알린다.
 *
 * 미납 알림(UnpaidDuesAlert)과 같은 규칙으로 띄운다:
 * - 노출 조건: 로그인 회원 · 프로필 완성(ProfileSetup 모달과 겹치지 않게) · 유예 기간 중.
 * - 닫기는 **이번 앱 실행에만** 유효(localStorage 미사용) → 유예가 남아있는 동안 앱을 열 때마다 다시 뜬다.
 *   1회만 띄우면 정작 만석 회차를 만난 날엔 안내가 없어, 신규 회원이 "만석이니 나는 못 가겠네"로 읽고
 *   신청을 포기한다. 혜택을 아는 것이 목적이므로 유예 내내 반복해서 알린다.
 * - 유예가 끝나면 조건이 깨져 자연히 안 뜬다(별도 해제 처리 없음 — 가입일이 유일한 근거).
 * - 미납 알림과 동시에 조건이 참이어도 겹치지 않는다 — 진입 알림은 슬롯 하나를 나눠 쓰고(entryAlertStore)
 *   미납이 먼저, 닫으면 이 안내가 그 자리에 뜬다.
 * - 보드(/session) 화면에선 App 이 언마운트해 경기 운영을 가리지 않는다.
 *
 * 문구는 단정하지 않는다("접수돼요" + 예외 한 줄) — 프리패스는 대관비를 걷지 않는 일정에서만 열리고,
 * 클라이언트는 일정의 부과 여부를 신뢰성 있게 알 수 없다(비활성 장소는 목록에서 걸러져 '장소 없음'과
 * 구분되지 않는다). 인원 상한은 없다(마이그레이션 20260903000000 R2).
 */
export default function NewbieFreepassAlert() {
	const memberId = useAuthStore((s) => s.memberId);
	const myGender = useAuthStore((s) => s.myGender);
	const myBirthYear = useAuthStore((s) => s.myBirthYear);
	const myResidence = useAuthStore((s) => s.myResidence);
	const myMembershipStartedAt = useAuthStore((s) => s.myMembershipStartedAt);
	const myCreatedAt = useAuthStore((s) => s.myCreatedAt);

	// 프로필 미완성이면 Home 이 ProfileSetup 모달을 띄우는 중 → 모달 겹침 방지.
	const profileComplete =
		!!memberId && myGender != null && myBirthYear != null && !!myResidence;
	const inGrace = isNewbieNowKST(myMembershipStartedAt, myCreatedAt);

	const show = useEntryAlertSlot("newbieFreepass", profileComplete && inGrace);

	const join = joinDateKST(myMembershipStartedAt, myCreatedAt);
	const graceEnd = join ? newbieGraceEndKST(join) : null;

	if (!show) return null;

	return (
		<ConfirmDialog
			title={
				<span className="flex items-center gap-1.5">
					<Sprout
						size={19}
						strokeWidth={2.4}
						className="text-[#15803d] dark:text-[#6ee7a8]"
					/>
					신규 회원은 2주간 대기 없이 참여
				</span>
			}
			confirmLabel="알겠어요"
			hideCancel
			onConfirm={() => entryAlertActions.close("newbieFreepass")}
			onDismiss={() => entryAlertActions.close("newbieFreepass")}
		>
			<div className="text-muted" style={{ fontSize: 13.5, lineHeight: 1.65 }}>
				<p style={{ marginBottom: 8 }}>
					가입 후 2주 동안은 정원이 다 차 있어도{" "}
					<b className="text-strong">[참석하기]</b> 를 누르면 대기가 아니라 바로
					참석으로 접수돼요.
					{graceEnd && (
						<>
							{" "}
							<b className="text-strong">{fmtGraceEnd(graceEnd)}</b> 회차까지예요.
						</>
					)}
				</p>
				<p className="text-faint" style={{ fontSize: 12.5 }}>
					· 대관비를 걷는 일정은 정원까지만 받아요(만석이면 대기).
				</p>
			</div>
		</ConfirmDialog>
	);
}
