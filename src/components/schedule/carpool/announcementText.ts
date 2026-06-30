// 카풀 공지 텍스트 생성. 편성(그룹) + 세션정보 + 회원 이름으로 매번 생성(저장 안 함).
// 출력 예:
//   [0628 일요일 오후 행복체육관]
//
//   상진-성민
//   형일-지윤,지인,필립
//
//   *라이더분들과 ...

export const DEFAULT_FOOTER = `*라이더분들과 동승자분들은 장소, 시간 수다방에서 조율하시면 됩니다.
*동승자분들은 감사의 마음으로 ⭐콕 1개 ⭐라이더분께 전달해주세요!
*추가 카풀 필요하신 분들 연락주세요!`;

const headerFmt = new Intl.DateTimeFormat("ko-KR", {
	timeZone: "Asia/Seoul",
	month: "2-digit",
	day: "2-digit",
	weekday: "long",
	hour: "numeric",
	hour12: false,
});

/** 세션 시작 시각 → "[0628 일요일 오후 {장소}]". 장소 비면 장소 라벨 생략. */
export function autoHeader(scheduledAt: string | null, place: string): string {
	const c = place.trim();
	if (!scheduledAt) return c ? `[${c}]` : "[카풀]";
	const parts = headerFmt.formatToParts(new Date(scheduledAt));
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
	const mmdd = get("month") + get("day");
	const weekday = get("weekday");
	const hour = Number(get("hour"));
	const ampm = hour < 12 ? "오전" : "오후";
	return `[${mmdd} ${weekday} ${ampm}${c ? ` ${c}` : ""}]`;
}

export interface AnnounceGroup {
	driver: string;
	riders: string[];
}

/** 헤더 + (동승자 있는) 그룹 줄 + 안내문을 합친다. */
export function buildAnnouncement(
	header: string,
	groups: AnnounceGroup[],
	footer: string,
): string {
	const lines = groups
		.filter((g) => g.riders.length > 0)
		.map((g) => `${g.driver}-${g.riders.join(",")}`);
	return [header, "", ...lines, "", footer].join("\n");
}
