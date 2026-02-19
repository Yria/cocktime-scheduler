import { useState } from 'react'
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

function loadSavedNames(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return null
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [allPlayers, setAllPlayers] = useState<Player[]>([])
  const [scriptUrl, setScriptUrl] = useState('')
  const [savedNames, setSavedNames] = useState<Set<string> | null>(null)
  const [sessionInit, setSessionInit] = useState<SessionInit | null>(null)

  function handleHomeStart(players: Player[], url: string) {
    setAllPlayers(players)
    setScriptUrl(url)
    setSavedNames(loadSavedNames())
    setScreen('setup')
  }

  function handleSetupStart(selected: Player[], settings: SessionSettings) {
    localStorage.setItem(SAVE_KEY, JSON.stringify(selected.map(p => p.name)))
    setSessionInit({ selected, settings })
    setScreen('session')
  }

  function handleSessionEnd() {
    localStorage.removeItem(SAVE_KEY)
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
