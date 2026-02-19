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

const devSelectedNames = import.meta.env.VITE_DEV_SELECTED
  ? new Set((import.meta.env.VITE_DEV_SELECTED as string).split(',').map(n => n.trim()))
  : null

export default function SessionSetup({ players, savedNames, scriptUrl, onUpdatePlayer, onStart, onBack }: Props) {
  const [courtCount, setCourtCount] = useState(2)
  const [allowSingleWoman, setAllowSingleWoman] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => {
    const namesToSelect = savedNames ?? devSelectedNames
    if (namesToSelect) {
      return new Set(players.filter(p => namesToSelect.has(p.name)).map(p => p.id))
    }
    return new Set(players.map(p => p.id))
  })
  const [search, setSearch] = useState('')
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all')

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

  function togglePlayer(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    const allSelected = filtered.every(p => selected.has(p.id))
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelected) filtered.forEach(p => next.delete(p.id))
      else filtered.forEach(p => next.add(p.id))
      return next
    })
  }

  function handleStart() {
    const selectedPlayers = players.filter(p => selected.has(p.id))
    onStart(selectedPlayers, { courtCount, allowSingleWoman })
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

  const selectedCount = players.filter(p => selected.has(p.id)).length
  const allFilteredSelected = filtered.length > 0 && filtered.every(p => selected.has(p.id))

  return (
    <div className="h-[100dvh] bg-gray-50 flex flex-col max-w-sm mx-auto">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 flex items-center gap-3">
        <button onClick={onBack} className="text-gray-500 text-xl leading-none">←</button>
        <h2 className="font-bold text-gray-800 text-lg">세션 설정</h2>
      </div>

      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        {/* 코트 수 */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex-shrink-0">
          <p className="text-sm font-semibold text-gray-500 mb-3">코트 수</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5, 6].map(n => (
              <button
                key={n}
                onClick={() => setCourtCount(n)}
                className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-colors ${
                  courtCount === n ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* 여자 1명 혼복 허용 */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-800 text-sm">여자 1명 혼복 허용</p>
              <p className="text-xs text-gray-400 mt-0.5">남3여1 구성 허용</p>
            </div>
            <button
              onClick={() => setAllowSingleWoman(!allowSingleWoman)}
              className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${
                allowSingleWoman ? 'bg-blue-500' : 'bg-gray-200'
              }`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                allowSingleWoman ? 'translate-x-6' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
        </div>

        {/* 참석자 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex-1 flex flex-col min-h-0">
          <div className="px-4 pt-4 pb-2 flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-500">
                참석자 <span className="text-blue-500">{selectedCount}</span> / {players.length}명
              </p>
              <button onClick={toggleAll} className="text-xs text-blue-500 font-medium">
                {allFilteredSelected ? '전체해제' : '전체선택'}
              </button>
            </div>

            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="이름 검색..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-2"
            />

            <div className="flex gap-2 mb-1">
              {(['all', 'M', 'F'] as GenderFilter[]).map(g => (
                <button
                  key={g}
                  onClick={() => setGenderFilter(g)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    genderFilter === g ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {g === 'all' ? '전체' : g === 'M' ? '남자' : '여자'}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-gray-50 overflow-y-auto">
            {filtered.map(player => (
              <div key={player.id} className="flex items-center px-4 py-3 gap-3">
                <button
                  onClick={() => togglePlayer(player.id)}
                  className="flex items-center gap-3 flex-1 text-left min-w-0"
                >
                  <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    selected.has(player.id)
                      ? 'bg-blue-500 border-blue-500 text-white'
                      : 'border-gray-300'
                  }`}>
                    {selected.has(player.id) && <span className="text-xs">✓</span>}
                  </span>
                  <span className="text-lg flex-shrink-0">{player.gender === 'F' ? '🔴' : '🔵'}</span>
                  <span className="font-medium text-gray-800 text-sm truncate">{player.name}</span>
                </button>
                <button
                  onClick={e => openEdit(e, player)}
                  className="text-gray-300 hover:text-gray-500 flex-shrink-0 px-1 text-sm"
                >
                  ✎
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="p-4 bg-white border-t border-gray-100">
        <button
          onClick={handleStart}
          disabled={selectedCount < 4}
          className="w-full bg-blue-500 text-white rounded-2xl py-4 text-lg font-bold shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
        >
          세션 시작 ({selectedCount}명)
        </button>
      </div>

      {/* 멤버 편집 모달 */}
      {editingPlayer && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 px-4 pb-6">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-xl overflow-hidden max-h-[90dvh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
              <h3 className="font-bold text-gray-800 text-lg">{editingPlayer.name}</h3>
              <button onClick={() => setEditingPlayer(null)} className="text-gray-400 text-xl leading-none">✕</button>
            </div>

            <div className="overflow-y-auto px-5 pb-2 space-y-4">
              {/* 성별 */}
              <div>
                <p className="text-xs font-semibold text-gray-400 mb-2">성별</p>
                <div className="flex gap-2">
                  {(['M', 'F'] as Gender[]).map(g => (
                    <button
                      key={g}
                      onClick={() => setEditGender(g)}
                      className={`flex-1 py-2 rounded-xl text-sm font-bold transition-colors ${
                        editGender === g ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {g === 'M' ? '🔵 남' : '🔴 여'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 스킬 */}
              <div>
                <p className="text-xs font-semibold text-gray-400 mb-2">스킬</p>
                <div className="space-y-2">
                  {SKILLS.map(skill => (
                    <div key={skill} className="flex items-center gap-3">
                      <span className="text-sm text-gray-600 w-16 flex-shrink-0">{skill}</span>
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
                                : 'bg-gray-100 text-gray-500'
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

              {editError && <p className="text-red-500 text-sm">{editError}</p>}
              {OAUTH_AVAILABLE ? (
                <p className="text-xs text-gray-400">저장 시 구글 로그인 팝업이 뜰 수 있습니다</p>
              ) : !scriptUrl ? (
                <p className="text-xs text-orange-400">저장 방법 미설정 — 시트에 반영되지 않습니다</p>
              ) : null}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
              <button
                onClick={() => setEditingPlayer(null)}
                className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-600"
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
