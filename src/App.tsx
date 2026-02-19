import { useState, useEffect } from 'react'
import type { Player, SessionSettings } from './types'
import Home from './components/Home'
import SessionSetup from './components/SessionSetup'
import SessionMain from './components/SessionMain'

type Screen = 'home' | 'setup' | 'session'

interface SessionInit {
  selected: Player[]
  settings: SessionSettings
}

const SAVE_KEY = 'bmt_session_players'
const APP_SESSION_KEY = 'bmt_app_session'

interface AppSession {
  allPlayers: Player[]
  scriptUrl: string
  sessionInit: SessionInit
}

function loadSavedNames(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return null
  }
}

function loadAppSession(): AppSession | null {
  try {
    const raw = localStorage.getItem(APP_SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AppSession
  } catch {
    return null
  }
}

export default function App() {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (dark: boolean) => {
      document.documentElement.classList.toggle('dark', dark)
    }
    apply(mq.matches)
    const handler = (e: MediaQueryListEvent) => apply(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const [screen, setScreen] = useState<Screen>(() => loadAppSession() ? 'session' : 'home')
  const [allPlayers, setAllPlayers] = useState<Player[]>(() => loadAppSession()?.allPlayers ?? [])
  const [scriptUrl, setScriptUrl] = useState(() => loadAppSession()?.scriptUrl ?? '')
  const [savedNames, setSavedNames] = useState<Set<string> | null>(() => loadAppSession() ? loadSavedNames() : null)
  const [sessionInit, setSessionInit] = useState<SessionInit | null>(() => loadAppSession()?.sessionInit ?? null)

  function handleHomeStart(players: Player[], url: string) {
    setAllPlayers(players)
    setScriptUrl(url)
    setSavedNames(loadSavedNames())
    setScreen('setup')
  }

  function handleSetupStart(selected: Player[], settings: SessionSettings) {
    localStorage.setItem(SAVE_KEY, JSON.stringify(selected.map(p => p.name)))
    const init = { selected, settings }
    localStorage.setItem(APP_SESSION_KEY, JSON.stringify({ allPlayers, scriptUrl, sessionInit: init }))
    setSessionInit(init)
    setScreen('session')
  }

  function handleSessionEnd() {
    localStorage.removeItem(SAVE_KEY)
    localStorage.removeItem(APP_SESSION_KEY)
    setSavedNames(null)
    setSessionInit(null)
    setScreen('setup')
  }

  function handleUpdatePlayer(updated: Player) {
    setAllPlayers(prev => prev.map(p => p.id === updated.id ? updated : p))
  }

  return (
    <div className="max-w-sm mx-auto">
      <div className={screen !== 'home' ? 'hidden' : ''}>
        <Home onStart={handleHomeStart} />
      </div>

      {allPlayers.length > 0 && (
        <div className={screen !== 'setup' ? 'hidden' : ''}>
          <SessionSetup
            players={allPlayers}
            savedNames={savedNames}
            scriptUrl={scriptUrl}
            onUpdatePlayer={handleUpdatePlayer}
            onStart={handleSetupStart}
            onBack={() => setScreen('home')}
          />
        </div>
      )}

      {sessionInit && (
        <div className={screen !== 'session' ? 'hidden' : ''}>
          <SessionMain
            initialPlayers={sessionInit.selected}
            settings={sessionInit.settings}
            onBack={() => setScreen('setup')}
            onEnd={handleSessionEnd}
          />
        </div>
      )}
    </div>
  )
}
