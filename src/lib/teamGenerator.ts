import type { Player, GeneratedTeam, GameType, PairHistory } from '../types'

function partnerCount(a: Player, b: Player, history: PairHistory): number {
  return (history[a.id]?.has(b.id) ? 1 : 0) + (history[b.id]?.has(a.id) ? 1 : 0)
}

// 4명 중 3가지 페어링 조합 평가 — 중복 파트너 최소화
function bestPairing(
  players: [Player, Player, Player, Player],
  history: PairHistory
): [[Player, Player], [Player, Player]] {
  const [p0, p1, p2, p3] = players

  const combos: [[Player, Player], [Player, Player]][] = [
    [[p0, p1], [p2, p3]],
    [[p0, p2], [p1, p3]],
    [[p0, p3], [p1, p2]],
  ]

  let best = combos[0]
  let bestPenalty = Infinity

  for (const [teamA, teamB] of combos) {
    const penalty = partnerCount(teamA[0], teamA[1], history)
                  + partnerCount(teamB[0], teamB[1], history)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      best = [teamA, teamB]
    }
  }

  return best
}

function determineGameType(players: Player[], allowSingleWoman: boolean): GameType {
  const womenCount = players.filter(p => p.gender === 'F').length
  if (womenCount === 0) return '남복'
  if (womenCount === 4) return '여복'
  if (womenCount === 2) return '혼복'
  return allowSingleWoman ? '혼합' : '남복'
}

function selectFour(
  waiting: Player[],
  allowSingleWoman: boolean
): Player[] | null {
  const candidates = waiting.slice(0, Math.min(8, waiting.length))
  const women = candidates.filter(p => p.gender === 'F')
  const men = candidates.filter(p => p.gender === 'M')

  // 혼복 우선: 여자 2명 + 남자 2명
  if (women.length >= 2 && men.length >= 2) {
    return [women[0], women[1], men[0], men[1]]
  }

  // 여자 1명이고 허용 안 하면 여자 제외하고 남자 4명
  if (!allowSingleWoman && women.length === 1 && men.length >= 4) {
    return men.slice(0, 4)
  }

  // 그 외: 순서대로 4명
  if (candidates.length >= 4) return candidates.slice(0, 4)

  return null
}

export function generateTeam(
  waiting: Player[],
  history: PairHistory,
  allowSingleWoman: boolean
): GeneratedTeam | null {
  if (waiting.length < 4) return null

  const selected = selectFour(waiting, allowSingleWoman)
  if (!selected || selected.length < 4) return null

  const four = selected as [Player, Player, Player, Player]
  const gameType = determineGameType(four, allowSingleWoman)

  // 혼복일 때: [여+남] vs [여+남] 구성
  let teamA: [Player, Player]
  let teamB: [Player, Player]

  if (gameType === '혼복') {
    const women = four.filter(p => p.gender === 'F')
    const men = four.filter(p => p.gender === 'M')
    teamA = [women[0], men[0]]
    teamB = [women[1], men[1]]
  } else {
    const [a, b] = bestPairing(four, history)
    teamA = a
    teamB = b
  }

  return { teamA, teamB, gameType }
}

export function recordHistory(history: PairHistory, team: GeneratedTeam): PairHistory {
  const next = { ...history }
  const pairs: [Player, Player][] = [team.teamA, team.teamB]

  for (const [a, b] of pairs) {
    if (!next[a.id]) next[a.id] = new Set()
    if (!next[b.id]) next[b.id] = new Set()
    next[a.id].add(b.id)
    next[b.id].add(a.id)
  }
  return next
}
