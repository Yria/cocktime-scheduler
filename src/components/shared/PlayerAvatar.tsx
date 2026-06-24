import { useState } from "react";
import type { Gender } from "../../types";
import { getPlayerPhotoUrl } from "../../lib/playerPhoto";
import { magnetGenderRing, magnetGenderBg, magnetGenderInk } from "../../lib/magnetStyle";

interface PlayerAvatarProps {
	name: string;
	gender: Gender | string | null;
	/** 지름(px) */
	size?: number;
	/** 성별색 테두리 링 */
	ring?: boolean;
}

/**
 * PlayerAvatar — 라벨 없는 작은 원형 아바타.
 * PlayerCard(자석)에서 사진/성별색/이니셜 fallback 로직만 떼어낸 경량 버전으로,
 * 참가자 인라인 스택·리스트 행에서 공용으로 쓴다(이름 라벨·스킬 아크 없음).
 * 겹침 스택의 배경 구분 테두리는 호출부 wrapper에서 처리한다.
 */
export default function PlayerAvatar({
	name,
	gender,
	size = 32,
	ring = true,
}: PlayerAvatarProps) {
	const [imgFailed, setImgFailed] = useState(false);
	const url = getPlayerPhotoUrl(name);
	const g = gender ?? "M";

	return (
		<div
			style={{
				position: "relative",
				width: size,
				height: size,
				borderRadius: "50%",
				overflow: "hidden",
				flexShrink: 0,
				background: magnetGenderBg(g),
				border: ring ? `2px solid ${magnetGenderRing(g)}` : undefined,
			}}
		>
			{imgFailed ? (
				<div
					style={{
						width: "100%",
						height: "100%",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						color: magnetGenderInk(g),
						fontSize: size * 0.42,
						fontWeight: 700,
					}}
				>
					{name.charAt(0)}
				</div>
			) : (
				<img
					src={url}
					alt={name}
					onError={() => setImgFailed(true)}
					loading="lazy"
					draggable={false}
					style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
				/>
			)}
		</div>
	);
}
