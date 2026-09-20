import { autoFillTeammates, RECOMMEND_WEIGHTS, recommendTeammates } from './baseline/recommendTeammates';
import { determineGameType } from './baseline/pairPlayers';
import type { GameType, GroupHistoryEntry, SessionPlayer } from '../../src/types';

export type Variant = 'current' | 'diversity' | 'skill';
export const VARIANTS: Variant[] = ['current', 'diversity', 'skill'];
export interface RosterPlayer { id: string; name: string; gender: 'M' | 'F'; grade: number; allowMixedSingle: boolean; arrivalMinutes?: number }
export type SelectionPolicy = 'ready-first' | 'score-first' | 'legacy-wait';
export interface Config { games: number; courts: number; runs: number; seed: number; skillWeight: number; skillPolicy: 'nearby' | 'exchange'; exchangeInterval: number; selectionPolicy?: SelectionPolicy; courtWaitSeconds?: number; lateCount?: number; lateMinutes?: number; lateCorrection?: boolean }
export interface SelectionDecision { at: number; court: number; readyCount: number; readyCapacity: number; ids: number[]; playingCount: number; reason: 'started' | 'playing' | 'mix-wait' }
export interface Match { ids: number[]; court: number; start: number; end: number; spread: number; priorOverlap: number }
export interface Metrics { repeatRate: number; tripleRate: number; coverage: number; peers: number; spread: number; gameStd: number; maxWait: number; freshRate: number; lowerMiddleCoverage: number; middleUpperCoverage: number; extremeCoverage: number; isolatedExtreme: number; maxExtremeGap: number; courtUtilization: number; meanCourtGap: number; maxCourtGap: number; courtIdleMinutes: number; immediateRematchRate: number; elapsedMinutes: number; earlyPostRate: number; latePostRate: number; invalidCompositionRate: number; playingProposals: number; avoidablePlayingProposals: number; avoidableIdleMinutes: number }
export interface Run { variant: Variant; seed: number; matches: Match[]; decisions: SelectionDecision[]; pairs: number[][]; counts: number[]; overlap: number[]; metrics: Metrics; series: { peers: number[]; spread: number[] }; countHistogram: number[]; exchange: { games: number[]; maxGaps: number[] }; composition: number[]; arrivals: number[]; baselines: number[]; lateWindowMinutes: number }
export interface Comparison { config: Config; roster: RosterPlayer[]; variants: { variant: Variant; mean: Metrics; p05: Metrics; p95: Metrics; overlap: number[]; series: { peers: number[]; spread: number[] }; countHistogram: number[]; composition: number[]; sample: Run }[] }

export const COMPOSITION_LABELS = ['남복', '여복', '혼복', '여1남3 · 여성 4점 이상', '조건 밖 구성'];
export function compositionOf(members: { gender: 'M' | 'F'; grade: number }[]) {
  const women = members.filter(p => p.gender === 'F');
  return women.length === 0 ? 0 : women.length === 4 ? 1 : women.length === 2 ? 2 : women.length === 1 && women[0].grade >= 4 ? 3 : 4;
}
export function arrivalSchedule(roster: RosterPlayer[], config: Config) {
  const lateIds = new Set(shuffle(roster.map((_, i) => i), rng(170918)).slice(0, config.lateCount ?? 0));
  return roster.map((p, i) => p.arrivalMinutes ?? (lateIds.has(i) ? config.lateMinutes ?? 30 : 0));
}
/** Matches the repository SQL's nonnegative rounded mean of active players' corrected counts. */
export function joinBaseline(players: Pick<SessionPlayer, 'status' | 'gameCount' | 'cockChecked'>[]) {
  const active = players.filter(p => p.cockChecked && p.status !== 'resting');
  return active.length ? Math.round(active.reduce((sum, p) => sum + p.gameCount, 0) / active.length) : 0;
}
/** How many legal foursomes can this ready pool support at once? Counts only, no pairing assignment. */
export function groupCapacity(men: number, lowWomen: number, highWomen: number, memo = new Map<string, number>()): number {
  const key = `${men},${lowWomen},${highWomen}`;
  if (memo.has(key)) return memo.get(key)!;
  let best = 0;
  const patterns = [[4, 0, 0], [3, 0, 1], ...Array.from({ length: 3 }, (_, high) => [2, 2 - high, high]), ...Array.from({ length: 5 }, (_, high) => [0, 4 - high, high])];
  for (const [m, low, high] of patterns) if (men >= m && lowWomen >= low && highWomen >= high)
    best = Math.max(best, 1 + groupCapacity(men - m, lowWomen - low, highWomen - high, memo));
  memo.set(key, best); return best;
}

