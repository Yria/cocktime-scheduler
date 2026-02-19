import type { GeneratedTeam, Court } from '../types'

interface Props {
  team: GeneratedTeam
  courts: Court[]
  onAssign: (courtId: number) => void
  onCancel: () => void
}

const GAME_TYPE_COLOR: Record<string, string> = {
  혼복: 'bg-purple-100 text-purple-700',
  남복: 'bg-blue-100 text-blue-700',
  여복: 'bg-pink-100 text-pink-700',
  혼합: 'bg-orange-100 text-orange-700',
}

export default function TeamDialog({ team, courts, onAssign, onCancel }: Props) {
  const emptyCourts = courts.filter(c => c.team === null)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 px-4 pb-6">
      <div className="bg-white w-full max-w-sm rounded-3xl shadow-xl overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="font-bold text-gray-800 text-lg">생성된 팀</h3>
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${GAME_TYPE_COLOR[team.gameType]}`}>
            {team.gameType}
          </span>
        </div>

        {/* 팀 구성 */}
        <div className="px-5 pb-4">
          <div className="bg-gray-50 rounded-2xl p-4">
            {/* A팀 */}
            <div className="mb-3">
              <p className="text-xs text-gray-400 font-medium mb-1.5">A팀</p>
              <div className="flex gap-2">
                {team.teamA.map(p => (
                  <div key={p.id} className="flex-1 bg-white rounded-xl p-3 text-center shadow-sm">
                    <p className="font-semibold text-gray-800">{p.name}</p>
                    <p className="text-sm text-gray-400 mt-0.5">{p.gender === 'F' ? '🔴' : '🔵'}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-center py-1">
              <span className="text-xs font-bold text-gray-400 bg-white px-3 py-1 rounded-full">VS</span>
            </div>

            {/* B팀 */}
            <div className="mt-3">
              <p className="text-xs text-gray-400 font-medium mb-1.5">B팀</p>
              <div className="flex gap-2">
                {team.teamB.map(p => (
                  <div key={p.id} className="flex-1 bg-white rounded-xl p-3 text-center shadow-sm">
                    <p className="font-semibold text-gray-800">{p.name}</p>
                    <p className="text-sm text-gray-400 mt-0.5">{p.gender === 'F' ? '🔴' : '🔵'}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 코트 선택 */}
        <div className="px-5 pb-5">
          <p className="text-sm text-gray-500 mb-3 font-medium">어느 코트에 배정할까요?</p>
          <div className="flex gap-2 flex-wrap">
            {emptyCourts.map(court => (
              <button
                key={court.id}
                onClick={() => onAssign(court.id)}
                className="flex-1 min-w-[60px] bg-blue-500 text-white rounded-xl py-3 font-bold text-sm"
              >
                코트 {court.id}
              </button>
            ))}
          </div>
          {emptyCourts.length === 0 && (
            <p className="text-sm text-red-400 text-center">빈 코트가 없습니다</p>
          )}
          <button
            onClick={onCancel}
            className="w-full mt-3 py-3 text-sm text-gray-400 font-medium"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  )
}
