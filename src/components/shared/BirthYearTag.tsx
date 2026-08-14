import { birthYearShort } from "../../lib/birthYear";

interface BirthYearTagProps {
	birthYear: number | null | undefined;
	/** 이름 글자 크기에 맞춰 조절. 기본 11(본문 13~14 기준). */
	size?: number;
	/** 이름과의 간격(px). flex 컨테이너에서 gap 이 이미 있으면 0 으로. */
	gap?: number;
}

/**
 * 이름 뒤에 붙는 년생 두 자리(회색 작은 글씨) — 동명이인 구분용.
 * 년생 미입력 회원·게스트는 아무것도 렌더하지 않는다(이름만 그대로).
 */
export default function BirthYearTag({
	birthYear,
	size = 11,
	gap = 3,
}: BirthYearTagProps) {
	const short = birthYearShort(birthYear);
	if (!short) return null;
	return (
		<span
			className="text-faint"
			style={{
				fontSize: size,
				fontWeight: 500,
				marginLeft: gap,
				flexShrink: 0,
				// 부모가 italic/underline 등을 걸어도 년생은 담백하게 유지
				fontStyle: "normal",
			}}
		>
			{short}
		</span>
	);
}
