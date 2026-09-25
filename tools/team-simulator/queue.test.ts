/**
 * Prepared-queue replay: operators keep `depth` next teams ready while courts play.
 * The board store's own actions run under a virtual clock; only the server boundary
 * (assign/complete) is a fixture that mirrors complete_match's player updates.
 *
 * legacy  — later teams are completed at once (waitForCompletion:false; playing players reserved if needed).
 * waiting — app default: later teams keep two people and 합류 대기 places, filled when a match completes.
 *
 * Departures (recorded last game end) leave through the board's rest action; a player still playing leaves on completion.
 * A queued team broken by a departure is repaired with its card button, as an operator would.
 * order: court-first presses the court card before preparing the next team; queue-first does the reverse.
 * tapFill: the operator also presses each new waiting team's card button at once
 * (the old 지금 채우기; since 2026-09-25 it is an inert "완료 후 채움" label and fills nothing).
 * Recorded input: SIM_QUEUE_INPUT=<input.json> SIM_QUEUE_OUT=<out.json> [SIM_QUEUE_SEEDS=100] [SIM_QUEUE_DEPTHS=1,2,3]
 * Without it the synthetic roster runs as a regression test.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Court, GameType, GeneratedTeam, GroupHistory, SessionPlayer } from '../../src/types';

const h = vi.hoisted(() => ({
  courts: [] as Court[], players: new Map<string, SessionPlayer>(),
  groupHistory: [] as GroupHistory, lastGameType: {} as Record<string, GameType>,
  // Replaced per run; typed here so the session-store mock can forward to them.
  assign: (async () => {}) as (team: GeneratedTeam, courtId: number) => Promise<void>,
  complete: (async () => {}) as (courtId: number) => Promise<void>,
  setResting: (async () => {}) as (id: string, resting: boolean) => Promise<void>,
}));
vi.mock('../../src/store/sessionStore', () => ({
  useSessionStore: { getState: () => ({
    courts: h.courts, sessionPlayers: h.players, groupHistory: h.groupHistory, lastGameType: h.lastGameType,
    cockCheckEnabled: true, matchAssignCount: 0, isEditor: true, _myName: '시뮬레이터', restingIds: [], setResting: (id: string, resting: boolean) => h.setResting(id, resting),
    handleAssign: (team: GeneratedTeam, courtId: number) => h.assign(team, courtId),
    handleComplete: (courtId: number) => h.complete(courtId), handleSetMatchRoster: async () => {},
  }) },
}));
vi.mock('../../src/store/appStore', () => ({ useAppStore: { getState: () => ({ sessionMeta: { singleWomanIds: [] } }) } }));

import { useBoardStore } from '../../src/store/boardStore';
import { useAdminCoverageStore } from '../../src/store/adminCoverageStore';
import { isTeamStartable, playingIdsFromCourts, teamMembers } from '../../src/lib/board/membership';
import { joinBaseline, measure, readyCapacity, rng, type Match, type Metrics, type RosterPlayer } from './simulator';
import { testRoster } from './test-roster';

export type QueueMode = 'legacy' | 'waiting';
export type QueuePlayer = RosterPlayer & { departureMinutes?: number };
export interface QueueInput { roster: QueuePlayer[]; courts: number; games: number; replayMinutes: number[]; durationPoolMinutes: number[] }
export interface QueueConfig { mode: QueueMode; depth: number; seed: number; departures?: boolean; order?: 'court-first' | 'queue-first'; tapFill?: boolean }
export interface QueueExtras {
  p90Wait: number; maxWaitAll: number; brokenTeamMinutes: number; rematchPairRate: number; rematchTripleRate: number; avoidableIdle: number;
  reservations: number; reservedTeams: number; waitingTeams: number; completionFills: number; courtRegroups: number;
  minGames: number; maxGames: number; stalled: number;
}
export interface QueueRun { config: QueueConfig; metrics: Metrics & QueueExtras; trace: string[][] }

const MIN = 60000;
const EPOCH = Date.UTC(2026, 8, 24, 0, 24); // Arbitrary fixed origin; only differences matter.

/** Seed 0 replays the recorded order; others resample recorded lengths. Same sequence for both modes. */
export function durationsFor(input: QueueInput, seed: number): number[] {
  if (seed === 0) return input.replayMinutes.slice(0, input.games).map(m => m * MIN);
  const random = rng(seed), pool = input.durationPoolMinutes;
  return Array.from({ length: input.games }, () => pool[Math.floor(random() * pool.length)] * MIN);
}

