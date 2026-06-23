import type { Gender, PlayerSkills, SkillLevel } from "../../types";
import ModalSheet from "../common/ModalSheet";
import { PlayerAttributesForm } from "./PlayerAttributesForm";

interface GuestModalProps {
	guestName: string;
	guestGender: Gender;
	guestSkills: PlayerSkills;
	onClose: () => void;
	onAdd: () => void;
	onChangeName: (name: string) => void;
	onChangeGender: (gender: Gender) => void;
	onChangeSkill: (skill: keyof PlayerSkills, level: SkillLevel) => void;
	/** 헤더 제목(기본 "게스트 추가"). */
	title?: string;
	/** 확정 버튼 라벨(기본 "추가"). */
	ctaLabel?: string;
}

export function GuestModal({
	guestName,
	guestGender,
	guestSkills,
	onClose,
	onAdd,
	onChangeName,
	onChangeGender,
	onChangeSkill,
	title = "게스트 추가",
	ctaLabel = "추가",
}: GuestModalProps) {
	return (
		<ModalSheet position="bottom" onClose={onClose} className="flex flex-col max-h-[90dvh]">
			<div className="flex items-center justify-between px-5 pt-5 pb-3">
				<h3 className="font-bold text-gray-800 dark:text-white text-lg">
					{title}
				</h3>
				<button
					type="button"
					onClick={onClose}
					className="btn-icon-close"
				>
					✕
				</button>
			</div>

			<div className="no-sb overflow-y-auto px-5 pb-2">
				<div className="mb-4">
					<p className="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wide mb-2">
						이름
					</p>
					<input
						type="text"
						value={guestName}
						onChange={(e) => onChangeName(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && onAdd()}
						placeholder="게스트 이름 입력"
						// biome-ignore lint/a11y/noAutofocus: Intended UX
						autoFocus={true}
						className="w-full rounded-xl px-3.5 py-3 text-base text-gray-800 dark:text-white outline-none"
						style={{ background: "var(--mat-ultra-thin)" }}
					/>
				</div>

				<PlayerAttributesForm
					gender={guestGender}
					skills={guestSkills}
					onChangeGender={onChangeGender}
					onChangeSkill={onChangeSkill}
					skillHint={
						<span className="font-normal normal-case"> (기본값: 중)</span>
					}
				/>
			</div>

			<div
				className="flex gap-3 px-5 py-4"
				style={{ borderTop: "1px solid var(--border-light)" }}
			>
				<button
					type="button"
					onClick={onClose}
					className="btn-lq-secondary flex-1 py-3 text-sm"
				>
					취소
				</button>
				<button
					type="button"
					onClick={onAdd}
					disabled={!guestName.trim()}
					className="btn-lq-orange flex-1 py-3 text-sm"
				>
					{ctaLabel}
				</button>
			</div>
		</ModalSheet>
	);
}