export function readyCapacity(ids: number[], players: SessionPlayer[]) {
  const ready = ids.map(id => players[id]).filter(p => p.status === 'waiting');
  const men = ready.filter(p => p.gender === 'M').length;
  const highWomen = ready.filter(p => p.gender === 'F' && p.skills.grade >= 4).length;
  return groupCapacity(men, ready.length - men - highWomen, highWomen);
}

/** Fixed subset spanning the recorded grade distribution; this is a hypothetical smaller session. */
export function selectRoster(roster: RosterPlayer[], count: number) {
  if (!Number.isInteger(count) || count < 4 || count > roster.length) throw new Error('참가 인원을 확인하세요.');
  if (count === roster.length) return [...roster];
  const sorted = [...roster].sort((a, b) => a.grade - b.grade || a.id.localeCompare(b.id));
  const chosen = new Set(Array.from({ length: count }, (_, i) => sorted[Math.floor(i * (sorted.length - 1) / (count - 1))].id));
  return roster.filter(p => chosen.has(p.id));
}

const EPOCH = Date.UTC(2026, 8, 8, 10);
export function rng(seed: number) {
  let state = seed >>> 0;
  return () => { state += 0x6d2b79f5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle<T>(items: T[], random: () => number) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function popcount(value: number) {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function maskOf(ids: readonly number[]) { return ids.reduce((mask, id) => mask | (1 << id), 0); }
function deviation(xs: number[]) { const mean = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length); }

export function skillBand(grade: number): number { return grade <= 3 ? 0 : grade <= 6 ? 1 : 2; }
export interface ExchangeState { bands: number[]; targetBands: number[][]; gaps: number[]; interval: number }
export function createExchangeState(grades: number[], interval: number): ExchangeState {
  const bands = grades.map(skillBand), present = [...new Set(bands)];
  return { bands, interval, gaps: grades.map(() => 0), targetBands: bands.map(band => {
    // Extremes must meet each other: meeting the middle alone does not discharge their debt.
    if (band !== 1 && present.includes(2 - band)) return [2 - band];
    return present.filter(other => other !== band);
  }) };
}
export function hasExchange(id: number, ids: number[], state: ExchangeState) {
  return ids.some(other => state.targetBands[id].includes(state.bands[other]));
}
/** Change in squared personal non-exchange streaks. A new exchange resets the streak;
 * surplus exchanges cannot be banked. 81 is the maximum squared range on grades 1–10.
 * This is a soft preference after overlap objectives, never a deadline guarantee. */
export function exchangeCost(ids: number[], state: ExchangeState) {
  return 81 * ids.reduce((sum, id) => {
    if (!state.targetBands[id].length) return sum;
    const before = state.gaps[id], after = hasExchange(id, ids, state) ? 0 : before + 1;
    return sum + (after ** 2 - before ** 2) / state.interval ** 2;
  }, 0);
}
export function completeExchange(ids: number[], state: ExchangeState) {
  for (const id of ids) if (state.targetBands[id].length) state.gaps[id] = hasExchange(id, ids, state) ? 0 : state.gaps[id] + 1;
}
function updateExchangeTargets(state: ExchangeState, active: number[]) {
  const present = new Set(active.map(id => state.bands[id]));
  state.targetBands = state.bands.map((band, id) => {
    const targets = !active.includes(id) ? [] : band !== 1 && present.has(2 - band) ? [2 - band] : [...present].filter(other => other !== band).sort();
    if (targets.join() !== state.targetBands[id].join()) state.gaps[id] = 0;
    return targets;
  });
}

export function overlapScore(ids: number[], historyMasks: number[], pairs: number[][]) {
  const mask = maskOf(ids);
  let maximum = 0;
  for (const history of historyMasks) maximum = Math.max(maximum, popcount(mask & history));
  let repeated = 0;
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) repeated += pairs[ids[i]][ids[j]];
  return [Math.max(0, maximum - 1), repeated] as const;
}

/** Exhaustively compare four-person groups. No partner/opponent assignments. */
export function chooseImproved(
  available: number[], players: SessionPlayer[], historyMasks: number[], pairs: number[][],
  lastGameType: Record<string, GameType>, now: number, skillWeight: number, exchange?: ExchangeState,
  availabilityPolicy: 'ready-first' | 'score-first' = 'ready-first',
): number[] {
  // Callers may supply playing candidates. Availability is a hard first objective,
  // so novelty, fewer completed games or even extreme skill debt cannot override it.
  available = available.filter(id => players[id].cockChecked !== false && ['waiting', 'playing'].includes(players[id].status));
  const ready = available.filter(id => players[id].status === 'waiting');
  if (!ready.length) return [];
  const capacity = readyCapacity(ready, players);
  if (availabilityPolicy === 'ready-first' && capacity > 0) available = ready;
  let best: number[] = [];
  let bestPlaying = Infinity, bestOverplay = Infinity, bestMaximum = Infinity, bestRepeated = Infinity, bestQuality = Infinity;
  const lowestCount = Math.min(...ready.map(id => players[id].gameCount));
  const capacityMemo = new Map<string, number>();
  const menCount = ready.filter(id => players[id].gender === 'M').length;
  const highWomenCount = ready.filter(id => players[id].gender === 'F' && players[id].skills.grade >= 4).length;
  const lowWomenCount = ready.length - menCount - highWomenCount;
  const remainingCapacity = capacity - 1;
  // Reuse current per-player participation, wait and game-type preferences.
  // Group and skill costs are replaced by whole-group objectives below.
  const fair = players.map(p => p.gameCount * RECOMMEND_WEIGHTS.W_GAME + (p.status === 'playing' ? RECOMMEND_WEIGHTS.W_PLAYING : -(now - Date.parse(p.waitSince!)) / 60000 * RECOMMEND_WEIGHTS.W_WAIT));
  const grade = players.map(p => p.skills.grade);
  for (let a = 0; a < available.length - 3; a++) for (let b = a + 1; b < available.length - 2; b++)
    for (let c = b + 1; c < available.length - 1; c++) for (let d = c + 1; d < available.length; d++) {
      const ids = [available[a], available[b], available[c], available[d]];
      const members = ids.map(id => players[id]);
      const playingCount = members.filter(p => p.status === 'playing').length;
      if (playingCount > 3) continue; // At least one waiting anchor, as with current auto-fill.
      const playingPriority = availabilityPolicy === 'ready-first' ? playingCount : 0;
      if (playingPriority > bestPlaying) continue;
      if (compositionOf(members.map(p => ({ gender: p.gender, grade: p.skills.grade }))) === 4) continue;
      const women = members.filter(p => p.gender === 'F');
      const highWomen = women.filter(p => p.skills.grade >= 4).length;
      if (!playingCount && groupCapacity(menCount - (4 - women.length), lowWomenCount - (women.length - highWomen), highWomenCount - highWomen, capacityMemo) < remainingCapacity) continue;
      // A novelty advantage must not repeatedly select somebody already 2+ corrected games ahead.
      // If every valid group needs an overplayed person, use the least excess instead of deadlocking.
      const overplay = ids.reduce((sum, id) => sum + Math.max(0, players[id].gameCount - lowestCount - 1), 0);
      if (playingPriority === bestPlaying && overplay > bestOverplay) continue;
      const [maximum, repeated] = overlapScore(ids, historyMasks, pairs);
      if (playingPriority === bestPlaying && overplay === bestOverplay && (maximum > bestMaximum || (maximum === bestMaximum && repeated > bestRepeated))) continue;
      const mixed = women.length > 0 && women.length < 4;
      const rotation = members.reduce((sum, p) => {
        const last = lastGameType[p.id];
        return sum + (!last ? 0 : ((last === '혼복' || last === '혼합') === mixed ? RECOMMEND_WEIGHTS.W_ROTATE : -RECOMMEND_WEIGHTS.W_ROTATE));
      }, 0);
      const spread = Math.max(...ids.map(id => grade[id])) - Math.min(...ids.map(id => grade[id]));
      const quality = ids.reduce((sum, id) => sum + fair[id], 0) + rotation
        + skillWeight * (spread ** 2 + (exchange && skillWeight ? exchangeCost(ids, exchange) : 0));
      if (playingPriority < bestPlaying || overplay < bestOverplay || maximum < bestMaximum || repeated < bestRepeated || quality < bestQuality - 1e-9) {
        best = ids; bestPlaying = playingPriority; bestOverplay = overplay; bestMaximum = maximum; bestRepeated = repeated; bestQuality = quality;
      }
    }
  return best;
}

export function validateConfig(roster: RosterPlayer[], config: Config) {
  if (!['ready-first', 'score-first', 'legacy-wait'].includes(config.selectionPolicy ?? 'ready-first')) throw new Error('출전 정책을 확인하세요.');
  if (roster.length < 4 || roster.length > 30) throw new Error('참가 인원은 4~30명이어야 합니다.');
  if (new Set(roster.map(p => p.id)).size !== roster.length) throw new Error('참가자 ID가 중복됩니다.');
  for (const p of roster) if (!(p.grade >= 1 && p.grade <= 10)) throw new Error('실력 정보가 누락됐습니다.');
  if (!Number.isInteger(config.games) || config.games < 4 || config.games > 120) throw new Error('전체 경기 수는 4~120으로 입력하세요.');
  if (!Number.isInteger(config.courts) || config.courts < 1 || config.courts > Math.floor(roster.length / 4)) throw new Error('코트 수를 확인하세요.');
  if (!Number.isInteger(config.runs) || config.runs < 1 || config.runs > 100) throw new Error('반복 횟수는 1~100으로 입력하세요.');
  if (!Number.isInteger(config.seed) || config.seed < 1 || config.seed > 1000000) throw new Error('시드는 1~1,000,000으로 입력하세요.');
  if (!Number.isFinite(config.skillWeight) || config.skillWeight < 0 || config.skillWeight > 20) throw new Error('실력 가중치는 0~20으로 입력하세요.');
  if (!['nearby', 'exchange'].includes(config.skillPolicy)) throw new Error('실력 반영 방식을 확인하세요.');
  if (!Number.isInteger(config.exchangeInterval) || config.exchangeInterval < 1 || config.exchangeInterval > 10) throw new Error('교류 간격 기준은 1~10경기로 입력하세요.');
  if (!Number.isFinite(config.courtWaitSeconds ?? 0) || (config.courtWaitSeconds ?? 0) < 0 || (config.courtWaitSeconds ?? 0) > 180) throw new Error('코트 대기 상한은 0~180초로 입력하세요.');
  if (!Number.isInteger(config.lateCount ?? 0) || (config.lateCount ?? 0) < 0 || (config.lateCount ?? 0) > roster.length - 4) throw new Error('처음부터 참가하는 사람이 최소 4명은 필요합니다.');
  if (!Number.isFinite(config.lateMinutes ?? 30) || (config.lateMinutes ?? 30) < 1 || (config.lateMinutes ?? 30) > 120) throw new Error('합류 시각은 시작 후 1~120분이어야 합니다.');
  for (const minutes of arrivalSchedule(roster, config)) if (!Number.isFinite(minutes) || minutes < 0 || minutes > 120) throw new Error('참가자의 합류 시각을 확인하세요.');
}

/** Wait only when the ready group repeats 3+ members of someone's immediately preceding game.
 * Two-person overlap is still minimized by selection, but does not justify keeping a court idle.
 * Decisions never inspect future match completion times. */
export function shouldWaitForMix(ids: number[], previousGame: number[], lastGroups: number[][], now: number, idleSince: number, waitMs: number, hasPlaying: boolean) {
  if (!hasPlaying || waitMs <= 0 || now >= idleSince + waitMs) return false;
  return [...new Set(ids.map(id => previousGame[id]).filter(index => index >= 0))]
    .some(index => lastGroups[index].filter(id => ids.includes(id)).length >= 3);
}

export function simulate(roster: RosterPlayer[], variant: Variant, config: Config, seed: number): Run {
  validateConfig(roster, config);
  const selectionPolicy = config.selectionPolicy ?? 'ready-first';
  const legacyWait = selectionPolicy === 'legacy-wait';
  const n = roster.length;
  const order = shuffle(roster.map((_, i) => i), rng(seed ^ 0x81d3));
  // Every variant receives the same duration for match start number k.
  const durationRandom = rng(seed ^ 0x318ac);
  const durations = Array.from({ length: config.games }, () => Math.round((10 + durationRandom() * 5) * 60000));
  const arrivals = arrivalSchedule(roster, config), baselines = roster.map(() => 0);
  const players: SessionPlayer[] = roster.map(p => ({ id: p.id, playerId: p.id, memberId: p.id, name: p.name,
    gender: p.gender, skills: { grade: p.grade }, allowMixedSingle: p.allowMixedSingle, status: 'resting',
    gameCount: 0, mixedCount: 0, waitSince: null, joinedAtMatch: 0, cockChecked: false }));
  const byId = new Map(players.map((p, i) => [p.id, i]));
  const history: GroupHistoryEntry[] = [], historyMasks: number[] = [];
  const pairs = Array.from({ length: n }, () => Array(n).fill(0) as number[]);
  const exchange = createExchangeState(roster.map(p => p.grade), config.exchangeInterval);
  const courts: (Match | null)[] = Array(config.courts).fill(null);
  const idleSince = Array(config.courts).fill(EPOCH) as number[];
  const previousGame = Array(n).fill(-1) as number[], completedGroups: number[][] = [];
  const lastGameType: Record<string, GameType> = {};
  const matches: Match[] = [];
  const decisions: SelectionDecision[] = [];
  function gameType(ids: number[]): GameType {
    if (variant === 'current') return determineGameType(ids.map(id => players[id]) as [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer], []);
    return (['남복', '여복', '혼복', '혼합'] as GameType[])[compositionOf(ids.map(id => roster[id]))];
  }
  let now = EPOCH, maxWait = 0, avoidableIdleMinutes = 0;
  while (matches.length < config.games || courts.some(Boolean)) {
    for (let court = 0; court < courts.length; court++) {
      const match = courts[court];
      if (!match || match.end > now) continue;
      const type = gameType(match.ids);
      for (const id of match.ids) { players[id].status = 'waiting'; players[id].gameCount++; players[id].waitSince = new Date(now).toISOString(); if (type === '혼복' && players[id].gender === 'M') players[id].mixedCount++; }
      history.push({ matchId: String(history.length), members: match.ids.map(id => players[id].id) });
      historyMasks.push(maskOf(match.ids));
      for (const id of match.ids) previousGame[id] = completedGroups.length;
      completedGroups.push(match.ids);
      completeExchange(match.ids, exchange);
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { pairs[match.ids[i]][match.ids[j]]++; pairs[match.ids[j]][match.ids[i]]++; }
      courts[court] = null;
      idleSince[court] = now;
    }
    const joining = order.filter(id => !players[id].cockChecked && EPOCH + arrivals[id] * 60000 <= now);
    if (joining.length) {
      const baseline = config.lateCorrection === false ? 0 : joinBaseline(players);
      for (const id of joining) {
        const p = players[id]; p.status = 'waiting'; p.cockChecked = true; p.waitSince = new Date(now).toISOString();
        p.gameCount = baseline; p.joinedAtMatch = completedGroups.length; baselines[id] = baseline;
      }
      updateExchangeTargets(exchange, order.filter(id => players[id].cockChecked));
    }
    // Oldest empty court gets the first ready group. A new completion never resets its deadline.
    const courtOrder = courts.map((_, index) => index).sort((a, b) => idleSince[a] - idleSince[b] || a - b);
    for (const court of courtOrder) {
      if (matches.length >= config.games) break;
      if (courts[court]) continue;
      const ready = order.filter(id => players[id].status === 'waiting');
      const available = order.filter(id => players[id].status === 'waiting' || (!legacyWait && players[id].status === 'playing'));
      if (!ready.length) continue;
      if (available.length < 4) continue;
      let ids: number[];
      if (variant === 'current') {
        const realNow = Date.now;
        Date.now = () => now;
        try {
          ids = autoFillTeammates([], available.map(id => players[id]), { groupHistory: history, lastGameType,
            ongoingGroups: courts.flatMap(m => m ? [m.ids.map(id => players[id].id)] : []),
            playingIds: new Set(players.filter(p => p.status === 'playing').map(p => p.id)) }, 4, undefined, { maxPlaying: legacyWait ? 0 : 3 }).map(p => byId.get(p.id)!);
        } finally { Date.now = realNow; }
      } else ids = chooseImproved(available, players, historyMasks, pairs, lastGameType, now, variant === 'skill' ? config.skillWeight : 0,
        variant === 'skill' && config.skillPolicy === 'exchange' ? exchange : undefined, selectionPolicy === 'score-first' ? 'score-first' : 'ready-first');
      if (ids.length === 0) continue; // No permitted composition with a waiting anchor.
      if (ids.length !== 4 || new Set(ids).size !== 4 || ids.some(id => !available.includes(id))) throw new Error('잘못된 편성 결과');
      const playingCount = ids.filter(id => players[id].status === 'playing').length;
      const waitForMix = legacyWait && shouldWaitForMix(ids, previousGame, completedGroups, now, idleSince[court], (config.courtWaitSeconds ?? 0) * 1000, courts.some(Boolean));
      decisions.push({ at: now - EPOCH, court: court + 1, readyCount: ready.length, readyCapacity: readyCapacity(ready, players), ids,
        playingCount, reason: playingCount ? 'playing' : waitForMix ? 'mix-wait' : 'started' });
      // A proposal is not a match or an exclusive reservation. Recompute on each
      // completion/arrival; never read future finish times or start a busy player.
      // Without a state change other empty courts would receive the same proposal.
      if (playingCount) break;
      if (waitForMix) continue;
      const type = gameType(ids);
      for (const id of ids) { maxWait = Math.max(maxWait, (now - Date.parse(players[id].waitSince!)) / 60000); players[id].status = 'playing'; lastGameType[players[id].id] = type; }
      const grades = ids.map(id => roster[id].grade);
      const match: Match = { ids, court: court + 1, start: now - EPOCH, end: now - EPOCH + durations[matches.length], spread: Math.max(...grades) - Math.min(...grades), priorOverlap: historyMasks.length ? Math.max(...historyMasks.map(mask => popcount(mask & maskOf(ids)))) : 0 };
      matches.push(match);
      courts[court] = { ...match, start: now, end: now + durations[matches.length - 1] };
    }
    const deadlines = legacyWait && matches.length < config.games ? courts.flatMap((match, index) => {
      const deadline = idleSince[index] + (config.courtWaitSeconds ?? 0) * 1000;
      return !match && deadline > now ? [deadline] : [];
    }) : [];
    const nextArrival = matches.length < config.games || courts.some(Boolean) ? Math.min(...order.filter(id => !players[id].cockChecked).map(id => EPOCH + arrivals[id] * 60000)) : Infinity;
    const next = Math.min(...courts.filter((m): m is Match => m !== null).map(m => m.end), ...deadlines, nextArrival);
    if (!Number.isFinite(next)) break;
    // Count only the number of courts that could actually be filled by disjoint
    // legal ready groups, before the last scheduled match starts. Unit: court-minutes.
    const fillable = Math.min(courts.filter(m => !m).length, readyCapacity(order, players), config.games - matches.length);
    avoidableIdleMinutes += fillable * (next - now) / 60000;
    now = next;
  }
  if (matches.length !== config.games) throw new Error(`허용된 성별 구성으로 편성할 수 없습니다 (${matches.length}/${config.games}경기). 참가 인원과 구성을 확인하세요.`);
  for (const p of players) if (p.cockChecked) maxWait = Math.max(maxWait, (now - Date.parse(p.waitSince!)) / 60000);
  return measure(variant, seed, matches, roster, maxWait, config.courts, arrivals, baselines, decisions, avoidableIdleMinutes);
}

export function measure(variant: Variant, seed: number, matches: Match[], roster: RosterPlayer[], maxWait: number, courtCount = Math.max(...matches.map(m => m.court)), arrivals = roster.map(() => 0), baselines = roster.map(() => 0), decisions: SelectionDecision[] = [], avoidableIdleMinutes = 0): Run {
  const n = roster.length;
  const state = createExchangeState(roster.map(p => p.grade), 3);
  const exchange = { games: roster.map(() => 0), maxGaps: roster.map(() => 0) };
  const composition = [0, 0, 0, 0, 0];
  const pairs = Array.from({ length: n }, () => Array(n).fill(0) as number[]), counts = Array(n).fill(0) as number[];
  const overlap = [0, 0, 0, 0, 0], series = { peers: [] as number[], spread: [] as number[] };
  let unique = 0, spreadSum = 0, fresh = 0, immediateRematches = 0;
  const previousGame = roster.map(() => -1);
  for (let k = 0; k < matches.length; k++) {
    const match = matches[k]; let allFresh = true;
    composition[compositionOf(match.ids.map(id => roster[id]))]++;
    if (match.ids.every(id => previousGame[id] >= 0 && previousGame[id] === previousGame[match.ids[0]])) immediateRematches++;
    for (const id of match.ids) previousGame[id] = k;
    for (const id of match.ids) counts[id]++;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const a = match.ids[i], b = match.ids[j];
      if (pairs[a][b] === 0) unique++; else allFresh = false;
      pairs[a][b]++; pairs[b][a]++;
    }
    if (allFresh) fresh++;
    spreadSum += match.spread;
    series.peers.push(2 * unique / n); series.spread.push(spreadSum / (k + 1));
    const members = new Set(match.ids);
    for (let previous = 0; previous < k; previous++) overlap[matches[previous].ids.filter(id => members.has(id)).length]++;
  }
  const comparisons = matches.length * (matches.length - 1) / 2;
  // Replay completion order and known arrivals, matching the live scorer's available target bands.
  for (const match of [...matches].sort((a, b) => a.end - b.end || a.court - b.court)) {
    updateExchangeTargets(state, arrivals.flatMap((minute, id) => minute * 60000 < match.end ? [id] : []));
    for (const id of match.ids) if (hasExchange(id, match.ids, state)) exchange.games[id]++;
    completeExchange(match.ids, state);
    for (const id of match.ids) exchange.maxGaps[id] = Math.max(exchange.maxGaps[id], state.gaps[id]);
  }
  const countHistogram = Array(Math.max(...counts) + 1).fill(0) as number[];
  for (const count of counts) countHistogram[count]++;
  function bandCoverage(a: number, b: number) {
    let total = 0, met = 0;
    for (let i = 0; i < n; i++) if (state.bands[i] === a) for (let j = 0; j < n; j++) if (state.bands[j] === b) { total++; if (pairs[i][j]) met++; }
    return total ? 100 * met / total : 0;
  }
  const extremes = roster.flatMap((_, id) => state.bands[id] !== 1 && state.bands.includes(2 - state.bands[id]) ? [id] : []);
  const courtMetrics = measureCourts(matches, courtCount);
  const lateIds = arrivals.flatMap((minutes, id) => minutes > 0 ? [id] : []), earlyIds = arrivals.flatMap((minutes, id) => minutes === 0 ? [id] : []);
  const windowStart = Math.max(0, ...arrivals), windowEnd = Math.min(windowStart + 30, courtMetrics.elapsedMinutes), lateWindowMinutes = Math.max(0, windowEnd - windowStart);
  const inWindow = matches.filter(m => m.start / 60000 >= windowStart && m.start / 60000 < windowEnd);
  function rate(ids: number[]) { return lateIds.length && ids.length && lateWindowMinutes > 0 ? 60 * inWindow.reduce((sum, m) => sum + m.ids.filter(id => ids.includes(id)).length, 0) / ids.length / lateWindowMinutes : 0; }
  return { variant, seed, matches, decisions, pairs, counts, overlap, series, countHistogram, exchange, composition, arrivals, baselines, lateWindowMinutes,
    metrics: { repeatRate: 100 * (overlap[2] + overlap[3] + overlap[4]) / comparisons,
      tripleRate: 100 * (overlap[3] + overlap[4]) / comparisons, coverage: 100 * unique / (n * (n - 1) / 2),
      peers: 2 * unique / n, spread: spreadSum / matches.length, gameStd: deviation(counts), maxWait,
      freshRate: 100 * fresh / matches.length, lowerMiddleCoverage: bandCoverage(0, 1), middleUpperCoverage: bandCoverage(1, 2), extremeCoverage: bandCoverage(0, 2),
      isolatedExtreme: extremes.filter(id => exchange.games[id] === 0).length, maxExtremeGap: Math.max(0, ...extremes.map(id => exchange.maxGaps[id])),
      ...courtMetrics, immediateRematchRate: 100 * immediateRematches / matches.length,
      earlyPostRate: rate(earlyIds), latePostRate: rate(lateIds), invalidCompositionRate: 100 * composition[4] / matches.length,
      playingProposals: decisions.filter(d => d.playingCount > 0).length,
      avoidablePlayingProposals: decisions.filter(d => d.playingCount > 0 && d.readyCapacity > 0).length, avoidableIdleMinutes } };
}

