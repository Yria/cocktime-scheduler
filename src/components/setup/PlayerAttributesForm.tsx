import type { Gender, PlayerSkills } from "../../types";
import GenderDot from "../shared/GenderDot";
import { GradeInput, type GradeAnchor } from "../shared/GradeInput";

interface PlayerAttributesFormProps {
	gender: Gender;
	skills: PlayerSkills;
	onChangeGender: (gender: Gender) => void;
	onChangeGrade: (grade: number) => void;
	/** 비교 추정에서 제외할 본인 이름. */
	excludeName?: string;
	/** 비교 표본(미지정 시 GradeInput이 활성 회원 로드). */
	anchors?: GradeAnchor[];
}

/** 성별 토글 + 실력 등급 입력 — EditModal/GuestModal 공용 표현 컴포넌트. */
export function PlayerAttributesForm({
	gender,
	skills,
	onChangeGender,
	onChangeGrade,
	excludeName,
	anchors,
}: PlayerAttributesFormProps) {
	return (
		<>
			<div className="mb-4">
				<p className="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide mb-2">
					성별
				</p>
				<div className="flex gap-2">
					{(["M", "F"] as Gender[]).map((g) => (
						<button
							type="button"
							key={g}
							onClick={() => onChangeGender(g)}
							className={`btn-toggle flex-1 py-2.5 ${gender === g ? "btn-toggle-active" : ""}`}
						>
							<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
								<GenderDot gender={g} size={7} />
								{g === "M" ? "남" : "여"}
							</span>
						</button>
					))}
				</div>
			</div>

			<div className="mb-2">
				<GradeInput
					value={skills.grade}
					onChange={onChangeGrade}
					gender={gender}
					excludeName={excludeName}
					anchors={anchors}
				/>
			</div>
		</>
	);
}
