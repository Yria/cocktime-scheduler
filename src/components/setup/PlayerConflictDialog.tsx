import { SKILLS } from "../../lib/constants";
import type { Gender, PlayerSkills, SkillLevel } from "../../types";
import ModalSheet from "../common/ModalSheet";

interface PlayerConflictDialogProps {
	playerName: string;
	serverGender: Gender;
	serverSkills: PlayerSkills;
	localGender: Gender;
	localSkills: PlayerSkills;
	onForceOverwrite: () => void;
	onCancel: () => void;
}

const SKILL_LABEL: Record<SkillLevel, string> = { O: "상", V: "중", X: "하" };
const GENDER_LABEL: Record<Gender, string> = { M: "남", F: "여" };
const GENDER_COLOR: Record<Gender, string> = { M: "#007aff", F: "#ff2d55" };

export function PlayerConflictDialog({
	playerName,
	serverGender,
	serverSkills,
	localGender,
	localSkills,
	onForceOverwrite,
	onCancel,
}: PlayerConflictDialogProps) {
	const genderDiff = localGender !== serverGender;
	const changedSkills = SKILLS.filter(
		(skill) => localSkills[skill] !== serverSkills[skill],
	);

	return (
		<ModalSheet position="center" onClose={onCancel}>
			<div className="px-5 pt-5 pb-3">
				<div className="flex items-center gap-2 mb-2">
					<span style={{ fontSize: 22 }}>⚠️</span>
					<h3
						className="font-bold text-gray-800 dark:text-white"
						style={{ fontSize: 17 }}
					>
						선수 정보 충돌
					</h3>
				</div>
				<p
					className="text-gray-500 dark:text-gray-400"
					style={{ fontSize: 13 }}
				>
					<strong>{playerName}</strong>님의 내가 저장하려는 정보와 서버에 저장된
					정보가 다릅니다.
				</p>
			</div>

			<div className="px-5 pb-4">
				{/* 성별 */}
				{genderDiff && (
					<DiffSection label="성별">
						<div className="px-3 py-2.5 flex items-center gap-2">
							<div className="flex-1 min-w-0 flex items-center gap-1.5">
								<Badge variant="server" />
								<GenderChip gender={serverGender} />
							</div>
							<Arrow />
							<div className="flex-1 min-w-0 flex items-center gap-1.5">
								<Badge variant="local" />
								<GenderChip gender={localGender} />
							</div>
						</div>
					</DiffSection>
				)}

				{/* 스킬 */}
				{changedSkills.length > 0 && (
					<DiffSection label="스킬">
						{changedSkills.map((skill, i) => (
							<div
								key={skill}
								className="px-3 py-2 flex items-center"
								style={
									i > 0
										? { borderTop: "1px solid var(--border-light)" }
										: undefined
								}
							>
								<span className="text-sm text-gray-600 dark:text-gray-400 w-16 shrink-0">
									{skill}
								</span>
								<div className="flex-1 flex items-center justify-center gap-2">
									<SkillChip level={serverSkills[skill]} variant="server" />
									<Arrow />
									<SkillChip level={localSkills[skill]} variant="local" />
								</div>
							</div>
						))}
					</DiffSection>
				)}
			</div>

			<div
				className="flex flex-col gap-2 px-5 py-4"
				style={{ borderTop: "1px solid var(--border-light)" }}
			>
				<button
					type="button"
					onClick={onForceOverwrite}
					className="btn-lq-primary w-full py-3 text-sm"
				>
					내 수정으로 덮어쓰기
				</button>
				<button
					type="button"
					onClick={onCancel}
					className="btn-lq-secondary w-full py-3 text-sm"
				>
					취소 (서버 값 유지)
				</button>
			</div>
		</ModalSheet>
	);
}

/* ── 공통 비교 UI ─────────────────────────────── */

function DiffSection({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div
			className="mb-3 rounded-xl overflow-hidden"
			style={{ border: "1px solid var(--border-light)" }}
		>
			<div
				className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"
				style={{ background: "rgba(0,0,0,0.03)", color: "#8e8e93" }}
			>
				{label}
			</div>
			{children}
		</div>
	);
}

function Badge({ variant }: { variant: "local" | "server" }) {
	const isLocal = variant === "local";
	return (
		<span
			className="text-xs font-semibold shrink-0 px-1.5 py-0.5 rounded"
			style={
				isLocal
					? { background: "rgba(11,132,255,0.1)", color: "#007aff" }
					: { background: "rgba(255,149,0,0.12)", color: "#ff9500" }
			}
		>
			{isLocal ? "내 수정" : "서버"}
		</span>
	);
}

function Arrow() {
	return (
		<span className="shrink-0 text-base" style={{ color: "#bbb" }}>
			→
		</span>
	);
}

function GenderChip({ gender }: { gender: Gender }) {
	const color = GENDER_COLOR[gender];
	return (
		<span
			className="text-sm font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
			style={{ background: `${color}12`, color }}
		>
			<span
				style={{
					width: 6,
					height: 6,
					borderRadius: "50%",
					background: color,
				}}
			/>
			{GENDER_LABEL[gender]}
		</span>
	);
}

function SkillChip({
	level,
	variant,
}: {
	level: SkillLevel;
	variant: "local" | "server";
}) {
	const isLocal = variant === "local";
	return (
		<span
			className="text-xs font-semibold w-7 h-7 rounded-lg inline-flex items-center justify-center"
			style={
				isLocal
					? { background: "rgba(11,132,255,0.08)", color: "#007aff" }
					: { background: "rgba(255,149,0,0.1)", color: "#ff9500" }
			}
		>
			{SKILL_LABEL[level]}
		</span>
	);
}
