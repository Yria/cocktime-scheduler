import { useState } from "react";
import ModalSheet from "../common/ModalSheet";
import PlayerAvatar from "../shared/PlayerAvatar";
import { getPlayerPhotoUrl } from "../../lib/playerPhoto";
import type { AdminMemberRow } from "../../lib/supabase/adminMembers";

interface Props {
	member: AdminMemberRow;
	onClose: () => void;
}

/**
 * 회원관리 전용 — 회원 아바타를 탭하면 큰 프로필 사진을 본다.
 * 사진은 전체가 보이도록 contain 으로 크게, 로드 실패/게스트/이름없음이면
 * 큰 이니셜 아바타(PlayerAvatar)로 폴백한다. 배경(딤)·사진·Escape 어디든 탭하면 닫힘.
 */
export function MemberPhotoModal({ member, onClose }: Props) {
	const [failed, setFailed] = useState(false);
	// 게스트는 이름(md5) 기반 사진이 동명 회원과 충돌하므로 원격 사진을 쓰지 않는다(PlayerAvatar 규약과 동일).
	const showPhoto = !member.isGuest && member.name.trim() !== "" && !failed;
	return (
		<ModalSheet position="center" onClose={onClose} closeOnEscape>
			<div
				onClick={onClose}
				style={{
					padding: 18,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: 12,
					cursor: "pointer",
				}}
			>
				{showPhoto ? (
					<img
						src={getPlayerPhotoUrl(member.name)}
						alt={member.name}
						onError={() => setFailed(true)}
						draggable={false}
						style={{
							width: "100%",
							maxHeight: "68vh",
							objectFit: "contain",
							borderRadius: 18,
							display: "block",
						}}
					/>
				) : (
					<PlayerAvatar
						name={member.name}
						gender={member.gender}
						isGuest={member.isGuest}
						size={200}
						ringWidth={3}
					/>
				)}
				<div
					className="text-strong"
					style={{ fontSize: 17, fontWeight: 800 }}
				>
					{member.name}
				</div>
			</div>
		</ModalSheet>
	);
}
