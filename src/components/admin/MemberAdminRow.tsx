import { Gauge } from "lucide-react";
import type { CSSProperties } from "react";
import type { AdminMemberRow } from "../../lib/supabase/adminMembers";
import { skillScoreOf } from "../../lib/teamSelection";
import PlayerAvatar from "../shared/PlayerAvatar";
import BirthYearTag from "../shared/BirthYearTag";
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
	onOpenPhoto: (m: AdminMemberRow) => void;
	onRequestToggleAdmin: (m: AdminMemberRow) => void;
	onRequestToggleActive: (m: AdminMemberRow) => void;
}

export function MemberRow({
	member,
	isMe,
	isBusy,
	query,
	size,
	start,
	onOpenSkillEdit,
	onOpenPhoto,
	onRequestToggleAdmin,
	onRequestToggleActive,
}: MemberRowProps) {
	const g = genderText(member.gender);
	const grade = skillScoreOf(member.skills); // 0 = 미설정
	// 비활성 회원은 신원(아바타·이름·정보)만 흐리게 — 액션 버튼은 또렷하게 유지.
	const idOpacity = member.isActive ? 1 : 0.45;
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
			{/* 프로필 사진(이름 md5 기반 원격 URL, 로드 실패 시 성별색 이니셜 폴백). 게스트는 동명 충돌 방지로 이니셜만.
			    탭하면 큰 사진 보기(회원관리 전용). 정보 버튼과 분리된 형제라 실력 편집과 안 겹침. */}
			<button
				type="button"
				onClick={() => onOpenPhoto(member)}
				aria-label={`${member.name} 사진 크게 보기`}
				style={{
					padding: 0,
					border: "none",
					background: "none",
					cursor: "pointer",
					borderRadius: "50%",
					flexShrink: 0,
					lineHeight: 0,
					opacity: idOpacity,
				}}
			>
				<PlayerAvatar
					name={member.name}
					gender={member.gender}
					photoId={member.isGuest ? undefined : member.id}
					size={44}
				/>
			</button>

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
					opacity: idOpacity,
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
					<BirthYearTag birthYear={member.birthYear} size={12} />
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
					{!member.isActive && (
						<span
							style={{
								flexShrink: 0,
								fontSize: 10.5,
								fontWeight: 800,
								padding: "1px 6px",
								borderRadius: 6,
								background: "rgba(100,116,139,0.16)",
								color: "#64748b",
							}}
						>
							비활성
						</span>
					)}
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
					{/* 년생은 이름 옆으로 올렸다(다른 화면과 같은 두 자리 표기) — 여기서는 중복이라 뺀다. */}
					{!g && !member.residence ? (
						"정보 없음"
					) : (
						<>
							{g && <Highlight text={g} kw={query} />}
							{g && member.residence && " · "}
							{member.residence && (
								<Highlight text={member.residence} kw={query} />
							)}
						</>
					)}
				</div>
			</button>

			{/* 액션(컴팩트) — 활성: 운영진·실력·비활성 / 비활성: 활성화.
			    본인(isMe)은 비활성 숨김. 회원 하드삭제는 폐지(정산 CASCADE 유실 방지) — 탈퇴=비활성으로 대체, delete_member RPC도 서버에서 차단. */}
			<div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
				{member.isActive ? (
					<>
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
								onClick={() => onRequestToggleActive(member)}
								disabled={isBusy}
								title="비활성화 — 세션 명단·회비 부과에서 제외"
								style={miniBtn("#d97706", "rgba(217,119,6,0.12)", isBusy)}
							>
								비활성
							</button>
						)}
					</>
				) : (
					<button
						type="button"
						onClick={() => onRequestToggleActive(member)}
						disabled={isBusy}
						title="활성화 — 세션 명단·회비 부과에 다시 포함"
						style={miniBtn("#16a34a", "rgba(22,163,74,0.12)", isBusy)}
					>
						활성화
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
