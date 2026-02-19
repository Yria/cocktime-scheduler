import { useState, useMemo } from 'react'
import type { Player, PlayerSkills, SkillLevel, Gender, SessionSettings } from '../types'
import { updatePlayer, updatePlayerWithToken } from '../lib/sheetsApi'
import { OAUTH_AVAILABLE, requestAccessToken } from '../lib/googleAuth'

interface Props {
  players: Player[]
  savedNames: Set<string> | null
  scriptUrl: string
  onUpdatePlayer: (player: Player) => void
  onStart: (selected: Player[], settings: SessionSettings) => void
  onBack: () => void
}

type GenderFilter = 'all' | 'M' | 'F'

const SKILLS: (keyof PlayerSkills)[] = ['클리어', '스매시', '로테이션', '드랍', '헤어핀', '드라이브', '백핸드']
const SKILL_LEVELS: SkillLevel[] = ['O', 'V', 'X']
const SKILL_LEVEL_LABEL: Record<SkillLevel, string> = { O: '상', V: '중', X: '하' }

const DEFAULT_SKILLS: PlayerSkills = {
  클리어: 'V', 스매시: 'V', 로테이션: 'V', 드랍: 'V', 헤어핀: 'V', 드라이브: 'V', 백핸드: 'V',
}

const devSelectedNames = import.meta.env.VITE_DEV_SELECTED
  ? new Set((import.meta.env.VITE_DEV_SELECTED as string).split(',').map(n => n.trim()))
  : null

