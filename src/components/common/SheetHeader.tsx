interface SheetHeaderProps {
	title: React.ReactNode;
	/** 제목 아래 보조 텍스트(장소·상태 칩 등) */
	subtitle?: React.ReactNode;
	/** 지정 시 우측에 ✕ 원형 칩(btn-icon-close — 닫기 버튼 표준) 렌더 */
	onClose?: () => void;
	/** 닫기 대신/옆에 놓을 커스텀 액션(NotificationBell "모두 지우기", ScheduleRuleEditor "취소" 등) */
	action?: React.ReactNode;
	className?: string;
}

/**
 * SheetHeader — 시트/모달 헤더(제목 + 닫기) 공용 골격.
 * 표준 결정:
 *   - 제목 타이포 = "font-bold text-gray-800 dark:text-white text-lg"
 *     (GuestModal·EditModal 등 ModalSheet 소비자 다수파. 인라인 fontSize 17~19/800 계열은
 *     이관 시 이 타이포로 수렴 — 미묘한 크기·굵기 변화 감수)
 *   - 닫기 버튼 = btn-icon-close 원형 칩(32px). 배경 없는 22px '×' 텍스트 계열은 이관 시 외형 변경.
 *   - 패딩 = px-5 pt-5 pb-3 (헤더가 소유). 시트 자체 패딩(p-5 등)을 쓰던 사용처는 이관 시
 *     본문에서 헤더 몫의 패딩을 빼야 한다.
 */
export default function SheetHeader({
	title,
	subtitle,
	onClose,
	action,
	className = "",
}: SheetHeaderProps) {
	return (
		<div
			className={`flex items-center justify-between gap-2 px-5 pt-5 pb-3 ${className}`}
		>
			<div className="min-w-0 flex-1">
				<h3 className="font-bold text-gray-800 dark:text-white text-lg">
					{title}
				</h3>
				{subtitle != null && (
					<div className="text-faint" style={{ fontSize: 12.5, marginTop: 2 }}>
						{subtitle}
					</div>
				)}
			</div>
			{action}
			{onClose && (
				<button
					type="button"
					onClick={onClose}
					className="btn-icon-close"
					aria-label="닫기"
				>
					✕
				</button>
			)}
		</div>
	);
}
