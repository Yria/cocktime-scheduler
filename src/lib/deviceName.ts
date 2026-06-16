/**
 * 기기 식별용 친근한 이름 — 편집 락에서 "누가 접속/편집 중인지" 표시용.
 * 실명 인증이 없으므로 localStorage에 안정적으로 저장되는 동물 이름 + 2자리 숫자를 쓴다.
 */
const ANIMALS = [
	"토끼", "여우", "곰", "사자", "호랑이", "판다", "코알라", "수달",
	"고양이", "강아지", "펭귄", "부엉이", "다람쥐", "고슴도치", "너구리", "사슴",
];

const KEY = "cocktime-device-name";

export function getDeviceName(): string {
	try {
		const saved = localStorage.getItem(KEY);
		if (saved) return saved;
		const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
		const num = Math.floor(Math.random() * 90) + 10;
		const name = `${animal} ${num}`;
		localStorage.setItem(KEY, name);
		return name;
	} catch {
		// localStorage 불가(시크릿 등) — 세션 임시 이름
		return "기기";
	}
}