function percentile(xs: number[], q: number) {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
}

export async function runQueue(input: QueueInput, config: QueueConfig): Promise<QueueRun> {
  const { roster, courts: courtCount, games } = input;
  let clock = 0;
  const now = vi.spyOn(Date, 'now').mockImplementation(() => EPOCH + clock);
  const iso = () => new Date(EPOCH + clock).toISOString();
  const tick = () => { clock += 1; }; // Distinct createdAt per operator action keeps queue order deterministic.
  try {
    const index = new Map(roster.map((p, i) => [p.id, i]));
    const arrivals = roster.map(p => (p.arrivalMinutes ?? 0) * MIN);
    const departures = roster.map(p => config.departures && p.departureMinutes != null ? p.departureMinutes * MIN : Infinity);
    const gone = new Set<string>();
    h.players = new Map(roster.map((p, i) => [p.id, {
      id: p.id, playerId: p.id, memberId: p.id, name: p.name, gender: p.gender, skills: { grade: p.grade },
      allowMixedSingle: p.allowMixedSingle, status: arrivals[i] > 0 ? 'resting' : 'waiting', gameCount: 0, mixedCount: 0,
      waitSince: iso(), joinedAtMatch: 0, cockChecked: arrivals[i] === 0,
    } satisfies SessionPlayer]));
    h.courts = Array.from({ length: courtCount }, (_, i) => ({ id: i + 1, match: null }));
    h.groupHistory = []; h.lastGameType = {};
    const durations = durationsFor(input, config.seed);
    const matches: Match[] = [], trace: string[][] = [], ends: { at: number; court: number }[] = [];
    const freeSince = [...arrivals], waits: number[] = [], waitsAll: number[] = [], lastGame: number[][] = roster.map(() => []);
    const updatePlayers = (ids: string[], patch: (p: SessionPlayer) => Partial<SessionPlayer>) => {
      h.players = new Map([...h.players].map(([id, p]) => [id, ids.includes(id) ? { ...p, ...patch(p) } : p]));
    };
    h.assign = async (team, courtId) => {
      const ids = [...team.teamA, ...team.teamB], k = matches.length;
      if (k >= games || h.courts.find(c => c.id === courtId)?.match) return;
      h.courts = h.courts.map(c => c.id === courtId ? { ...c, match: {
        id: `sim-${k}`, courtId, gameType: team.gameType, teamA: team.teamA, teamB: team.teamB, startedAt: iso() } } : c);
      updatePlayers(ids, () => ({ status: 'playing' }));
      const idx = ids.map(id => index.get(id)!), grades = idx.map(i => roster[i].grade);
      for (const i of idx) { waits.push((clock - freeSince[i]) / MIN); waitsAll.push((clock - freeSince[i]) / MIN); }
      matches.push({ ids: idx, court: courtId, start: clock, end: clock + durations[k],
        spread: Math.max(...grades) - Math.min(...grades), priorOverlap: Math.max(0, ...idx.map(i => lastGame[i].filter(j => idx.includes(j)).length)) });
      for (const i of idx) lastGame[i] = idx;
      trace.push([...ids].sort());
      ends.push({ at: clock + durations[k], court: courtId });
    };
    h.complete = async courtId => {
      const match = h.courts.find(c => c.id === courtId)?.match;
      if (!match) return;
      const ids = [...match.teamA, ...match.teamB];
      h.courts = h.courts.map(c => c.id === courtId ? { ...c, match: null } : c);
      for (const id of ids) if (departures[index.get(id)!] <= clock) gone.add(id);
      updatePlayers(ids, p => ({ status: gone.has(p.id) ? 'resting' : 'waiting', waitSince: iso(), gameCount: p.gameCount + 1,
        mixedCount: p.mixedCount + (match.gameType === '혼복' && p.gender === 'M' ? 1 : 0) }));
      h.groupHistory = [...h.groupHistory, { matchId: match.id, members: ids, completedAt: iso() }];
      h.lastGameType = { ...h.lastGameType, ...Object.fromEntries(ids.map(id => [id, match.gameType])) };
      for (const id of ids) freeSince[index.get(id)!] = clock;
    };
    h.setResting = async (id, resting) => { updatePlayers([id], () => ({ status: resting ? 'resting' : 'waiting' })); };

    useAdminCoverageStore.setState({ loaded: true, memberIds: new Set(), starting: new Map(), prompt: null });
    const board = () => useBoardStore.getState();
    board().reset();
    board().setStageSize(1600, 2400);
    board().initializeFromPool([...h.players.values()]);
    board().ensureCourtGroups();

    const seenReservations = new Set<string>(), reservedTeams = new Set<string>(), waitingTeams = new Set<string>();
    let completionFills = 0, courtRegroups = 0, avoidableIdle = 0, brokenTeamMinutes = 0;
    const queued = () => [...board().drafts.values()].filter(t => t.courtId == null);
    const size = (id: string) => teamMembers(id, board().drafts, board().reservations).length;
    const observe = () => {
      for (const r of board().reservations.values()) { seenReservations.add(r.id); reservedTeams.add(r.teamId); }
      for (const t of board().drafts.values()) if (t.waitForCompletion) waitingTeams.add(t.id);
    };
    const waitingMembers = () => new Map(queued().filter(t => t.waitForCompletion).map(t => [t.id, size(t.id)]));

    // A queued ordinary team below four (a departure broke it) that its card button can still repair.
    const broken = () => queued().filter(t => !t.waitForCompletion && size(t.id) < 4
      && teamMembers(t.id, board().drafts, board().reservations).some(m => h.players.get(m.playerId)?.status === 'waiting'));
    async function courts() {
      let changed = false;
      for (const court of h.courts) {
        if (court.match || matches.length >= games) continue;
        const groupId = `court-${court.id}`;
        const before = waitingMembers();
        tick();
        if (size(groupId) < 4) board().autoFillTeam(groupId); // Court card CTA.
        for (const [id, n] of before) if ((board().drafts.get(id) ? size(id) : 0) < n) courtRegroups++;
        observe();
        const s = board();
        if (size(groupId) === 4 && isTeamStartable(groupId, s.drafts, s.reservations, s.magnets, playingIdsFromCourts(h.courts))) {
          tick();
          await board().startMatch(groupId); // Second press: 경기시작.
          if (h.courts.find(c => c.id === court.id)?.match) changed = true;
        }
      }
      return changed;
    }
    function queue() {
      let changed = false;
      for (const team of broken()) {
        const before = size(team.id);
        tick();
        // HEAD's card button fills ordinary teams; the working tree may turn them into waiting teams.
        if (config.mode === 'legacy') board().autoFillTarget({ teamId: team.id }, [], { waitForCompletion: false });
        else board().autoFillTeam(team.id);
        observe();
        if (!board().drafts.has(team.id) || size(team.id) !== before || board().drafts.get(team.id)!.waitForCompletion) changed = true;
      }
      while (queued().length < config.depth && matches.length + queued().length < games) {
        const before = new Set(queued().map(t => t.id));
        tick();
        board().autoFillTarget({ newTeam: true }, [], config.mode === 'legacy' ? { waitForCompletion: false } : undefined);
        observe();
        const created = queued().find(t => !before.has(t.id));
        if (!created) break;
        changed = true;
        if (config.tapFill && created.waitForCompletion) { tick(); board().autoFillTeam(created.id); observe(); } // Waiting card button.
      }
      return changed;
    }
    async function operate() {
      for (let round = 0; round < 12; round++) {
        const changed = config.order === 'queue-first' ? [queue(), await courts()] : [await courts(), queue()];
        if (!changed.some(Boolean)) break;
      }
    }

    await operate();
    const pendingArrivals = arrivals.map((at, i) => ({ at, i })).filter(a => a.at > 0);
    const pendingDepartures = departures.map((at, i) => ({ at, i })).filter(d => Number.isFinite(d.at));
    const players = () => roster.map(p => h.players.get(p.id)!);
    let stalled = 0;
    while (matches.length < games || ends.length) {
      const next = Math.min(...ends.map(e => e.at), ...pendingArrivals.map(a => a.at), ...pendingDepartures.map(d => d.at));
      if (!Number.isFinite(next)) { stalled = 1; break; }
      // Courts left empty while the free players could have formed an allowed four.
      if (matches.length < games) avoidableIdle += Math.min(h.courts.filter(c => !c.match).length, games - matches.length,
        readyCapacity(roster.map((_, i) => i), players())) * (next - clock) / MIN;
      if (matches.length < games) brokenTeamMinutes += broken().length * (next - clock) / MIN;
      clock = Math.max(clock, next);
      for (const a of pendingArrivals.filter(a => a.at <= clock)) {
        // complete_match's late-join rule: start from the active players' average count.
        const baseline = joinBaseline(players());
        updatePlayers([roster[a.i].id], p => ({ status: 'waiting', cockChecked: true, waitSince: iso(), gameCount: Math.max(p.gameCount, baseline) }));
        pendingArrivals.splice(pendingArrivals.indexOf(a), 1);
      }
      for (const d of pendingDepartures.filter(d => d.at <= clock)) {
        pendingDepartures.splice(pendingDepartures.indexOf(d), 1);
        const id = roster[d.i].id;
        if (h.players.get(id)?.status === 'playing') continue; // Leaves when that match completes.
        tick(); gone.add(id); board().restPlayer(id);
        waitsAll.push((clock - freeSince[d.i]) / MIN);
      }
      for (const end of ends.filter(e => e.at <= clock).sort((a, b) => a.at - b.at || a.court - b.court)) {
        ends.splice(ends.indexOf(end), 1);
        const before = waitingMembers();
        tick();
        const leaving = [...gone];
        await board().completeMatch(end.court);
        for (const id of gone) if (!leaving.includes(id)) { tick(); board().restPlayer(id); }
        for (const [id, n] of before) if (n < 4 && board().drafts.has(id) && size(id) === 4) completionFills++;
        observe();
      }
      await operate();
    }
    // Waits that never reached a game: still waiting at the last start (departures were counted when leaving).
    const lastStart = Math.max(0, ...matches.map(m => m.start));
    roster.forEach((p, i) => { if (!gone.has(p.id) && arrivals[i] <= lastStart && h.players.get(p.id)?.status !== 'playing') waitsAll.push(Math.max(0, lastStart - freeSince[i]) / MIN); });
    const counts = roster.map((_, i) => matches.filter(m => m.ids.includes(i)).length);
    const run = measure('skill', config.seed, matches, roster, Math.max(0, ...waits), courtCount, roster.map(p => p.arrivalMinutes ?? 0));
    const rate = (min: number) => 100 * matches.filter(m => m.priorOverlap >= min).length / Math.max(1, matches.length);
    return { config, trace, metrics: { ...run.metrics,
      p90Wait: percentile(waits, .9), maxWaitAll: Math.max(0, ...waitsAll), brokenTeamMinutes, rematchPairRate: rate(2), rematchTripleRate: rate(3), avoidableIdle,
      reservations: seenReservations.size, reservedTeams: reservedTeams.size,
      waitingTeams: waitingTeams.size, completionFills, courtRegroups,
      minGames: Math.min(...counts), maxGames: Math.max(...counts), stalled: stalled || (matches.length < games ? 1 : 0) } };
  } finally { now.mockRestore(); }
}

