interface GisTokenResponse {
	access_token: string;
	expires_in: number;
	error?: string;
}

interface GisTokenClient {
	requestAccessToken(opts?: { prompt?: string }): void;
	callback: (response: GisTokenResponse) => void;
}

declare global {
	interface Window {
		google?: {
			accounts: {
				oauth2: {
					initTokenClient(config: {
						client_id: string;
						scope: string;
						callback: (response: GisTokenResponse) => void;
					}): GisTokenClient;
				};
			};
		};
	}
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
export const OAUTH_AVAILABLE = !!CLIENT_ID;

let _client: GisTokenClient | null = null;
let _cachedToken = "";
let _tokenExpiry = 0;
let _loadPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
	if (_loadPromise) return _loadPromise;

	_loadPromise = new Promise((resolve, reject) => {
		if (window.google?.accounts?.oauth2) {
			resolve();
			return;
		}

		const existingScript = document.querySelector(
			'script[src="https://accounts.google.com/gsi/client"]',
		) as HTMLScriptElement;

		if (existingScript) {
			// If it's already in the DOM but window.google is not available,
			// it might be still loading or failed.
			let attempts = 0;
			const interval = setInterval(() => {
				if (window.google?.accounts?.oauth2) {
					clearInterval(interval);
					resolve();
				} else if (attempts >= 30) { // 3 seconds
					clearInterval(interval);
					reject(new Error("Google 로그인 라이브러리 로드 시간 초과. 광고 차단기를 확인해주세요."));
				}
				attempts++;
			}, 100);

			existingScript.addEventListener("error", () => {
				clearInterval(interval);
				reject(new Error("Google 로그인 라이브러리 로드 실패. 광고 차단기를 확인해주세요."));
			});
			return;
		}

		const script = document.createElement("script");
		script.src = "https://accounts.google.com/gsi/client";
		script.async = true;
		script.defer = true;
		script.onload = () => resolve();
		script.onerror = () =>
			reject(new Error("Google 로그인 라이브러리 로드 실패. 광고 차단기를 확인해주세요."));
		document.head.appendChild(script);
	});

	_loadPromise.catch(() => {
		_loadPromise = null;
	});

	return _loadPromise;
}

function ensureClient(): boolean {
	if (_client) return true;
	if (!window.google?.accounts?.oauth2 || !CLIENT_ID) return false;
	_client = window.google.accounts.oauth2.initTokenClient({
		client_id: CLIENT_ID,
		scope: "https://www.googleapis.com/auth/spreadsheets",
		callback: () => {},
	});
	return true;
}

export async function requestAccessToken(): Promise<string> {
	if (_cachedToken && Date.now() < _tokenExpiry) {
		return _cachedToken;
	}

	await loadGoogleScript();

	return new Promise((resolve, reject) => {
		if (!ensureClient()) {
			reject(
				new Error("Google 로그인 라이브러리 초기화 실패. 잠시 후 다시 시도하세요."),
			);
			return;
		}
		_client!.callback = (response) => {
			if (response.error) {
				reject(new Error(response.error));
				return;
			}
			_cachedToken = response.access_token;
			_tokenExpiry = Date.now() + (response.expires_in - 60) * 1000;
			resolve(response.access_token);
		};
		_client!.requestAccessToken({ prompt: _cachedToken ? "" : undefined });
	});
}
