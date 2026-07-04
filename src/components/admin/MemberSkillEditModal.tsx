import type { Dispatch, SetStateAction } from "react";
import { SKILL_LEVELS, SKILLS } from "../../lib/constants";
import type { PlayerSkills } from "../../types";
import ModalSheet from "../common/ModalSheet";
import { SkillButton } from "../setup/SkillButton";

// 회원 관리의 실력 편집 모달. draft 상태는 부모(MemberAdminPage)가 소유한다.

interface MemberSkillEditModalProps {
	memberName: string;
	draft: PlayerSkills;
	/** 함수형 업데이트((prev)=>...)를 그대로 쓰기 위해 setState 자체를 전달받는다. */
	setDraft: Dispatch<SetStateAction<PlayerSkills>>;
	saving: boolean;
	onSave: () => void;
	onClose: () => void;
}

export function MemberSkillEditModal({
	memberName,
	draft,
	setDraft,
	saving,
	onSave,
	onClose,
}: MemberSkillEditModalProps) {
	return (
		<ModalSheet
			position="center"
			zIndex={70}
			closeOnEscape
			onClose={onClose}
			title={`${memberName} · 실력`}
		>
			<div className="px-5 pb-5">
				<div className="flex flex-col gap-2">
					{SKILLS.map((skill) => (
						<div
							key={skill}
							style={{ display: "flex", alignItems: "center", gap: 8 }}
						>
							<span
								className="text-muted"
								style={{ width: 56, fontSize: 13, fontWeight: 700, flexShrink: 0 }}
							>
								{skill}
							</span>
							<div style={{ display: "flex", gap: 6, flex: 1 }}>
								{SKILL_LEVELS.map((level) => (
									<SkillButton
										key={level}
										level={level}
										active={draft[skill] === level}
										onClick={() =>
											setDraft((prev) => ({ ...prev, [skill]: level }))
										}
									/>
								))}
							</div>
						</div>
					))}
				</div>

				<button
					type="button"
					onClick={onSave}
					disabled={saving}
					className="btn-solid-blue mt-4"
				>
					{saving ? "저장 중…" : "저장"}
				</button>
			</div>
		</ModalSheet>
	);
}
