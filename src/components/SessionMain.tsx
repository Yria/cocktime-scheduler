import { useState, useEffect, useRef } from 'react'
import type { Player, Court, PairHistory, MixedHistory, GameCountHistory, SessionSettings, GeneratedTeam, ReservedGroup } from '../types'
import { generateTeam, generateTeamFromPlayers, recordHistory, recordMixedHistory, recordGameCount } from '../lib/teamGenerator'
import TeamDialog from './TeamDialog'

interface Props {
  initialPlayers: Player[]
  settings: SessionSettings
  onBack: () => void
  onEnd: () => void
}

const SESSION_STATE_KEY = 'bmt_session_state'

function loadSessionState() {
  try {
    const raw = localStorage.getItem(SESSION_STATE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    const history: PairHistory = Object.fromEntries(
      Object.entries(data.history as Record<string, string[]>).map(([k, v]) => [k, new Set(v)])
    )
    return {
      courts: data.courts as Court[],
      waiting: data.waiting as Player[],
      history,
      mixedHistory: data.mixedHistory as MixedHistory,
      gameCountHistory: data.gameCountHistory as GameCountHistory,
      reservedGroups: data.reservedGroups as ReservedGroup[],
    }
  } catch {
    return null
  }
}

const GAME_TYPE_COLOR: Record<string, string> = {
  혼복: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300',
  남복: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  여복: 'bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300',
  혼합: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
}

export default function SessionMain({ initialPlayers, settings, onBack, onEnd }: Props) {
  const [courts, setCourts] = useState<Court[]>(() =>
    loadSessionState()?.courts ?? Array.from({ length: settings.courtCount }, (_, i) => ({ id: i + 1, team: null }))
  )
  const [waiting, setWaiting] = useState<Player[]>(() => loadSessionState()?.waiting ?? initialPlayers)
  const [history, setHistory] = useState<PairHistory>(() => loadSessionState()?.history ?? {})
  const [mixedHistory, setMixedHistory] = useState<MixedHistory>(() => loadSessionState()?.mixedHistory ?? {})
  const [gameCountHistory, setGameCountHistory] = useState<GameCountHistory>(() => loadSessionState()?.gameCountHistory ?? {})
  const [pendingTeam, setPendingTeam] = useState<GeneratedTeam | null>(null)
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null)
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [reservedGroups, setReservedGroups] = useState<ReservedGroup[]>(() => loadSessionState()?.reservedGroups ?? [])
  const [showReserveModal, setShowReserveModal] = useState(false)
  const [reservingSelected, setReservingSelected] = useState<Set<string>>(new Set())

  const courtsRef = useRef(courts)
  courtsRef.current = courts
  const reservedGroupsRef = useRef(reservedGroups)
  reservedGroupsRef.current = reservedGroups
  const isFirstRender = useRef(true)

  useEffect(() => {
    try {
      localStorage.setItem(SESSION_STATE_KEY, JSON.stringify({
        courts,
        waiting,
        history: Object.fromEntries(Object.entries(history).map(([k, v]) => [k, [...v]])),
        mixedHistory,
        gameCountHistory,
        reservedGroups,
      }))
    } catch {}
  }, [courts, waiting, history, mixedHistory, gameCountHistory, reservedGroups])

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    const onCourtIds = new Set(
      courtsRef.current.flatMap(c => c.team ? [...c.team.teamA, ...c.team.teamB].map(p => p.id) : [])
    )
    // Exclude players in reserved groups (both ready and still on-court)
    const reservedIds = new Set(reservedGroupsRef.current.flatMap(g => g.players.map(p => p.id)))
    const newIds = new Set(initialPlayers.map(p => p.id))
    setWaiting(prev => {
      const kept = prev.filter(p => newIds.has(p.id))
      const keptIds = new Set(kept.map(p => p.id))
      const added = initialPlayers.filter(p => !keptIds.has(p.id) && !onCourtIds.has(p.id) && !reservedIds.has(p.id))
      return [...kept, ...added]
    })
  }, [initialPlayers])

  function handleGenerate() {
    const team = generateTeam(waiting, history, mixedHistory, gameCountHistory, settings.singleWomanIds)
    if (!team) return
    setPendingTeam(team)
    setPendingGroupId(null)
  }

  function handleAssignGroup(groupId: string) {
    const group = reservedGroups.find(g => g.id === groupId)
    if (!group || group.players.length !== 4 || group.readyIds.length !== 4) return
    const team = generateTeamFromPlayers(
      group.players as [Player, Player, Player, Player],
      history,
      settings.singleWomanIds
    )
    setPendingTeam(team)
    setPendingGroupId(groupId)
  }

  function handleAssign(courtId: number) {
    if (!pendingTeam) return
    const assigned = [...pendingTeam.teamA, ...pendingTeam.teamB]
    setCourts(prev => prev.map(c => c.id === courtId ? { ...c, team: pendingTeam } : c))
    // assigned players were already removed from waiting (they were in readyIds of reserved group)
    setWaiting(prev => prev.filter(p => !assigned.some(a => a.id === p.id)))
    setHistory(prev => recordHistory(prev, pendingTeam))
    setMixedHistory(prev => recordMixedHistory(prev, pendingTeam))
    setGameCountHistory(prev => recordGameCount(prev, pendingTeam))
    if (pendingGroupId) {
      setReservedGroups(prev => prev.filter(g => g.id !== pendingGroupId))
      setPendingGroupId(null)
    }
    setPendingTeam(null)
  }

  function handleComplete(courtId: number) {
    const court = courts.find(c => c.id === courtId)
    if (!court?.team) return
    const returning = [...court.team.teamA, ...court.team.teamB]
    setCourts(prev => prev.map(c => c.id === courtId ? { ...c, team: null } : c))

    // Check if any returning player belongs to a reserved group
    const reservedGroupPlayerIds = new Set(reservedGroups.flatMap(g => g.players.map(p => p.id)))
    const toReserved = returning.filter(p => reservedGroupPlayerIds.has(p.id))
    const toWaiting = returning.filter(p => !reservedGroupPlayerIds.has(p.id))

    if (toReserved.length > 0) {
      setReservedGroups(prev => prev.map(g => {
        const newReady = [...g.readyIds]
        for (const p of toReserved) {
          if (g.players.some(gp => gp.id === p.id) && !newReady.includes(p.id)) {
            newReady.push(p.id)
          }
        }
        return { ...g, readyIds: newReady }
      }))
    }

    setWaiting(prev => [...prev, ...toWaiting])
  }

  function handleCreateReservation() {
    if (reservingSelected.size < 2 || reservingSelected.size > 4) return

    const waitingIds = new Set(waiting.map(p => p.id))
    const onCourtPlayers = courts.flatMap(c =>
      c.team ? [...c.team.teamA, ...c.team.teamB] : []
    )
    const allPlayers = [...waiting, ...onCourtPlayers]
    const players = allPlayers.filter(p => reservingSelected.has(p.id))
    const readyIds = [...reservingSelected].filter(id => waitingIds.has(id))

    const groupId = `reserved-${Date.now()}`
    setReservedGroups(prev => [...prev, { id: groupId, players, readyIds }])
    // Remove only waiting players from waiting queue
    setWaiting(prev => prev.filter(p => !reservingSelected.has(p.id)))
    setReservingSelected(new Set())
    setShowReserveModal(false)
  }

  function handleDisbandGroup(groupId: string) {
    const group = reservedGroups.find(g => g.id === groupId)
    if (!group) return
    // Only return players that are currently ready (not on court) back to waiting
    const readyPlayers = group.players.filter(p => group.readyIds.includes(p.id))
    setWaiting(prev => [...prev, ...readyPlayers])
    setReservedGroups(prev => prev.filter(g => g.id !== groupId))
  }

  function toggleReservingPlayer(playerId: string) {
    setReservingSelected(prev => {
      const next = new Set(prev)
      if (next.has(playerId)) {
        next.delete(playerId)
      } else if (next.size < 4) {
        next.add(playerId)
      }
      return next
    })
  }

  const canGenerate = waiting.length >= 4 && courts.some(c => c.team === null)
  const canReserve = (() => {
    const onCourtCount = courts.reduce((n, c) => n + (c.team ? 4 : 0), 0)
    return waiting.length + onCourtCount >= 2
  })()

  // For reserve modal: all players not already in a reserved group
  const reservedPlayerIds = new Set(reservedGroups.flatMap(g => g.players.map(p => p.id)))
  const onCourtPlayers = courts.flatMap(c =>
    c.team ? [...c.team.teamA, ...c.team.teamB] : []
  )
  const courtPlayerMap = new Map<string, number>() // playerId → courtId
  courts.forEach(c => {
    if (c.team) {
      [...c.team.teamA, ...c.team.teamB].forEach(p => courtPlayerMap.set(p.id, c.id))
    }
  })
  const modalPlayers = [
    ...waiting.filter(p => !reservedPlayerIds.has(p.id)),
    ...onCourtPlayers.filter(p => !reservedPlayerIds.has(p.id)),
  ]

  return (
    <div className="min-h-[100dvh] bg-[#ebebf0] dark:bg-[#1c1c1e] flex flex-col max-w-sm mx-auto">
      {/* Header */}
      <div className="bg-white dark:bg-[#2c2c2e] border-b border-gray-100 dark:border-gray-700 px-4 py-4 flex items-center gap-3">
        <button onClick={onBack} className="text-gray-500 dark:text-gray-400 text-xl leading-none">←</button>
        <h2 className="font-bold text-gray-800 dark:text-white text-lg flex-1">코트 현황</h2>
        <button
          onClick={() => setShowEndConfirm(true)}
          className="text-sm text-red-400 font-medium border border-red-200 dark:border-red-800 rounded-lg px-3 py-1.5"
        >
          종료
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* 코트 카드들 */}
        {courts.map(court => (
          <div key={court.id} className="bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            {court.team ? (
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-gray-700 dark:text-gray-200">코트 {court.id}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${GAME_TYPE_COLOR[court.team.gameType]}`}>
                    {court.team.gameType}
                  </span>
                </div>

                <div className="flex gap-3 items-center">
                  <div className="flex-1 space-y-1">
                    {court.team.teamA.map(p => (
                      <div key={p.id} className="bg-gray-50 dark:bg-[#3a3a3c] rounded-lg px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center gap-1.5">
                        <span>{p.gender === 'F' ? '🔴' : '🔵'}</span>
                        <span>{p.name}</span>
                      </div>
                    ))}
                  </div>

                  <span className="text-gray-300 dark:text-gray-600 font-bold text-sm flex-shrink-0">VS</span>

                  <div className="flex-1 space-y-1">
                    {court.team.teamB.map(p => (
                      <div key={p.id} className="bg-gray-50 dark:bg-[#3a3a3c] rounded-lg px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center gap-1.5">
                        <span>{p.gender === 'F' ? '🔴' : '🔵'}</span>
                        <span>{p.name}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => handleComplete(court.id)}
                  className="w-full mt-3 py-2.5 bg-gray-100 dark:bg-[#3a3a3c] text-gray-600 dark:text-gray-300 rounded-xl text-sm font-medium"
                >
                  완료
                </button>
              </div>
            ) : (
              <div className="p-4 flex items-center justify-between">
                <span className="font-bold text-gray-700 dark:text-gray-200">코트 {court.id}</span>
                <span className="text-sm text-gray-300 dark:text-gray-600">비어있음</span>
              </div>
            )}
          </div>
        ))}

        {/* 예약팀 */}
        {reservedGroups.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 px-1">예약팀 {reservedGroups.length}개</p>
            {reservedGroups.map(group => {
              const isFull = group.players.length === 4
              const allReady = group.readyIds.length === group.players.length
              const canAssign = isFull && allReady && courts.some(c => c.team === null)
              const readySet = new Set(group.readyIds)
              return (
                <div
                  key={group.id}
                  className={`bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-sm border overflow-hidden ${
                    allReady && isFull ? 'border-green-200 dark:border-green-800' : 'border-amber-200 dark:border-amber-800'
                  }`}
                >
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        allReady && isFull
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                          : 'bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400'
                      }`}>
                        {allReady && isFull
                          ? '준비완료'
                          : `${group.readyIds.length}/${group.players.length}명 대기중`}
                      </span>
                      <button
                        onClick={() => handleDisbandGroup(group.id)}
                        className="text-xs text-gray-400 dark:text-gray-500 font-medium"
                      >
                        해제
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {group.players.map(p => {
                        const isReady = readySet.has(p.id)
                        const courtId = courtPlayerMap.get(p.id)
                        return (
                          <span
                            key={p.id}
                            className={`text-sm px-3 py-1 rounded-full font-medium flex items-center gap-1 ${
                              isReady
                                ? 'bg-gray-100 dark:bg-[#3a3a3c] text-gray-700 dark:text-gray-200'
                                : 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {p.gender === 'F' ? '🔴' : '🔵'} {p.name}
                            {!isReady && courtId && (
                              <span className="text-xs bg-amber-200 dark:bg-amber-800/60 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full">
                                {courtId}번
                              </span>
                            )}
                          </span>
                        )
                      })}
                    </div>
                    {isFull && (
                      <button
                        onClick={() => handleAssignGroup(group.id)}
                        disabled={!canAssign}
                        className="w-full py-2.5 bg-green-500 text-white rounded-xl text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {allReady ? '코트 배정' : '경기 완료 후 배정 가능'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 대기열 */}
        <div className="bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
          <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">
            대기 <span className="text-blue-500">{waiting.length}</span>명
          </p>
          {waiting.length === 0 ? (
            <p className="text-sm text-gray-300 dark:text-gray-600">대기 중인 선수가 없습니다</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {waiting.map((p) => (
                <span
                  key={p.id}
                  className="text-sm px-3 py-1 rounded-full font-medium bg-gray-100 dark:bg-[#3a3a3c] text-gray-500 dark:text-gray-400"
                >
                  {p.gender === 'F' ? '🔴' : '🔵'} {p.name}
                  <span className="text-xs opacity-50 ml-0.5">{gameCountHistory[p.id] ?? 0}</span>
                </span>
              ))}
            </div>
          )}
          {waiting.length > 0 && waiting.length < 4 && (
            <p className="text-xs text-red-400 mt-2">{4 - waiting.length}명 더 필요</p>
          )}
        </div>
      </div>

      {/* 하단 버튼 영역 */}
      <div className="p-4 bg-white dark:bg-[#2c2c2e] border-t border-gray-100 dark:border-gray-700 space-y-2">
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="w-full bg-blue-500 text-white rounded-2xl py-4 text-lg font-bold shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
        >
          팀 생성
        </button>
        <button
          onClick={() => { setReservingSelected(new Set()); setShowReserveModal(true) }}
          disabled={!canReserve}
          className="w-full bg-white dark:bg-[#3a3a3c] text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-2xl py-3 text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed"
        >
          팀 예약생성
        </button>
        {!canGenerate && waiting.length < 4 && waiting.length > 0 && (
          <p className="text-xs text-center text-gray-400">{4 - waiting.length}명 더 필요</p>
        )}
      </div>

      {/* 팀 배정 다이얼로그 */}
      {pendingTeam && (
        <TeamDialog
          team={pendingTeam}
          courts={courts}
          onAssign={handleAssign}
          onCancel={() => { setPendingTeam(null); setPendingGroupId(null) }}
        />
      )}

      {/* 팀 예약생성 모달 */}
      {showReserveModal && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 px-4 pb-6">
          <div className="bg-white dark:bg-[#2c2c2e] w-full max-w-sm rounded-3xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-2">
              <h3 className="font-bold text-gray-800 dark:text-white text-lg">팀 예약생성</h3>
              <span className={`text-sm font-semibold px-2.5 py-1 rounded-full ${
                reservingSelected.size >= 2
                  ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300'
                  : 'bg-gray-100 dark:bg-[#3a3a3c] text-gray-400 dark:text-gray-500'
              }`}>
                {reservingSelected.size}/4
              </span>
            </div>
            <p className="px-5 pb-4 text-sm text-gray-400 dark:text-gray-500">함께 플레이할 2~4명을 선택하세요</p>

            <div className="px-5 pb-4 max-h-56 overflow-y-auto">
              {modalPlayers.length === 0 ? (
                <p className="text-sm text-gray-300 dark:text-gray-600 text-center py-4">선택 가능한 선수가 없습니다</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {modalPlayers.map(p => {
                    const isSelected = reservingSelected.has(p.id)
                    const isDisabled = !isSelected && reservingSelected.size >= 4
                    const courtId = courtPlayerMap.get(p.id)
                    return (
                      <button
                        key={p.id}
                        onClick={() => toggleReservingPlayer(p.id)}
                        disabled={isDisabled}
                        className={`text-sm px-3 py-1.5 rounded-full font-medium transition-colors flex items-center gap-1 ${
                          isSelected
                            ? 'bg-blue-500 text-white'
                            : isDisabled
                            ? 'bg-gray-50 dark:bg-[#3a3a3c] text-gray-300 dark:text-gray-600 cursor-not-allowed'
                            : courtId
                            ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                            : 'bg-gray-100 dark:bg-[#3a3a3c] text-gray-700 dark:text-gray-200 active:bg-gray-200'
                        }`}
                      >
                        {p.gender === 'F' ? '🔴' : '🔵'} {p.name}
                        {courtId && !isSelected && (
                          <span className="text-xs bg-amber-200 dark:bg-amber-800/60 text-amber-700 dark:text-amber-300 px-1 py-0.5 rounded-full">
                            {courtId}번
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="px-5 pb-5 space-y-2">
              <button
                onClick={handleCreateReservation}
                disabled={reservingSelected.size < 2}
                className="w-full py-3.5 bg-blue-500 text-white rounded-2xl text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed"
              >
                예약 생성 ({reservingSelected.size}명)
              </button>
              <button
                onClick={() => { setShowReserveModal(false); setReservingSelected(new Set()) }}
                className="w-full py-3 text-sm text-gray-400 dark:text-gray-500 font-medium"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 종료 확인 */}
      {showEndConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-6">
          <div className="bg-white dark:bg-[#2c2c2e] rounded-2xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-gray-800 dark:text-white mb-2">세션 종료</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">모든 큐가 초기화됩니다.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowEndConfirm(false)}
                className="flex-1 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300"
              >
                취소
              </button>
              <button
                onClick={() => { localStorage.removeItem(SESSION_STATE_KEY); onEnd() }}
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