export function summarize(runs: QueueRun[]) {
  const keys = Object.keys(runs[0].metrics) as (keyof QueueRun['metrics'])[];
  const stat = (q: 'mean' | 'p05' | 'p95') => Object.fromEntries(keys.map(key => {
    const xs = runs.map(r => r.metrics[key]);
    return [key, q === 'mean' ? xs.reduce((a, b) => a + b, 0) / xs.length : percentile(xs, q === 'p05' ? .05 : .95)];
  }));
  return { runs: runs.length, mean: stat('mean'), p05: stat('p05'), p95: stat('p95') };
}

const synthetic: QueueInput = {
  roster: testRoster.slice(0, 24).map((p, i) => ({ ...p, ...(i === 23 ? { arrivalMinutes: 25 } : {}), ...(i % 5 === 0 ? { departureMinutes: 90 + i } : {}) })),
  courts: 4, games: 36,
  replayMinutes: Array.from({ length: 36 }, (_, i) => 10 + (i * 7) % 6), durationPoolMinutes: [9, 10, 11, 12, 13, 14],
};

describe('prepared queue replay', () => {
  it('keeps one prepared team identical in both modes', async () => {
    for (const seed of [0, 1, 2]) {
      const [legacy, waiting] = [await runQueue(synthetic, { mode: 'legacy', depth: 1, seed }), await runQueue(synthetic, { mode: 'waiting', depth: 1, seed })];
      expect(waiting.trace).toEqual(legacy.trace);
      expect(legacy.metrics.stalled).toBe(0);
    }
  });
  it('is deterministic and never reserves playing people for waiting places', async () => {
    const first = await runQueue(synthetic, { mode: 'waiting', depth: 3, seed: 4 });
    expect((await runQueue(synthetic, { mode: 'waiting', depth: 3, seed: 4 })).trace).toEqual(first.trace);
    expect(first.metrics.waitingTeams).toBeGreaterThan(0);
    expect(first.metrics.reservations).toBe(0);
    expect(first.metrics.stalled).toBe(0);
    expect(first.trace).toHaveLength(synthetic.games);
  });
  it('keeps waiting places open until a completion whatever the operator order', async () => {
    // Filling them earlier (inside the court button, or 지금 채우기) regrouped the same bench: 42-75% here, vs 6-19%.
    for (const depth of [2, 3]) for (const extra of [{ tapFill: true }, { order: 'queue-first' as const }]) for (const seed of [1, 5]) {
      const run = await runQueue(synthetic, { mode: 'waiting', depth, seed, departures: true, ...extra });
      expect(run.metrics.waitingTeams).toBeGreaterThan(0);
      expect(run.metrics.rematchTripleRate).toBeLessThan(30);
    }
  });
  it('lets late arrivals join and repairs teams broken by departures', async () => {
    for (const mode of ['legacy', 'waiting'] as const) for (const order of ['court-first', 'queue-first'] as const) {
      const run = await runQueue(synthetic, { mode, depth: 2, seed: 3, departures: true, order });
      expect(run.metrics.stalled).toBe(0);
      expect(run.trace.some(ids => ids.includes(synthetic.roster[23].id))).toBe(true);
      expect(run.metrics.brokenTeamMinutes).toBe(0);
      expect(run.metrics.maxWaitAll).toBeGreaterThanOrEqual(run.metrics.maxWait);
    }
  });
  it.runIf(!!process.env.SIM_QUEUE_INPUT)('replays a recorded session', async () => {
    const input = JSON.parse(readFileSync(process.env.SIM_QUEUE_INPUT!, 'utf8')) as QueueInput;
    const seeds = Number(process.env.SIM_QUEUE_SEEDS ?? 100), depths = (process.env.SIM_QUEUE_DEPTHS ?? '1,2,3').split(',').map(Number);
    const modes = (process.env.SIM_QUEUE_MODES ?? 'legacy,waiting').split(',') as QueueMode[];
    const results = [];
    const scenarios = { base: { departures: true }, stay: { departures: false }, 'queue-first': { departures: true, order: 'queue-first' as const },
      'tap-fill': { departures: true, tapFill: true } };
    for (const [scenario, options] of Object.entries(scenarios)) for (const depth of depths) for (const mode of modes) {
      const runs: QueueRun[] = [];
      for (let seed = 1; seed <= seeds; seed++) runs.push(await runQueue(input, { mode, depth, seed, ...options }));
      const replay = await runQueue(input, { mode, depth, seed: 0, ...options });
      results.push({ scenario, mode, depth, replay: replay.metrics, ...summarize(runs),
        ...(process.env.SIM_QUEUE_TRACE ? { traces: [replay, ...runs].map(r => r.trace) } : {}) });
    }
    writeFileSync(process.env.SIM_QUEUE_OUT!, JSON.stringify({ games: input.games, courts: input.courts, players: input.roster.length, seeds, results }, null, 1));
  }, 1_800_000);
});
