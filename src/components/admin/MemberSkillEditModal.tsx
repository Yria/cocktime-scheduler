import type { Dispatch, SetStateAction } from "react";
import type { Gender, PlayerSkills } from "../../types";
import ModalSheet from "../common/ModalSheet";
import { GradeInput, type GradeAnchor } from "../shared/GradeInput";

// 회원 관리의 실력 편집 모달. draft 상태는 부모(MemberAdminPage)가 소유한다.

interface MemberSkillEditModalProps {
	memberName: string;
	/** 편집 대상 회원 id(members.id) — 비교에서 본인 제외 + 아바타 사진 키. */
	memberId: string;
	/** 비교 추정 표본(동성) 기준 성별. */
	gender: Gender;
	draft: PlayerSkills;
	/** 함수형 업데이트((prev)=>...)를 그대로 쓰기 위해 setState 자체를 전달받는다. */
	setDraft: Dispatch<SetStateAction<PlayerSkills>>;
	/** 동성 회원 비교 표본. */
	anchors?: GradeAnchor[];
	saving: boolean;
	onSave: () => void;
	onClose: () => void;
}

export function MemberSkillEditModal({
	memberName,
	memberId,
	gender,
	draft,
	setDraft,
	anchors,
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
				<GradeInput
					value={draft.grade}
					onChange={(grade) => setDraft({ grade })}
					gender={gender}
					excludeName={memberName}
					excludeId={memberId}
					anchors={anchors}
				/>

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
