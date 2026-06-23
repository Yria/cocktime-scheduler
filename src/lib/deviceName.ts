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

const CLIENT_ID_KEY = "cocktime-client-id";

/**
 * 편집 락/연결 식별자 — 탭 단위로 sessionStorage에 영속한다.
 *
 * 연결마다 randomUUID를 새로 만들면, 편집자가 페이지를 리로드할 때 직전 연결의 편집 lease(서버에 최대 20s
 * 잔존)가 "다른 clientId"에 묶여 board_claim_editor CAS(editor IS NULL OR lease<now OR editor=client)를
 * 모두 통과 못 한다 → 자기 자신을 못 뺏고 lease 만료(20s)까지 읽기 모드에 갇힌다("편집권 가져오면 바로 뺐김").
 *
 * sessionStorage라 같은 탭 리로드는 동일 id(서버 row의 editor=client 분기로 자기 lease 즉시 재획득),
 * 새 탭/다른 기기는 다른 id(단일 편집자 보장 유지).
 */
export function getClientId(): string {
	try {
		const saved = sessionStorage.getItem(CLIENT_ID_KEY);
		if (saved) return saved;
		const id = crypto.randomUUID();
		sessionStorage.setItem(CLIENT_ID_KEY, id);
		return id;
	} catch {
		// sessionStorage 불가 — 이 연결 한정 임시 id(리로드 재획득 이점은 없으나 동작은 유지)
		return crypto.randomUUID();
	}
}
