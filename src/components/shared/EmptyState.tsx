import Spinner from "./Spinner";

interface EmptyStateProps {
	/** 안내 문구 */
	children?: React.ReactNode;
	/** 문구 위 아이콘(LogList 의 ClipboardList 등) */
	icon?: React.ReactNode;
	/** true 면 문구 대신 Spinner 를 센터 렌더(블록형 로딩) */
	loading?: boolean;
	/** 로딩 스피너 지름(px, 기본 20) */
	spinnerSize?: number;
	/** 카드 배경(card-lq) 래핑 — RegularNoticePage EmptyNote 계열 */
	card?: boolean;
	className?: string;
	/** padding 등 사이트별 미세 조정(기본값 위에 병합) */
	style?: React.CSSProperties;
}

/**
 * EmptyState — 빈 상태/블록형 로딩 공용 표시.
 * 기본형 = text-center + text-faint(#98a0ab / dark 0.4) + 13.5px + padding 24px 0
 * (12곳 산포 값의 지배값. fontSize 13~14 · padding 20~40px 변형은 style 로 조정하거나
 * 통일 시 1~8px 여백 변화 감수).
 * card variant = card-lq 배경 + 28px 16px 패딩 + fontWeight 600 (EmptyNote 계열).
 */
export default function EmptyState({
	children,
	icon,
	loading = false,
	spinnerSize = 20,
	card = false,
	className = "",
	style,
}: EmptyStateProps) {
	return (
		<div
			className={`text-center text-faint ${card ? "card-lq" : ""} ${className}`}
			style={{
				fontSize: 13.5,
				fontWeight: card ? 600 : undefined,
				padding: card ? "28px 16px" : "24px 0",
				...style,
			}}
		>
			{loading ? (
				<div style={{ display: "flex", justifyContent: "center" }}>
					<Spinner size={spinnerSize} />
				</div>
			) : (
				<>
					{icon != null && (
						<div
							style={{
								display: "flex",
								justifyContent: "center",
								marginBottom: 10,
							}}
						>
							{icon}
						</div>
					)}
					{children}
				</>
			)}
		</div>
	);
}
