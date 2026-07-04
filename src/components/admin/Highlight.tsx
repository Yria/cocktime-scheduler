function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 텍스트에서 키워드와 겹치는 부분을 색 다르게 표시(대소문자 무시). */
export function Highlight({ text, kw }: { text: string; kw: string }) {
	const q = kw.trim();
	if (!q) return <>{text}</>;
	const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
	return (
		<>
			{parts.map((p, i) =>
				p.toLowerCase() === q.toLowerCase() ? (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: split 조각은 안정적 인덱스
						key={i}
						style={{
							color: "#0b84ff",
							background: "rgba(11,132,255,0.15)",
							borderRadius: 3,
							fontWeight: 700,
						}}
					>
						{p}
					</span>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: split 조각은 안정적 인덱스
					<span key={i}>{p}</span>
				),
			)}
		</>
	);
}
