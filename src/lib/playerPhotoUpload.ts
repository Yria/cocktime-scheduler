/**
 * 프로필 사진 업로드 유틸.
 * 선택한 이미지를 정사각 JPEG로 축소·중앙 크롭한 뒤 Supabase Storage에 upsert한다.
 * 파일명은 회원 id(members.id) 기반 — getPlayerPhotoUrl/playerPhotoFilename 과 동일 규약.
 */
import { supabase } from "./supabase/client";
import {
	PLAYER_PHOTO_BUCKET,
	markPlayerPhotoUploaded,
	playerPhotoFilename,
} from "./playerPhoto";

/**
 * 이미지 파일을 size×size 정사각 JPEG Blob으로 변환(중앙 크롭).
 * <img>+canvas 경로로 처리해 iOS Safari 등에서 EXIF 방향이 자동 적용되도록 한다.
 */
export async function processImageToSquareJpeg(
	file: File,
	size = 192,
	quality = 0.8,
): Promise<Blob> {
	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.src = url;
		await img.decode();

		const sw = img.naturalWidth;
		const sh = img.naturalHeight;
		if (!sw || !sh) throw new Error("이미지 크기를 읽을 수 없습니다.");

		// 중앙 정사각 크롭 영역
		const side = Math.min(sw, sh);
		const sx = (sw - side) / 2;
		const sy = (sh - side) / 2;

		const canvas = document.createElement("canvas");
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("canvas 컨텍스트를 생성할 수 없습니다.");
		ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(blob) =>
					blob ? resolve(blob) : reject(new Error("이미지 인코딩에 실패했습니다.")),
				"image/jpeg",
				quality,
			);
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}

/**
 * 정사각 JPEG Blob을 해당 회원(members.id)의 Storage 객체로 upsert. 성공 여부 반환.
 * 업로드 성공 뒤 members.photo_updated_at 을 찍는다 — 이게 "이 회원은 사진이 있다"의 유일한 근거이며
 * (없는 사람에게 <img> 를 걸어 404 를 반복하지 않게 한다) 동시에 전 회원 공통 ?v= 캐시 버전이 된다.
 */
export async function uploadPlayerPhoto(
	memberId: string,
	blob: Blob,
): Promise<boolean> {
	const { error } = await supabase.storage
		.from(PLAYER_PHOTO_BUCKET)
		.upload(playerPhotoFilename(memberId), blob, {
			contentType: "image/jpeg",
			upsert: true,
			// 사진 URL 은 ?v={photo_updated_at} 로 버전이 붙으므로(playerPhoto.ts buildUrl)
			// 새 사진은 새 URL 이 되고, 옛 URL 을 오래 캐시해도 옛 사진이 보일 일이 없다.
			// 종전 600초는 10분마다 전 회원 사진을 재다운로드시켜 대역폭 초과의 직접 원인이었다.
			// 이 값을 길게 두는 전제조건이 아래 stampError 처리다 — 도장이 실패하면 ?v= 가
			// 그대로여서 1년간 옛 사진에 갇히므로, 실패는 반드시 업로드 실패로 보고해야 한다.
			cacheControl: "31536000",
		});
	if (error) {
		console.error("uploadPlayerPhoto:", error);
		return false;
	}
	const at = new Date();
	const { error: stampError } = await supabase
		.from("members")
		.update({ photo_updated_at: at.toISOString() })
		.eq("id", memberId);
	// 도장 실패는 업로드 실패로 보고한다. 파일은 올라갔지만 photo_updated_at 이 안 찍히면
	// ?v= 가 그대로여서 cacheControl 1년 동안 옛 사진에 갇힌다(종전 600초는 10분 만에
	// 자가치유했다). upsert 라 재시도가 멱등이므로 호출부가 사용자에게 재시도를 안내하는 편이
	// 안전하다 — ProfileSetup 이 false 를 받으면 안내 후 중단한다.
	if (stampError) {
		console.error("uploadPlayerPhoto(photo_updated_at):", stampError);
		return false;
	}
	markPlayerPhotoUploaded(memberId, at.getTime());
	return true;
}
