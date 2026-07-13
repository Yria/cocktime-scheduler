import { Gauge } from "lucide-react";
import type { CSSProperties } from "react";
import type { AdminMemberRow } from "../../lib/supabase/adminMembers";
import { skillScoreOf } from "../../lib/teamSelection";
import { Highlight } from "./Highlight";
import { genderText } from "./memberAdminText";

// 회원 관리 가상화 리스트의 컴팩트 행. key={member.id}는 호출부(map)에서 지정한다.

interface MemberRowProps {
	member: AdminMemberRow;
	isMe: boolean;
	isBusy: boolean;
	query: string;
	/** 가상화 행 크기/오프셋(vr.size / vr.start) */
	size: number;
	start: number;
	onOpenSkillEdit: (m: AdminMemberRow) => void;
	onRequestToggleAdmin: (m: AdminMemberRow) => void;
	onRequestDelete: (m: AdminMemberRow) => void;
}

export function MemberRow({
	member,
	isMe,
	isBusy,
	query,
	size,
	start,
	onOpenSkillEdit,
	onRequestToggleAdmin,
	onRequestDelete,
}: MemberRowProps) {
	const g = genderText(member.gender);
	const grade = skillScoreOf(member.skills); // 0 = 미설정
	return (
		<div
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				width: "100%",
				height: size,
				transform: `translateY(${start}px)`,
				display: "flex",
				alignItems: "center",
				gap: 8,
				borderBottom: "1px solid rgba(0,0,0,0.06)",
			}}
		>
			{/* 정보(탭 → 실력 편집) */}
			<button
				type="button"
				onClick={() => onOpenSkillEdit(member)}
				style={{
					flex: 1,
					minWidth: 0,
					textAlign: "left",
					background: "none",
					border: "none",
					cursor: "pointer",
					padding: "4px 0",
					overflow: "hidden",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 5,
						overflow: "hidden",
					}}
				>
					<span
						className="text-strong"
						style={{
							fontSize: 15,
							fontWeight: 800,
							minWidth: 0,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						<Highlight text={member.name} kw={query} />
					</span>
					{isMe && (
						<span
							className="text-faint"
							style={{ fontSize: 12, fontWeight: 600, flexShrink: 0 }}
						>
							(나)
						</span>
					)}
					{/* 실력 등급 — 이름 오른쪽에 게이지 아이콘 + 숫자(0=미설정 "–") */}
					<span
						title="실력 등급"
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 3,
							flexShrink: 0,
							fontSize: 13,
							fontWeight: 700,
							fontVariantNumeric: "tabular-nums",
							color: grade > 0 ? "#16a34a" : "#94a3b8",
						}}
					>
						<Gauge size={14} strokeWidth={2.25} aria-hidden />
						{grade > 0 ? grade : "–"}
					</span>
				</div>
				<div
					className="text-muted"
					style={{
						fontSize: 12.5,
						fontWeight: 500,
						marginTop: 2,
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
					}}
				>
					{!g && member.birthYear == null && !member.residence ? (
						"정보 없음"
					) : (
						<>
							{g && <Highlight text={g} kw={query} />}
							{g && (member.birthYear != null || member.residence) && " · "}
							{member.birthYear != null && `${member.birthYear}년생`}
							{member.birthYear != null && member.residence && " · "}
							{member.residence && (
								<Highlight text={member.residence} kw={query} />
							)}
						</>
					)}
				</div>
			</button>

			{/* 액션(컴팩트) */}
			<div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
				<button
					type="button"
					onClick={() => onRequestToggleAdmin(member)}
					disabled={isBusy}
					title={
						member.isAdmin ? "운영진 — 눌러서 해제" : "회원 — 눌러서 승급"
					}
					style={miniBtn(
						member.isAdmin ? "#0b84ff" : "#64748b",
						member.isAdmin
							? "rgba(11,132,255,0.15)"
							: "rgba(100,116,139,0.12)",
						isBusy,
					)}
				>
					{member.isAdmin ? "운영진" : "회원"}
				</button>
				<button
					type="button"
					onClick={() => onOpenSkillEdit(member)}
					disabled={isBusy}
					style={miniBtn("#16a34a", "rgba(22,163,74,0.12)", isBusy)}
				>
					실력
				</button>
				{!isMe && (
					<button
						type="button"
						onClick={() => onRequestDelete(member)}
						disabled={isBusy}
						style={miniBtn("#ef4444", "rgba(239,68,68,0.12)", isBusy)}
					>
						삭제
					</button>
				)}
			</div>
		</div>
	);
}

function miniBtn(
	color: string,
	bg: string,
	busy: boolean,
): CSSProperties {
	return {
		padding: "7px 10px",
		borderRadius: 9,
		fontSize: 12.5,
		fontWeight: 700,
		color,
		background: bg,
		border: "none",
		cursor: busy ? "not-allowed" : "pointer",
		opacity: busy ? 0.5 : 1,
	};
}
