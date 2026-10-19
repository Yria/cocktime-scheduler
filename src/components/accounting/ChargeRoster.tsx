import type { ReactNode } from "react";
import { memberLabel } from "../../lib/dues/summary";
import type { AccountingData } from "../../lib/dues/types";
import PlayerAvatar from "../shared/PlayerAvatar";

/**
 * 부과 명단 공용 골격 — 일정 참가자 명단(SessionParticipantsModal)과 같은 문법:
 * 상태별 섹션 머리 + 아바타 한 줄 행. 현황 상세 모달과 부과 탭 명단이 같이 쓴다.
 * 감싸는 쪽에 `ac-overview-roster`(+ 부과 탭이면 `ac-charge-roster`)를 둔다.
 */
export function RosterSection({
	title,
	tone = "",
	count,
	unit = "명",
	children,
}: {
	title: string;
	tone?: string;
	count: number;
	unit?: string;
	children: ReactNode;
}) {
	return (
		<section
			className="ac-roster-section"
			aria-label={`${title} ${count}${unit}`}
		>
			<h3 className={`ac-roster-title ${tone}`}>
				{title} <span className="ac-number">{`${count}${unit}`}</span>
			</h3>
			{children}
		</section>
	);
}

export function RosterRow({
	data,
	memberId,
	label,
	tone = "",
	echo = false,
	notes = [],
	amount,
	settled = false,
	trailing,
	children,
}: {
	data: AccountingData;
	memberId: string;
	/** 이름 옆 작은 알약. 섹션 머리와 같은 말이면 echo 로 화면에서만 감춘다. */
	label?: string;
	tone?: string;
	echo?: boolean;
	notes?: (string | false | null | undefined)[];
	amount?: string;
	settled?: boolean;
	/** 금액 오른쪽(행 끝) — [변경] 같은 버튼. */
	trailing?: ReactNode;
	/** 행 아래로 펼치는 내용(처리 버튼 등). */
	children?: ReactNode;
}) {
	const member = data.members.find((m) => m.id === memberId);
	const [name, ...detail] = memberLabel(data, memberId).split(" · ");
	return (
		<div className="ac-roster-item">
			<div className="ac-row ac-roster-row">
				<span className="ac-roster-avatar" aria-hidden="true">
					<PlayerAvatar
						name={member?.name ?? name}
						gender={member?.gender ?? null}
						photoId={member && !member.guest ? member.id : undefined}
						size={32}
					/>
				</span>
				<span className="ac-row-body">
					<span className="ac-roster-name">
						<strong>
							{name}
							{detail.length > 0 && <span> · {detail.join(" · ")}</span>}
						</strong>
						{label && (
							<span className={`ac-row-state ${tone}${echo ? " is-echo" : ""}`}>
								{label}
							</span>
						)}
					</span>
					{notes.filter(Boolean).map((text) => (
						<span key={String(text)} className="ac-row-note">
							{text}
						</span>
					))}
				</span>
				{amount !== undefined && (
					<strong className={`ac-amount ${settled ? "is-settled" : ""}`}>
						{amount}
					</strong>
				)}
				{trailing}
			</div>
			{children}
		</div>
	);
}
