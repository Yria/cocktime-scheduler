/**
 * installPromptStore
 *
 * 홈 화면에 PWA(콕타임)를 "홈 화면에 추가"하도록 유도하는 토스트의 상태.
 * - Android/Chrome 계열: beforeinstallprompt 를 가로채 원탭 네이티브 설치 프롬프트를 띄운다.
 * - iOS/그 외: 네이티브 프롬프트가 없어 공유 → '홈 화면에 추가' 이미지 안내(InstallGuide)로 유도.
 * - 이미 설치(standalone)·사용자가 닫음(localStorage)·인앱 브라우저·데스크톱은 노출하지 않는다.
 *
 * 이벤트는 컴포넌트 마운트 전에 발생할 수 있어(엔진 휴리스틱) 모듈 로드 시 top-level 로 리스너를 건다.
 * main.tsx 에서 side-effect import 로 앱 시작 시 등록되도록 한다.
 */
import { create } from "zustand";
import { isAndroid, isIOS, isStandalone } from "../lib/push/platform";

const DISMISS_KEY = "cocktime-install-dismissed-v1";

/** beforeinstallprompt — 표준에 타입이 없어 필요한 부분만 선언. */
interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallPromptState {
	/** 캡처한 네이티브 설치 프롬프트(있으면 원탭 설치 가능). Android/Chrome 계열만. */
	deferred: BeforeInstallPromptEvent | null;
	/** 사용자가 유도 토스트를 닫았는가(localStorage 영속). */
	dismissed: boolean;
	/** 이번 세션에서 설치 완료(appinstalled) 되었는가. */
	installed: boolean;
}

function readDismissed(): boolean {
	try {
		return localStorage.getItem(DISMISS_KEY) === "1";
	} catch {
		return false;
	}
}

export const useInstallPromptStore = create<InstallPromptState>(() => ({
	deferred: null,
	dismissed: readDismissed(),
	installed: false,
}));

// 인앱 브라우저(카카오톡·인스타 등)는 홈 화면 설치가 막혀 유도해도 소용없음 → 제외.
function isInAppBrowser(): boolean {
	const ua = navigator.userAgent || "";
	return /KAKAOTALK|Instagram|FBAN|FBAV|FB_IAB|Line\/|NAVER\(inapp|DaumApps|everytimeApp|Snapchat/i.test(
		ua,
	);
}

/** 유도 토스트 노출 조건: 모바일 · 미설치 · 미닫음 · 미설치완료 · 인앱 아님. */
export function shouldShowInstallPrompt(s: InstallPromptState): boolean {
	if (s.dismissed || s.installed) return false;
	if (isStandalone()) return false; // 이미 홈 화면 앱으로 실행 중
	if (!(isIOS() || isAndroid())) return false; // 모바일에서만 유도(데스크톱 제외)
	if (isInAppBrowser()) return false;
	return true;
}

export const installPromptActions = {
	/** 유도 토스트 닫기(다시 뜨지 않게 영속 기록). */
	dismiss() {
		try {
			localStorage.setItem(DISMISS_KEY, "1");
		} catch {
			/* 프라이빗 모드 등 localStorage 불가 — 이번 세션만 숨김 */
		}
		useInstallPromptStore.setState({ dismissed: true });
	},

	/** 네이티브 설치 프롬프트 실행(Android/Chrome). 반환: 'accepted'|'dismissed'|'unavailable'. */
	async promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
		const { deferred } = useInstallPromptStore.getState();
		if (!deferred) return "unavailable";
		await deferred.prompt();
		const choice = await deferred.userChoice;
		// 프롬프트 이벤트는 1회용 — 소진 후 폐기.
		useInstallPromptStore.setState({ deferred: null });
		if (choice.outcome === "accepted") installPromptActions.dismiss();
		return choice.outcome;
	},
};

// ── 모듈 로드 시 전역 이벤트 캡처 ──
if (typeof window !== "undefined") {
	window.addEventListener("beforeinstallprompt", (e) => {
		e.preventDefault(); // 브라우저 기본 미니 인포바 억제 → 우리 토스트로 유도
		useInstallPromptStore.setState({
			deferred: e as BeforeInstallPromptEvent,
		});
	});
	window.addEventListener("appinstalled", () => {
		useInstallPromptStore.setState({ installed: true, deferred: null });
		try {
			localStorage.setItem(DISMISS_KEY, "1");
		} catch {
			/* noop */
		}
	});
}