export default function SessionSetup({ players, savedNames, scriptUrl, onUpdatePlayer, onStart, onBack }: Props) {
  const [courtCount, setCourtCount] = useState(2)
  const [singleWomanIds, setSingleWomanIds] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(() => {
    const namesToSelect = savedNames ?? devSelectedNames
    if (namesToSelect) {
      return new Set(players.filter(p => namesToSelect.has(p.name)).map(p => p.id))
    }
    return new Set(players.map(p => p.id))
  })
  const [search, setSearch] = useState('')
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all')

  // 게스트
  const [guests, setGuests] = useState<Player[]>([])
  const [showGuestModal, setShowGuestModal] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [guestGender, setGuestGender] = useState<Gender>('M')
  const [guestSkills, setGuestSkills] = useState<PlayerSkills>({ ...DEFAULT_SKILLS })

  function openGuestModal() {
    setGuestName('')
    setGuestGender('M')
    setGuestSkills({ ...DEFAULT_SKILLS })
    setShowGuestModal(true)
  }

  function addGuest() {
    const name = guestName.trim()
    if (!name) return
    const id = `guest-${Date.now()}`
    const newGuest: Player = { id, name, gender: guestGender, skills: { ...guestSkills } }
    setGuests(prev => [...prev, newGuest])
    setSelected(prev => new Set([...prev, id]))
    setShowGuestModal(false)
  }

  function removeGuest(id: string) {
    setGuests(prev => prev.filter(g => g.id !== id))
    setSelected(prev => { const next = new Set(prev); next.delete(id); return next })
    setSingleWomanIds(prev => { const next = new Set(prev); next.delete(id); return next })
  }

  // 편집 상태
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null)
  const [editGender, setEditGender] = useState<Gender>('M')
  const [editSkills, setEditSkills] = useState<PlayerSkills>({} as PlayerSkills)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  const filtered = useMemo(() => {
    return players.filter(p => {
      const matchName = p.name.includes(search)
      const matchGender = genderFilter === 'all' || p.gender === genderFilter
      return matchName && matchGender
    })
  }, [players, search, genderFilter])

  const filteredGuests = useMemo(() => {
    return guests.filter(p => {
      const matchName = p.name.includes(search)
      const matchGender = genderFilter === 'all' || p.gender === genderFilter
      return matchName && matchGender
    })
  }, [guests, search, genderFilter])

  function togglePlayer(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    const allFilteredPlayers = [...filtered, ...filteredGuests]
    const allSelected = allFilteredPlayers.every(p => selected.has(p.id))
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelected) allFilteredPlayers.forEach(p => next.delete(p.id))
      else allFilteredPlayers.forEach(p => next.add(p.id))
      return next
    })
  }

  const allPlayers = useMemo(() => [...players, ...guests], [players, guests])

  const selectedFemales = useMemo(
    () => allPlayers.filter(p => p.gender === 'F' && selected.has(p.id)),
    [allPlayers, selected]
  )

  function toggleSingleWoman(id: string) {
    setSingleWomanIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleStart() {
    const selectedPlayers = allPlayers.filter(p => selected.has(p.id))
    const validSingleWomanIds = selectedPlayers
      .filter(p => p.gender === 'F' && singleWomanIds.has(p.id))
      .map(p => p.id)
    onStart(selectedPlayers, { courtCount, singleWomanIds: validSingleWomanIds })
  }

  function openEdit(e: React.MouseEvent, player: Player) {
    e.stopPropagation()
    setEditingPlayer(player)
    setEditGender(player.gender)
    setEditSkills({ ...player.skills })
    setEditError('')
  }

  async function handleSave() {
    if (!editingPlayer) return
    // 게스트는 시트에 저장하지 않음
    if (editingPlayer.id.startsWith('guest-')) {
      setGuests(prev => prev.map(g => g.id === editingPlayer.id
        ? { ...g, gender: editGender, skills: { ...editSkills } }
        : g
      ))
      setEditingPlayer(null)
      return
    }
    setEditSaving(true)
    setEditError('')
    try {
      if (OAUTH_AVAILABLE) {
        const token = await requestAccessToken()
        await updatePlayerWithToken(token, editingPlayer.name, editGender, editSkills)
      } else if (scriptUrl) {
        await updatePlayer(scriptUrl, editingPlayer.name, editGender, editSkills)
      } else {
        throw new Error('저장 방법이 설정되지 않았습니다 (OAuth Client ID 또는 Script URL 필요)')
      }
      onUpdatePlayer({ ...editingPlayer, gender: editGender, skills: editSkills })
      setEditingPlayer(null)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setEditSaving(false)
    }
  }

  const selectedCount = allPlayers.filter(p => selected.has(p.id)).length
  const allFilteredSelected =
    [...filtered, ...filteredGuests].length > 0 &&
    [...filtered, ...filteredGuests].every(p => selected.has(p.id))

  return (
    <div className="h-[100dvh] bg-[#ebebf0] dark:bg-[#1c1c1e] flex flex-col max-w-sm mx-auto">
      {/* Header */}
      <div className="bg-white dark:bg-[#2c2c2e] border-b border-gray-100 dark:border-gray-700 px-4 py-4 flex items-center gap-3">
        <button onClick={onBack} className="text-gray-500 dark:text-gray-400 text-xl leading-none">←</button>
        <h2 className="font-bold text-gray-800 dark:text-white text-lg">세션 설정</h2>
      </div>

      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        {/* 코트 수 */}
        <div className="bg-white dark:bg-[#2c2c2e] rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 flex-shrink-0">
          <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3">코트 수</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5, 6].map(n => (
              <button
                key={n}
                onClick={() => setCourtCount(n)}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-colors ${
                  courtCount === n ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-[#3a3a3c] text-gray-600 dark:text-gray-300'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* 혼복 허용 여성 */}
        {selectedFemales.length > 0 && (
          <div className="bg-white dark:bg-[#2c2c2e] rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 flex-shrink-0">
            <p className="font-medium text-gray-800 dark:text-white text-sm mb-0.5">혼복 허용 여성</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">선택된 여성은 남3여1 구성에서 1인 배치 허용</p>
            <div className="flex flex-wrap gap-2">
              {selectedFemales.map(p => (
                <button
                  key={p.id}
                  onClick={() => toggleSingleWoman(p.id)}
                  className={`text-sm px-3 py-1.5 rounded-full font-medium transition-colors ${
                    singleWomanIds.has(p.id)
                      ? 'bg-pink-500 text-white'
                      : 'bg-gray-100 dark:bg-[#3a3a3c] text-gray-500 dark:text-gray-400'
                  }`}
                >
                  🔴 {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 참석자 */}
        <div className="bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden flex-1 flex flex-col min-h-0">
          <div className="px-4 pt-4 pb-2 flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                참석자 <span className="text-blue-500">{selectedCount}</span> / {allPlayers.length}명
                {guests.length > 0 && (
                  <span className="text-xs text-orange-400 ml-1">(게스트 {guests.length})</span>
                )}
              </p>
              <div className="flex items-center gap-3">
                <button onClick={toggleAll} className="text-xs text-blue-500 font-medium">
                  {allFilteredSelected ? '전체해제' : '전체선택'}
                </button>
                <button
                  onClick={openGuestModal}
                  className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-500 dark:text-orange-400 font-semibold px-2.5 py-1 rounded-lg"
                >
                  + 게스트
                </button>
              </div>
            </div>

            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="이름 검색..."
              className="w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#3a3a3c] text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-2"
            />

            <div className="flex gap-2 mb-1">
              {(['all', 'M', 'F'] as GenderFilter[]).map(g => (
                <button
                  key={g}
                  onClick={() => setGenderFilter(g)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    genderFilter === g ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-[#3a3a3c] text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {g === 'all' ? '전체' : g === 'M' ? '남자' : '여자'}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-gray-50 dark:divide-gray-700/50 overflow-y-auto">
            {filtered.map(player => (
              <div key={player.id} className="flex items-center px-4 py-3 gap-3">
                <button
                  onClick={() => togglePlayer(player.id)}
                  className="flex items-center gap-3 flex-1 text-left min-w-0"
                >
                  <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    selected.has(player.id)
                      ? 'bg-blue-500 border-blue-500 text-white'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}>
                    {selected.has(player.id) && <span className="text-xs">✓</span>}
                  </span>
                  <span className="text-lg flex-shrink-0">{player.gender === 'F' ? '🔴' : '🔵'}</span>
                  <span className="font-medium text-gray-800 dark:text-gray-100 text-sm truncate">{player.name}</span>
                </button>
                <button
                  onClick={e => openEdit(e, player)}
                  className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 flex-shrink-0 px-1 text-sm"
                >
                  ✎
                </button>
              </div>
            ))}

            {/* 게스트 목록 */}
            {filteredGuests.map(guest => (
              <div key={guest.id} className="flex items-center px-4 py-3 gap-3 bg-orange-50/50 dark:bg-orange-900/10">
                <button
                  onClick={() => togglePlayer(guest.id)}
                  className="flex items-center gap-3 flex-1 text-left min-w-0"
                >
                  <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    selected.has(guest.id)
                      ? 'bg-blue-500 border-blue-500 text-white'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}>
                    {selected.has(guest.id) && <span className="text-xs">✓</span>}
                  </span>
                  <span className="text-lg flex-shrink-0">{guest.gender === 'F' ? '🔴' : '🔵'}</span>
                  <span className="font-medium text-gray-800 dark:text-gray-100 text-sm truncate">{guest.name}</span>
                  <span className="text-xs text-orange-400 font-medium flex-shrink-0">게스트</span>
                </button>
                <button
                  onClick={e => openEdit(e, guest)}
                  className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 flex-shrink-0 px-1 text-sm"
                >
                  ✎
                </button>
                <button
                  onClick={() => removeGuest(guest.id)}
                  className="text-red-300 dark:text-red-700 hover:text-red-500 flex-shrink-0 px-1 text-sm"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="p-4 bg-white dark:bg-[#2c2c2e] border-t border-gray-100 dark:border-gray-700">
        <button
          onClick={handleStart}
          disabled={selectedCount < 4}
          className="w-full bg-blue-500 text-white rounded-2xl py-4 text-lg font-bold shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
        >
          세션 시작 ({selectedCount}명)
        </button>
      </div>

      {/* 게스트 추가 모달 */}
      {showGuestModal && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 px-4 pb-6">
          <div className="bg-white dark:bg-[#2c2c2e] w-full max-w-sm rounded-3xl shadow-xl overflow-hidden max-h-[90dvh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
              <h3 className="font-bold text-gray-800 dark:text-white text-lg">게스트 추가</h3>
              <button onClick={() => setShowGuestModal(false)} className="text-gray-400 dark:text-gray-500 text-xl leading-none">✕</button>
            </div>

            <div className="overflow-y-auto px-5 pb-2 space-y-4">
              {/* 이름 */}
              <div>
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2">이름</p>
                <input
                  type="text"
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addGuest()}
                  placeholder="게스트 이름 입력"
                  autoFocus
                  className="w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#3a3a3c] text-gray-800 dark:text-gray-100 placeholder-gray-400 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              {/* 성별 */}
              <div>
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2">성별</p>
                <div className="flex gap-2">
                  {(['M', 'F'] as Gender[]).map(g => (
                    <button
                      key={g}
                      onClick={() => setGuestGender(g)}
                      className={`flex-1 py-2 rounded-xl text-sm font-bold transition-colors ${
                        guestGender === g ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-[#3a3a3c] text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      {g === 'M' ? '🔵 남' : '🔴 여'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 스킬 */}
              <div>
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2">스킬 <span className="font-normal text-gray-400">(기본값: 중)</span></p>
                <div className="space-y-2">
                  {SKILLS.map(skill => (
                    <div key={skill} className="flex items-center gap-3">
                      <span className="text-sm text-gray-600 dark:text-gray-300 w-16 flex-shrink-0">{skill}</span>
                      <div className="flex gap-1.5 flex-1">
                        {SKILL_LEVELS.map(level => (
                          <button
                            key={level}
                            onClick={() => setGuestSkills(prev => ({ ...prev, [skill]: level }))}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                              guestSkills[skill] === level
                                ? level === 'O' ? 'bg-green-500 text-white'
                                  : level === 'V' ? 'bg-yellow-400 text-white'
                                  : 'bg-gray-400 text-white'
                                : 'bg-gray-100 dark:bg-[#3a3a3c] text-gray-500 dark:text-gray-400'
                            }`}
                          >
                            {SKILL_LEVEL_LABEL[level]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex gap-3 flex-shrink-0">
              <button
                onClick={() => setShowGuestModal(false)}
                className="flex-1 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300"
              >
                취소
              </button>
              <button
                onClick={addGuest}
                disabled={!guestName.trim()}
                className="flex-1 py-3 bg-orange-500 text-white rounded-xl text-sm font-bold disabled:opacity-40"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 멤버 편집 모달 */}
      {editingPlayer && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 px-4 pb-6">
          <div className="bg-white dark:bg-[#2c2c2e] w-full max-w-sm rounded-3xl shadow-xl overflow-hidden max-h-[90dvh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-gray-800 dark:text-white text-lg">{editingPlayer.name}</h3>
                {editingPlayer.id.startsWith('guest-') && (
                  <span className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-500 px-2 py-0.5 rounded-full font-medium">게스트</span>
                )}
              </div>
              <button onClick={() => setEditingPlayer(null)} className="text-gray-400 dark:text-gray-500 text-xl leading-none">✕</button>
            </div>

            <div className="overflow-y-auto px-5 pb-2 space-y-4">
              {/* 성별 */}
              <div>
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2">성별</p>
                <div className="flex gap-2">
                  {(['M', 'F'] as Gender[]).map(g => (
                    <button
                      key={g}
                      onClick={() => setEditGender(g)}
                      className={`flex-1 py-2 rounded-xl text-sm font-bold transition-colors ${
                        editGender === g ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-[#3a3a3c] text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      {g === 'M' ? '🔵 남' : '🔴 여'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 스킬 */}
              <div>
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2">스킬</p>
                <div className="space-y-2">
                  {SKILLS.map(skill => (
                    <div key={skill} className="flex items-center gap-3">
                      <span className="text-sm text-gray-600 dark:text-gray-300 w-16 flex-shrink-0">{skill}</span>
                      <div className="flex gap-1.5 flex-1">
                        {SKILL_LEVELS.map(level => (
                          <button
                            key={level}
                            onClick={() => setEditSkills(prev => ({ ...prev, [skill]: level }))}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                              editSkills[skill] === level
                                ? level === 'O' ? 'bg-green-500 text-white'
                                  : level === 'V' ? 'bg-yellow-400 text-white'
                                  : 'bg-gray-400 text-white'
                                : 'bg-gray-100 dark:bg-[#3a3a3c] text-gray-500 dark:text-gray-400'
                            }`}
                          >
                            {SKILL_LEVEL_LABEL[level]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {editError && <p className="text-red-500 dark:text-red-400 text-sm">{editError}</p>}
              {!editingPlayer.id.startsWith('guest-') && (
                OAUTH_AVAILABLE ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500">저장 시 구글 로그인 팝업이 뜰 수 있습니다</p>
                ) : !scriptUrl ? (
                  <p className="text-xs text-orange-400">저장 방법 미설정 — 시트에 반영되지 않습니다</p>
                ) : null
              )}
              {editingPlayer.id.startsWith('guest-') && (
                <p className="text-xs text-orange-400">게스트는 세션 내에서만 유지됩니다</p>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex gap-3 flex-shrink-0">
              <button
                onClick={() => setEditingPlayer(null)}
                className="flex-1 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={editSaving}
                className="flex-1 py-3 bg-blue-500 text-white rounded-xl text-sm font-bold disabled:opacity-50"
              >
                {editSaving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
