import { useEffect, useState } from "react";
import type { Gender } from "../../types";
import { getPlayerPhotoUrl } from "../../lib/playerPhoto";
import { getNameInitial } from "../../lib/player";
import {
	MAGNET_SKILL_ARC_RATIO,
	MAGNET_GENDER_RING_W,
	MAGNET_SKILL_FG,
	MAGNET_SKILL_TRACK,
	magnetGenderRing,
	magnetGenderBg,
	magnetGenderInk,
	magnetSkillAngle,
} from "../../lib/magnetStyle";

interface PlayerCardProps {
	name: string;
	gender: Gender | string;
	/** 사진 키(members.id). 없으면 원격 사진 없이 이니셜로 폴백. */
	photoId?: string;
	skillScore?: number; // 실력 등급 1 ~ 10
	size?: "sm" | "md" | "lg";
	selected?: boolean;
	disabled?: boolean;
	onClick?: (e: React.MouseEvent) => void;
}

export const PLAYER_CARD_SIZES = {
	sm: { photo: 56, width: 68, fontSize: 10 },
	md: { photo: 72, width: 84, fontSize: 11 },
	lg: { photo: 88, width: 100, fontSize: 12 },
} as const;

/**
 * PlayerCard — 앱 전체 공통 "자석" 아바타(HTML).
 * 보드 Konva 자석(PlayerMagnet)과 동일한 디자인 토큰(magnetStyle)을 사용한다:
 * 원형 사진 + 성별색 링 + 스킬 아크 + 이름(안쪽 하단, 흰 글씨).
 */
export default function PlayerCard({
	name,
	gender,
	photoId,
	skillScore,
	size = "md",
	selected = false,
	disabled = false,
	onClick,
}: PlayerCardProps) {
	const [imgFailed, setImgFailed] = useState(false);
	// photoId 가 바뀌면 이전 실패 상태 리셋(다른 선수로 재사용 시 새 사진 재시도).
	useEffect(() => setImgFailed(false), [photoId]);
	const url = photoId ? getPlayerPhotoUrl(photoId) : "";
	const showInitial = !photoId || imgFailed;
	const s = PLAYER_CARD_SIZES[size];

	const ringColor = magnetGenderRing(gender);
	const bgLight = magnetGenderBg(gender);
	const ink = magnetGenderInk(gender);

	const diameter = s.photo; // 자석 전체 지름
	const inset = Math.round(diameter * MAGNET_SKILL_ARC_RATIO); // 바깥 스킬 아크 밴드(보드와 동일 비율)
	const photoD = diameter - inset * 2; // 사진 원
	const skillDeg = magnetSkillAngle(skillScore);

	const card = (
		<div
			style={{
				width: s.width,
				display: "flex",
				justifyContent: "center",
				opacity: disabled ? 0.4 : 1,
				cursor: onClick ? "pointer" : "default",
				transition: "opacity 0.15s",
			}}
		>
			<div style={{ position: "relative", width: diameter, height: diameter, flexShrink: 0 }}>
				{/* 스킬 아크 링 (12시 시작, 시계방향) — 바깥 밴드 */}
				<div
					style={{
						position: "absolute",
						inset: 0,
						borderRadius: "50%",
						background:
							skillScore != null
								? `conic-gradient(${MAGNET_SKILL_FG} ${skillDeg}deg, ${MAGNET_SKILL_TRACK} ${skillDeg}deg)`
								: MAGNET_SKILL_TRACK,
					}}
				/>
				{/* 사진 원(84%) + 이름(안쪽 하단) */}
				<div
					style={{
						position: "absolute",
						top: inset,
						left: inset,
						width: photoD,
						height: photoD,
						borderRadius: "50%",
						overflow: "hidden",
						background: bgLight,
					}}
				>
					{showInitial ? (
						<div
							style={{
								width: "100%",
								height: "100%",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								color: ink,
								fontSize: photoD * 0.4,
								fontWeight: 700,
							}}
						>
							{getNameInitial(name)}
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

					{/* 이름 — 자석 안쪽 하단(흰 글씨 + 그라데이션), 보드 자석과 동일 */}
					{name && (
						<>
							<div
								style={{
									position: "absolute",
									left: 0,
									right: 0,
									bottom: 0,
									height: "58%",
									background: "linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0.35) 55%, rgba(0,0,0,0))",
									pointerEvents: "none",
								}}
							/>
							<span
								style={{
									position: "absolute",
									left: 2,
									right: 2,
									bottom: 5,
									textAlign: "center",
									color: "#fff",
									fontSize: s.fontSize,
									fontWeight: 700,
									lineHeight: 1.1,
									textShadow: "0 1px 2px rgba(0,0,0,0.6)",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									pointerEvents: "none",
								}}
							>
								{name}
							</span>
						</>
					)}
				</div>
				{/* 성별 링 — 사진 테두리(오버레이) */}
				<div
					style={{
						position: "absolute",
						top: inset,
						left: inset,
						width: photoD,
						height: photoD,
						borderRadius: "50%",
						border: `${selected ? MAGNET_GENDER_RING_W + 0.5 : MAGNET_GENDER_RING_W}px solid ${ringColor}`,
						boxShadow: selected ? `0 0 0 3px ${ringColor}66` : "0 2px 6px rgba(0,0,0,0.25)",
						pointerEvents: "none",
						transition: "border-color 0.15s, box-shadow 0.15s",
					}}
				/>
			</div>
		</div>
	);

	if (onClick) {
		return (
			<button
				type="button"
				onClick={onClick}
				disabled={disabled}
				style={{
					border: "none",
					background: "transparent",
					padding: 0,
					cursor: disabled ? "default" : "pointer",
				}}
			>
				{card}
			</button>
		);
	}

	return card;
}
