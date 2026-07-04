import { useState } from "react";
import { SECTION_LABEL, sectionLabelStyle } from "./announceStyles";

interface Props {
	header: string;
	onHeaderChange: (v: string) => void;
	footer: string;
	onFooterChange: (v: string) => void;
	groupLines: string[];
	fullText: string;
}

/** 공지 미리보기 섹션 — 헤더 입력·그룹 라인 미리보기·푸터 안내문 편집·복사 버튼. */
export default function AnnouncePreview({
	header,
	onHeaderChange,
	footer,
	onFooterChange,
	groupLines,
	fullText,
}: Props) {
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(fullText);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			setCopied(false);
		}
	};

	return (
		<div className="flex flex-col gap-2">
			<span className={SECTION_LABEL} style={sectionLabelStyle}>
				공지 미리보기
			</span>

			<input
				type="text"
				value={header}
				onChange={(e) => onHeaderChange(e.target.value)}
				className="w-full bg-white dark:bg-[rgba(30,30,35,0.8)] text-strong border border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.12)]"
				style={{
					padding: "10px 12px",
					borderRadius: 10,
					fontSize: 14,
					fontWeight: 700,
					outline: "none",
				}}
			/>

			<div
				className="bg-[rgba(100,116,139,0.07)] dark:bg-[rgba(255,255,255,0.04)] text-strong"
				style={{
					borderRadius: 10,
					padding: "11px 13px",
					fontSize: 13.5,
					lineHeight: 1.7,
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					minHeight: 40,
				}}
			>
				{groupLines.length > 0 ? (
					groupLines.join("\n")
				) : (
					<span className="text-faint">
						운전자에 동승자를 배정하면 여기에 표시돼요
					</span>
				)}
			</div>

			<textarea
				value={footer}
				onChange={(e) => onFooterChange(e.target.value)}
				rows={3}
				className="w-full bg-white dark:bg-[rgba(30,30,35,0.8)] text-muted border border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.12)]"
				style={{
					padding: "10px 12px",
					borderRadius: 10,
					fontSize: 12.5,
					lineHeight: 1.6,
					outline: "none",
					resize: "vertical",
				}}
			/>

			<div className="flex items-center gap-3 mt-0.5">
				<button type="button" onClick={copy} className="btn-solid-blue flex-1">
					📋 공지 복사
				</button>
				{copied && (
					<span
						className="text-[#2c7a57]"
						style={{ fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap" }}
					>
						✓ 복사됐어요
					</span>
				)}
			</div>
			<p
				className="text-faint"
				style={{ fontSize: 11.5, lineHeight: 1.5 }}
			>
				제목·안내문은 수정하면 다음에도 유지돼요. 이름은 편성한 회원에서 자동으로 들어갑니다.
			</p>
		</div>
	);
}
