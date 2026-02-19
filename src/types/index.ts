export type SkillLevel = 'O' | 'V' | 'X'
export type Gender = 'M' | 'F'
export type GameType = '혼복' | '남복' | '여복' | '혼합'

export interface PlayerSkills {
  클리어: SkillLevel
  스매시: SkillLevel
  로테이션: SkillLevel
  드랍: SkillLevel
  헤어핀: SkillLevel
  드라이브: SkillLevel
  백핸드: SkillLevel
}

export interface Player {
  id: string
  name: string
  gender: Gender
  skills: PlayerSkills
}

export interface GeneratedTeam {
  teamA: [Player, Player]
  teamB: [Player, Player]
  gameType: GameType
}

export interface Court {
  id: number
  team: GeneratedTeam | null
}

export interface PairHistory {
  [playerId: string]: Set<string>
}

export interface SessionSettings {
  courtCount: number
  allowSingleWoman: boolean
}
