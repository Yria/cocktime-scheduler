import ModalSheet from "./ModalSheet";

interface ConfirmDialogProps {
	title: React.ReactNode;
	/** 표준 설명 문단(text-sm gray 계열)으로 렌더. 커스텀 본문은 children 으로. */
	message?: React.ReactNode;
	/** 제목과 설명 사이에 그대로 렌더되는 커스텀 본문(CockCheckModal 의 지원 배너 등) */
	children?: React.ReactNode;
	confirmLabel: string;
	/** 기본 "취소" */
	cancelLabel?: string;
	/** 확인 버튼 변형 — primary: btn-lq-primary / danger: btn-lq-red (기본 primary) */
	tone?: "primary" | "danger";
	/** 처리 중 — 두 버튼 disabled, busyLabel 지정 시 확인 라벨 교체 */
	busy?: boolean;
	/** busy 중 확인 버튼 라벨("처리 중…" 등). 미지정 시 confirmLabel 유지 */
	busyLabel?: string;
	/** 취소 버튼 disabled 오버라이드. 미지정 시 busy를 따름 — busy가 "조회 중"이라
	    취소는 계속 눌려야 하는 곳(CockCheckModal)은 false 를 넘긴다 */
	cancelDisabled?: boolean;
	/** 확인 버튼 단독(취소 없음 — EditorTakenNotice 형) */
	hideCancel?: boolean;
	/** 다이얼로그 폭 (ModalSheet maxWidth, 기본 "sm") */
	maxWidth?: "xs" | "sm";
	onConfirm: () => void;
	onCancel?: () => void;
	/** 배경 클릭으로 닫기. 미지정 시 배경 클릭 무시(ClearConfirmModal 형).
	    보통 onCancel 과 같은 핸들러를 넘긴다. */
	onDismiss?: () => void;
}

/**
 * ConfirmDialog — 확인 다이얼로그 공용 골격(제목 h3 + 설명 p + 취소/확인 버튼 행).
 * ClearConfirmModal·BoardToolbar(세션 종료/권한 가져오기)·CockCheckModal·EditorTakenNotice·
 * GroupSettingsModal 계열의 다수파 스타일(ModalSheet center + p-6)을 그대로 캡슐화 — 시각 동일.
 * 주의: SessionConflictDialog·PlayerConflictDialog 는 버튼이 세로 스택(확인 먼저)이라 이
 * 골격에 맞지 않음 — 그 2곳은 이관 대상에서 제외하거나 별도 variant 논의.
 */
export default function ConfirmDialog({
	title,
	message,
	children,
	confirmLabel,
	cancelLabel = "취소",
	tone = "primary",
	busy = false,
	busyLabel,
	cancelDisabled,
	hideCancel = false,
	maxWidth,
	onConfirm,
	onCancel,
	onDismiss,
}: ConfirmDialogProps) {
	const confirmCls = tone === "danger" ? "btn-lq-red" : "btn-lq-primary";
	return (
		// Escape 닫기는 배경 클릭과 같은 규칙: onDismiss 를 넘긴 곳만 동작(미지정 시 onClose가 없어 무시됨)
		<ModalSheet
			position="center"
			className="p-6"
			onClose={onDismiss}
			closeOnEscape
			maxWidth={maxWidth}
		>
			<h3 className="font-bold text-gray-800 dark:text-white text-lg mb-1.5">
				{title}
			</h3>
			{children}
			{message != null && (
				<p className="text-sm text-gray-600 dark:text-gray-300 mb-5 leading-relaxed">
					{message}
				</p>
			)}
			<div className="flex gap-3">
				{!hideCancel && (
					<button
						type="button"
						onClick={onCancel}
						disabled={cancelDisabled ?? busy}
						className="btn-lq-secondary flex-1"
					>
						{cancelLabel}
					</button>
				)}
				<button
					type="button"
					onClick={onConfirm}
					disabled={busy}
					className={`${confirmCls} ${hideCancel ? "w-full" : "flex-1"}`}
				>
					{busy && busyLabel ? busyLabel : confirmLabel}
				</button>
			</div>
		</ModalSheet>
	);
}
