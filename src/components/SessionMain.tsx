import { useState, useEffect, useRef } from 'react'
import type { Player, Court, PairHistory, SessionSettings, GeneratedTeam } from '../types'
import { generateTeam, recordHistory } from '../lib/teamGenerator'
import TeamDialog from './TeamDialog'

interface Props {
  initialPlayers: Player[]
  settings: SessionSettings
  onBack: () => void
  onEnd: () => void
}

const GAME_TYPE_COLOR: Record<string, string> = {
  혼복: 'bg-purple-100 text-purple-700',
  남복: 'bg-blue-100 text-blue-700',
  여복: 'bg-pink-100 text-pink-700',
  혼합: 'bg-orange-100 text-orange-700',
}

export default function SessionMain({ initialPlayers, settings, onBack, onEnd }: Props) {
  const [courts, setCourts] = useState<Court[]>(
    Array.from({ length: settings.courtCount }, (_, i) => ({ id: i + 1, team: null }))
  )
  const [waiting, setWaiting] = useState<Player[]>(initialPlayers)
  const [history, setHistory] = useState<PairHistory>({})
  const [pendingTeam, setPendingTeam] = useState<GeneratedTeam | null>(null)
  const [showEndConfirm, setShowEndConfirm] = useState(false)

  // initialPlayers 변경 시 대기열만 diff 업데이트 (코트 상태 유지)
  const courtsRef = useRef(courts)
  courtsRef.current = courts
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    const onCourtIds = new Set(
      courtsRef.current.flatMap(c => c.team ? [...c.team.teamA, ...c.team.teamB].map(p => p.id) : [])
    )
    const newIds = new Set(initialPlayers.map(p => p.id))
    setWaiting(prev => {
      const kept = prev.filter(p => newIds.has(p.id))
      const keptIds = new Set(kept.map(p => p.id))
      const added = initialPlayers.filter(p => !keptIds.has(p.id) && !onCourtIds.has(p.id))
      return [...kept, ...added]
    })
  }, [initialPlayers])

  function handleGenerate() {
    const team = generateTeam(waiting, history, settings.allowSingleWoman)
    if (!team) return
    setPendingTeam(team)
  }

  function handleAssign(courtId: number) {
    if (!pendingTeam) return
    const assigned = [...pendingTeam.teamA, ...pendingTeam.teamB]
    setCourts(prev => prev.map(c => c.id === courtId ? { ...c, team: pendingTeam } : c))
    setWaiting(prev => prev.filter(p => !assigned.some(a => a.id === p.id)))
    setHistory(prev => recordHistory(prev, pendingTeam))
    setPendingTeam(null)
  }

  function handleComplete(courtId: number) {
    const court = courts.find(c => c.id === courtId)
    if (!court?.team) return
    const returning = [...court.team.teamA, ...court.team.teamB]
    setCourts(prev => prev.map(c => c.id === courtId ? { ...c, team: null } : c))
    setWaiting(prev => [...prev, ...returning])
  }

  const canGenerate = waiting.length >= 4 && courts.some(c => c.team === null)

  return (
    <div className="min-h-[100dvh] bg-[#ebebf0] flex flex-col max-w-sm mx-auto">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 flex items-center gap-3">
        <button onClick={onBack} className="text-gray-500 text-xl leading-none">←</button>
        <h2 className="font-bold text-gray-800 text-lg flex-1">코트 현황</h2>
        <button
          onClick={() => setShowEndConfirm(true)}
          className="text-sm text-red-400 font-medium border border-red-200 rounded-lg px-3 py-1.5"
        >
          종료
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* 코트 카드들 */}
        {courts.map(court => (
          <div key={court.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {court.team ? (
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-gray-700">코트 {court.id}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${GAME_TYPE_COLOR[court.team.gameType]}`}>
                    {court.team.gameType}
                  </span>
                </div>

                <div className="flex gap-3 items-center">
                  {/* A팀 */}
                  <div className="flex-1 space-y-1">
                    {court.team.teamA.map(p => (
                      <div key={p.id} className="bg-gray-50 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 flex items-center gap-1.5">
                        <span>{p.gender === 'F' ? '🔴' : '🔵'}</span>
                        <span>{p.name}</span>
                      </div>
                    ))}
                  </div>

                  <span className="text-gray-300 font-bold text-sm flex-shrink-0">VS</span>

                  {/* B팀 */}
                  <div className="flex-1 space-y-1">
                    {court.team.teamB.map(p => (
                      <div key={p.id} className="bg-gray-50 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 flex items-center gap-1.5">
                        <span>{p.gender === 'F' ? '🔴' : '🔵'}</span>
                        <span>{p.name}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => handleComplete(court.id)}
                  className="w-full mt-3 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium"
                >
                  완료
                </button>
              </div>
            ) : (
              <div className="p-4 flex items-center justify-between">
                <span className="font-bold text-gray-700">코트 {court.id}</span>
                <span className="text-sm text-gray-300">비어있음</span>
              </div>
            )}
          </div>
        ))}

        {/* 대기열 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <p className="text-sm font-semibold text-gray-500 mb-2">
            대기 <span className="text-blue-500">{waiting.length}</span>명
          </p>
          {waiting.length === 0 ? (
            <p className="text-sm text-gray-300">대기 중인 선수가 없습니다</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {waiting.map((p, idx) => (
                <span
                  key={p.id}
                  className={`text-sm px-3 py-1 rounded-full font-medium ${
                    idx < 4 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {p.gender === 'F' ? '🔴' : '🔵'} {p.name}
                </span>
              ))}
            </div>
          )}
          {waiting.length > 0 && waiting.length < 4 && (
            <p className="text-xs text-red-400 mt-2">{4 - waiting.length}명 더 필요</p>
          )}
        </div>
      </div>

      {/* 팀 생성 버튼 */}
      <div className="p-4 bg-white border-t border-gray-100">
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="w-full bg-blue-500 text-white rounded-2xl py-4 text-lg font-bold shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
        >
          팀 생성
        </button>
        {!canGenerate && waiting.length < 4 && waiting.length > 0 && (
          <p className="text-xs text-center text-gray-400 mt-2">{4 - waiting.length}명 더 필요</p>
        )}
      </div>

      {/* 팀 배정 다이얼로그 */}
      {pendingTeam && (
        <TeamDialog
          team={pendingTeam}
          courts={courts}
          onAssign={handleAssign}
          onCancel={() => setPendingTeam(null)}
        />
      )}

      {/* 종료 확인 */}
      {showEndConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-gray-800 mb-2">세션 종료</h3>
            <p className="text-sm text-gray-500 mb-5">모든 큐가 초기화됩니다.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowEndConfirm(false)}
                className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-600"
              >
                취소
              </button>
              <button
                onClick={onEnd}
                className="flex-1 py-3 bg-red-500 text-white rounded-xl text-sm font-bold"
              >
                종료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
