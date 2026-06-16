import { magnetGenderRing } from "../../lib/magnetStyle";
import type { Gender } from "../../types";

/** 성별 색 점(파랑=남, 빨강=여). 색은 magnetStyle 단일 출처에서 가져온다. */
export default function GenderDot({
	gender,
	size = 9,
}: {
	gender: Gender;
	size?: number;
}) {
	return (
		<span
			style={{
				width: size,
				height: size,
				borderRadius: "50%",
				background: magnetGenderRing(gender),
				display: "inline-block",
				flexShrink: 0,
			}}
		/>
	);
}
