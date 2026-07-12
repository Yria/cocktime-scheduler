import { useState } from "react";
import type { Gender } from "../../types";
import { getPlayerPhotoUrl } from "../../lib/playerPhoto";
import { getNameInitial } from "../../lib/player";
import { magnetGenderRing, magnetGenderBg, magnetGenderInk } from "../../lib/magnetStyle";

interface PlayerAvatarProps {
	name: string;
	gender: Gender | string | null;
	/** 지름(px) */
	size?: number;
	/** 성별색 테두리 링 */
	ring?: boolean;
	/** 로컬 파일 프리뷰 등 — 원격(이름 기반) URL 보다 우선하며 onError fallback 없이 항상 표시 */
	previewSrc?: string;
	/** 게스트(계정 없는 임시 선수) — 사진은 이름(md5) 기반이라 동명 회원 사진이 잘못 붙는다.
	 *  true 면 원격 사진을 아예 불러오지 않고 항상 이니셜 아바타로 표시한다. */
	isGuest?: boolean;
	/** 이니셜이 비어 있을 때 대신 표시할 문자(ProfileSetup 의 "+") */
	fallbackChar?: string;
	/** 링 색 오버라이드 — 성별 미선택 시 중립 회색(#cbd5e1) 처리 등. 미지정 시 성별색 */
	ringColor?: string;
	/** 배경색 오버라이드(성별 미선택 시 #e2e8f0). 미지정 시 성별색 */
	bgColor?: string;
	/** 이니셜 글자색 오버라이드(성별 미선택 시 #64748b). 미지정 시 성별색 */
	inkColor?: string;
	/** 링 두께(px, 기본 2 — ProfileSetup 대형 아바타는 3) */
	ringWidth?: number;
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
	previewSrc,
	fallbackChar,
	ringColor,
	bgColor,
	inkColor,
	ringWidth = 2,
	isGuest = false,
}: PlayerAvatarProps) {
	const [imgFailed, setImgFailed] = useState(false);
	const url = getPlayerPhotoUrl(name);
	const g = gender ?? "M";
	// 로컬 프리뷰는 onError fallback 대상이 아님 — imgFailed 는 원격 URL 전용.
	// 이름이 비어 있으면 원격 URL 시도(무의미한 404 + onError까지 빈 이미지) 없이 즉시 이니셜/fallback.
	// 게스트는 이름(md5) 기반 사진이 동명 회원 사진과 충돌하므로 원격 사진을 불러오지 않는다(이니셜만).
	const showInitial =
		previewSrc == null && (isGuest || imgFailed || name.trim() === "");

	return (
		<div
			style={{
				position: "relative",
				width: size,
				height: size,
				borderRadius: "50%",
				overflow: "hidden",
				flexShrink: 0,
				background: bgColor ?? magnetGenderBg(g),
				border: ring
					? `${ringWidth}px solid ${ringColor ?? magnetGenderRing(g)}`
					: undefined,
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
						color: inkColor ?? magnetGenderInk(g),
						fontSize: size * 0.42,
						fontWeight: 700,
					}}
				>
					{getNameInitial(name) || fallbackChar}
				</div>
			) : (
				<img
					src={previewSrc ?? url}
					alt={name}
					onError={previewSrc != null ? undefined : () => setImgFailed(true)}
					loading="lazy"
					draggable={false}
					style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
				/>
			)}
		</div>
	);
}
