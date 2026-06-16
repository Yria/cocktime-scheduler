/**
 * 로딩 스피너. @keyframes spin은 index.css에 전역 정의.
 */
export default function Spinner({ size = 16 }: { size?: number }) {
	return (
		<div
			style={{
				width: size,
				height: size,
				borderRadius: "50%",
				border: "2px solid rgba(11,132,255,0.3)",
				borderTopColor: "#0b84ff",
				animation: "spin 0.8s linear infinite",
			}}
		/>
	);
}
