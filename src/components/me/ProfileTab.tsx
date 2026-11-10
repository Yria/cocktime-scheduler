import { ProfileForm } from "../ProfileSetup";

/**
 * 정보 수정 탭 — 예전 '내 정보' 모달 본문(폼 · 대기 포인트 · 탈퇴)을 모달 없이 그린다.
 * 페이지에 박혀 있어 닫을 곳이 없으므로 onSaved 를 주지 않는다 → 저장 후 그 자리에 남고 토스트만 뜬다.
 */
export default function ProfileTab() {
	return (
		<section className="me-profile" aria-label="정보 수정">
			<ProfileForm mode="edit" />
		</section>
	);
}