export function measureCourts(matches: Match[], courtCount: number) {
  const end = Math.max(...matches.map(m => m.end));
  const horizon = Math.max(...matches.map(m => m.start)) || end; // Before final wind-down; one-wave sessions use their actual end.
  const busy = matches.reduce((sum, m) => sum + Math.max(0, Math.min(m.end, horizon) - m.start), 0);
  const gaps: number[] = [];
  for (let court = 1; court <= courtCount; court++) {
    const games = matches.filter(m => m.court === court).sort((a, b) => a.start - b.start);
    for (let i = 1; i < games.length; i++) gaps.push(Math.max(0, games[i].start - games[i - 1].end) / 1000);
  }
  return { courtUtilization: horizon ? 100 * busy / (courtCount * horizon) : 100,
    meanCourtGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0,
    maxCourtGap: Math.max(0, ...gaps), courtIdleMinutes: Math.max(0, courtCount * horizon - busy) / 60000,
    elapsedMinutes: end / 60000 };
}

export function aggregate(config: Config, runs: Run[][], roster: RosterPlayer[]): Comparison {
  const keys: (keyof Metrics)[] = ['repeatRate', 'tripleRate', 'coverage', 'peers', 'spread', 'gameStd', 'maxWait', 'freshRate', 'lowerMiddleCoverage', 'middleUpperCoverage', 'extremeCoverage', 'isolatedExtreme', 'maxExtremeGap', 'courtUtilization', 'meanCourtGap', 'maxCourtGap', 'courtIdleMinutes', 'immediateRematchRate', 'elapsedMinutes', 'earlyPostRate', 'latePostRate', 'invalidCompositionRate', 'playingProposals', 'avoidablePlayingProposals', 'avoidableIdleMinutes'];
  return { config, roster, variants: VARIANTS.map((variant, index) => {
    const values = runs[index]; const mean = {} as Metrics, p05 = {} as Metrics, p95 = {} as Metrics;
    for (const key of keys) {
      const xs = values.map(run => run.metrics[key]).sort((a, b) => a - b);
      mean[key] = xs.reduce((a, b) => a + b, 0) / xs.length;
      p05[key] = xs[Math.floor((xs.length - 1) * .05)]; p95[key] = xs[Math.ceil((xs.length - 1) * .95)];
    }
    return { variant, mean, p05, p95, sample: values[0],
      composition: Array.from({ length: 5 }, (_, k) => values.reduce((sum, run) => sum + run.composition[k], 0) / values.length),
      overlap: Array.from({ length: 5 }, (_, k) => values.reduce((sum, run) => sum + run.overlap[k], 0) / values.length),
      series: { peers: Array.from({ length: config.games }, (_, k) => values.reduce((sum, run) => sum + run.series.peers[k], 0) / values.length),
        spread: Array.from({ length: config.games }, (_, k) => values.reduce((sum, run) => sum + run.series.spread[k], 0) / values.length) },
      countHistogram: Array.from({ length: Math.max(...values.map(run => run.countHistogram.length)) }, (_, k) => values.reduce((sum, run) => sum + (run.countHistogram[k] || 0), 0) / values.length) };
  }) };
}

export function compare(roster: RosterPlayer[], config: Config, progress?: (done: number, total: number) => void): Comparison {
  validateConfig(roster, config);
  const runs: Run[][] = VARIANTS.map(() => []);
  for (let index = 0; index < config.runs; index++) for (let v = 0; v < VARIANTS.length; v++) {
    runs[v].push(simulate(roster, VARIANTS[v], config, config.seed + index));
    progress?.(index * 3 + v + 1, config.runs * 3);
  }
  return aggregate(config, runs, roster);
}

// Exported for the equivalence test; production functions remain unmodified.
export { recommendTeammates };
