interface GisTokenResponse {
  access_token: string
  expires_in: number
  error?: string
}

interface GisTokenClient {
  requestAccessToken(opts?: { prompt?: string }): void
  callback: (response: GisTokenResponse) => void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (response: GisTokenResponse) => void
          }): GisTokenClient
        }
      }
    }
  }
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
export const OAUTH_AVAILABLE = !!CLIENT_ID

let _client: GisTokenClient | null = null
let _cachedToken = ''
let _tokenExpiry = 0

function ensureClient(): boolean {
  if (_client) return true
  if (!window.google?.accounts?.oauth2 || !CLIENT_ID) return false
  _client = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    callback: () => {},
  })
  return true
}

export function requestAccessToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (_cachedToken && Date.now() < _tokenExpiry) {
      resolve(_cachedToken)
      return
    }
    if (!ensureClient()) {
      reject(new Error('Google 로그인 라이브러리 로딩 중. 잠시 후 다시 시도하세요.'))
      return
    }
    _client!.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error))
        return
      }
      _cachedToken = response.access_token
      _tokenExpiry = Date.now() + (response.expires_in - 60) * 1000
      resolve(response.access_token)
    }
    _client!.requestAccessToken({ prompt: _cachedToken ? '' : undefined })
  })
}
