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
	size = 512,
	quality = 0.85,
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
			// ?v= 가 바뀌면 즉시 새 사진을 받으므로 캐시는 길게 잡아도 되지만,
			// 인덱스 갱신 전(부팅 직후)을 대비해 10분으로 둔다.
			cacheControl: "600",
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
	// 도장만 실패한 경우: 파일은 올라갔으니 업로드 자체는 성공으로 본다. 다만 인덱스에는 남기지
	// 않는다 — 그래야 다음 부팅의 refreshPlayerPhotoIndex 와 어긋나 사진이 깜빡이지 않는다.
	if (stampError) {
		console.error("uploadPlayerPhoto(photo_updated_at):", stampError);
		return true;
	}
	markPlayerPhotoUploaded(memberId, at.getTime());
	return true;
}
