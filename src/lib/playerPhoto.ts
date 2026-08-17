/**
 * Player photo URL utilities.
 * 사진은 회원 단위이므로 Storage 파일명을 members.id(UUID)로 키잉한다.
 * (구 규약: md5(이름) — 동명이인이 같은 파일을 공유·덮어쓰는 문제로 폐기.
 *  기존 md5 파일 → {id}.jpg 이관은 scripts/migrate_photo_keys.py 참고.)
 * UUID는 ASCII-safe 라 Storage 키로 그대로 쓸 수 있어 해시가 필요 없다.
 */
import { create } from "zustand";
import { supabase } from "./supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
/** 선수 사진 Storage 버킷명(공개 읽기). 업로드 유틸에서도 사용. */
export const PLAYER_PHOTO_BUCKET = "player-photos";

/** members.id → Storage 파일명(`{id}.jpg`). id 는 UUID 라 비ASCII 이슈가 없어 해시 불필요. */
export function playerPhotoFilename(memberId: string): string {
	return `${memberId}.jpg`;
}

// ─── 사진 인덱스 ──────────────────────────────────────────────
// members.photo_updated_at 을 { memberId: epochMs } 로 들고 있으면서 두 가지를 동시에 푼다.
//  1) 사진 없는 회원에게는 <img> 를 아예 걸지 않는다.
//     종전에는 전원에게 URL 을 만들어 줬고, 사진 없는 회원마다 Storage 가 404 를 돌려줬다.
//     오류 응답은 브라우저가 캐시하지 않아 명단을 열 때마다 재요청 → 24시간 5,359건(전체 4xx 의 전부).
//  2) ?v={epochMs} 캐시 무효화가 전 회원에게 통한다.
//     종전 localStorage 버전은 올린 본인 브라우저에서만 동작해, 남들은 cacheControl(600s)
//     만료 전까지 옛 사진을 봤다.
// 첫 방문(인덱스 없음)에는 낙관적으로 URL 을 내보내 사진이 비어 보이지 않게 하고, 한 번 받아온
// 뒤에는 localStorage 에 남겨 다음 방문부터 첫 페인트에서 곧바로 정확해진다.

const LS_KEY = "cocktime:photoIndex";

type PhotoIndex = Record<string, number>;

function readCache(): PhotoIndex | null {
	try {
		const raw = localStorage.getItem(LS_KEY);
		return raw ? (JSON.parse(raw) as PhotoIndex) : null;
	} catch {
		return null;
	}
}

function writeCache(index: PhotoIndex): void {
	try {
		localStorage.setItem(LS_KEY, JSON.stringify(index));
	} catch {
		/* 저장 실패는 무시(프라이빗 모드·용량 초과) */
	}
}

interface PhotoIndexState {
	/** null = 아직 한 번도 받아본 적 없음(= 낙관적 표시 구간) */
	index: PhotoIndex | null;
}

const usePhotoIndexStore = create<PhotoIndexState>(() => ({
	index: readCache(),
}));

/** members.photo_updated_at 전량 조회 → 인덱스 갱신. 앱 부팅 시 1회. */
export async function refreshPlayerPhotoIndex(): Promise<void> {
	const { data, error } = await supabase
		.from("members")
		.select("id, photo_updated_at")
		.not("photo_updated_at", "is", null);
	if (error) {
		// 실패해도 종전 인덱스(또는 낙관적 표시)를 그대로 둔다 — 사진이 통째로 사라지는 것보다 낫다.
		console.error("refreshPlayerPhotoIndex:", error);
		return;
	}
	const index: PhotoIndex = {};
	for (const row of (data ?? []) as { id: string; photo_updated_at: string }[]) {
		const ts = Date.parse(row.photo_updated_at);
		if (!Number.isNaN(ts)) index[row.id] = ts;
	}
	usePhotoIndexStore.setState({ index });
	writeCache(index);
}

/** 사진 업로드 성공 직후 호출 — 인덱스에 즉시 반영해 ?v= 가 바뀌게 한다. */
export function markPlayerPhotoUploaded(memberId: string, at = Date.now()): void {
	const index = { ...(usePhotoIndexStore.getState().index ?? {}), [memberId]: at };
	usePhotoIndexStore.setState({ index });
	writeCache(index);
}

function buildUrl(memberId: string, index: PhotoIndex | null): string {
	// 인덱스를 아직 못 받았으면 낙관적으로 시도(브라우저당 첫 1회).
	// 받아왔는데 목록에 없다 = 사진이 없는 회원 → 요청하지 않는다.
	const v = index?.[memberId];
	if (index && v == null) return "";
	const base = `${SUPABASE_URL}/storage/v1/object/public/${PLAYER_PHOTO_BUCKET}/${playerPhotoFilename(memberId)}`;
	return v ? `${base}?v=${v}` : base;
}

/** 사진 URL 훅 — 인덱스가 갱신되면 사진이 자동으로 나타난다. memberId 가 없으면 빈 문자열. */
export function usePlayerPhotoUrl(memberId?: string | null): string {
	const index = usePhotoIndexStore((s) => s.index);
	return memberId ? buildUrl(memberId, index) : "";
}

/** 훅을 쓸 수 없는 자리(이벤트 핸들러 등)용 스냅샷 버전. */
export function getPlayerPhotoUrl(memberId: string): string {
	return buildUrl(memberId, usePhotoIndexStore.getState().index);
}
