/**
 * Player photo URL utilities.
 * 사진은 회원 단위이므로 Storage 파일명을 members.id(UUID)로 키잉한다.
 * (구 규약: md5(이름) — 동명이인이 같은 파일을 공유·덮어쓰는 문제로 폐기.
 *  기존 md5 파일 → {id}.jpg 이관은 scripts/migrate_photo_keys.py 참고.)
 * UUID는 ASCII-safe 라 Storage 키로 그대로 쓸 수 있어 해시가 필요 없다.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
/** 선수 사진 Storage 버킷명(공개 읽기). 업로드 유틸에서도 사용. */
export const PLAYER_PHOTO_BUCKET = "player-photos";

/** members.id → Storage 파일명(`{id}.jpg`). id 는 UUID 라 비ASCII 이슈가 없어 해시 불필요. */
export function playerPhotoFilename(memberId: string): string {
	return `${memberId}.jpg`;
}

// ─── 캐시 무효화 ──────────────────────────────────────────────
// 사진 URL은 회원 id 기반으로 고정이라 upsert 후에도 브라우저가 옛 이미지를 캐시한다.
// 업로드한 본인이 즉시(그리고 새로고침 후에도) 새 사진을 보도록, 올린 id별 버전을
// localStorage에 기록하고 URL에 ?v= 로 덧붙인다. 다른 사용자는 cacheControl 만료 후 갱신된다.
const PHOTO_VERSION_LS_KEY = "cocktime:photoVersions";
let versionCache: Record<string, number> | null = null;

function loadVersions(): Record<string, number> {
	if (versionCache) return versionCache;
	try {
		versionCache = JSON.parse(
			localStorage.getItem(PHOTO_VERSION_LS_KEY) || "{}",
		) as Record<string, number>;
	} catch {
		versionCache = {};
	}
	return versionCache;
}

/** 사진 업로드 성공 후 호출: 해당 회원의 캐시 버전을 갱신해 URL ?v= 가 바뀌게 한다. */
export function bumpPlayerPhotoVersion(memberId: string): void {
	const map = loadVersions();
	map[memberId] = Date.now();
	try {
		localStorage.setItem(PHOTO_VERSION_LS_KEY, JSON.stringify(map));
	} catch {
		/* 저장 실패는 무시(프라이빗 모드 등) */
	}
}

export function getPlayerPhotoUrl(memberId: string): string {
	const base = `${SUPABASE_URL}/storage/v1/object/public/${PLAYER_PHOTO_BUCKET}/${playerPhotoFilename(memberId)}`;
	const v = loadVersions()[memberId];
	return v ? `${base}?v=${v}` : base;
}
