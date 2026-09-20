import { describe, it, expect, vi } from 'vitest';
import { arrivalSchedule, chooseImproved, compare, completeExchange, compositionOf, createExchangeState, exchangeCost, groupCapacity, joinBaseline, measure, measureCourts, overlapScore, popcount, rng, selectRoster, shouldWaitForMix, simulate, type Config, type RosterPlayer } from './simulator';
import { autoFillTeammates } from './baseline/recommendTeammates';
import { determineGameType } from './baseline/pairPlayers';
import { testRoster } from './test-roster';
import type { SessionPlayer } from '../../src/types';

const roster: RosterPlayer[] = testRoster;
const config: Config = { games: 20, courts: 5, runs: 1, seed: 1, skillWeight: 1.5, skillPolicy: 'exchange', exchangeInterval: 3, selectionPolicy: 'legacy-wait' };
const mask = (ids: number[]) => ids.reduce((s, id) => s | 1 << id, 0);
function historyData(history: number[][], n = 8) {
  const pairs = Array.from({ length: n }, () => Array(n).fill(0));
  for (const group of history) for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { pairs[group[i]][group[j]]++; pairs[group[j]][group[i]]++; }
  return { pairs, masks: history.map(mask) };
}
describe('four-person simulator', () => {
  it('scores repeated pairs for 2/3/4 overlap as 1/3/6, never penalizes a single common player', () => {
    const h = historyData([[0, 1, 2, 3]]);
    expect(overlapScore([0, 4, 5, 6], h.masks, h.pairs)).toEqual([0, 0]);
    expect(overlapScore([0, 1, 4, 5], h.masks, h.pairs)).toEqual([1, 1]);
    expect(overlapScore([0, 1, 2, 4], h.masks, h.pairs)).toEqual([2, 3]);
    expect(overlapScore([0, 1, 2, 3], h.masks, h.pairs)).toEqual([3, 6]);
    expect(popcount(mask([0, 14, 28, 29]))).toBe(4);
  });
  it('counts encounters from all earlier games including repeated occurrences of the same pair', () => {
    const h = historyData([[0, 1, 2, 3], [0, 1, 4, 5], [0, 1, 6, 7]]);
    expect(overlapScore([0, 1, 2, 4], h.masks, h.pairs)).toEqual([2, 7]);
  });
  it.each(['legacy-wait', 'ready-first'] as const)('matches the unmodified current function at every %s decision, including busy proposals', selectionPolicy => {
    const result = simulate(roster, 'current', { ...config, selectionPolicy }, 7);
    const random = rng(7 ^ 0x81d3), order = roster.map((_, i) => i), epoch = Date.UTC(2026, 8, 8, 10);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    let started = 0;
    for (const decision of result.decisions) {
      const prior = result.matches.slice(0, started), completed = prior.filter(m => m.end <= decision.at).sort((a, b) => a.end - b.end || a.court - b.court), ongoing = prior.filter(m => m.end > decision.at);
      const ps: SessionPlayer[] = roster.map((p, id) => {
        const played = completed.filter(m => m.ids.includes(id));
        return { id: p.id, playerId: p.id, memberId: p.id, name: p.name, gender: p.gender,
          skills: { grade: p.grade }, allowMixedSingle: p.allowMixedSingle, status: ongoing.some(m => m.ids.includes(id)) ? 'playing' : 'waiting',
          gameCount: played.length, mixedCount: 0, waitSince: new Date(epoch + Math.max(0, ...played.map(m => m.end))).toISOString(), joinedAtMatch: 0, cockChecked: true };
      });
      const lastGameType = Object.fromEntries(prior.flatMap(m => m.ids.map(id => [roster[id].id, determineGameType(m.ids.map(i => ps[i]) as [SessionPlayer, SessionPlayer, SessionPlayer, SessionPlayer], [])])));
      const now = vi.spyOn(Date, 'now').mockReturnValue(epoch + decision.at);
      try {
        const picked = autoFillTeammates([], order.filter(id => selectionPolicy !== 'legacy-wait' || ps[id].status === 'waiting').map(id => ps[id]), {
          groupHistory: completed.map((m, i) => ({ matchId: String(i), members: m.ids.map(id => roster[id].id) })), lastGameType,
          ongoingGroups: ongoing.map(m => m.ids.map(id => roster[id].id)), playingIds: new Set(ongoing.flatMap(m => m.ids.map(id => roster[id].id))) }, 4, undefined, { maxPlaying: selectionPolicy === 'legacy-wait' ? 0 : 3 });
        expect(picked.map(p => p.id)).toEqual(decision.ids.map(id => roster[id].id));
        if (decision.reason === 'started') started++;
      } finally { now.mockRestore(); }
    }
  });
  it('avoids picking people twenty games ahead just for fresh pairings', () => {
    const h = historyData([[0, 1, 2, 3]]);
    const ps = roster.slice(0, 8).map((p, i) => ({ id: p.id, gender: 'M', skills: { grade: 5 }, gameCount: i < 4 ? 0 : 20,
      waitSince: new Date(0).toISOString(), allowMixedSingle: false, status: 'waiting' })) as SessionPlayer[];
    const group = chooseImproved([0, 1, 2, 3, 4, 5, 6, 7], ps, h.masks, h.pairs, {}, 0, 0);
    expect(group).toEqual([0, 1, 2, 3]);
  });
  it.each(['exchange', 'nearby'] as const)('matches zero-skill %s and diversity versions exactly, and reproduces fixed seeds', skillPolicy => {
    const a = simulate(roster, 'diversity', config, 2);
    const b = simulate(roster, 'skill', { ...config, skillWeight: 0, skillPolicy }, 2);
    expect(a.matches).toEqual(b.matches);
    expect(simulate(roster, 'diversity', config, 2)).toEqual(a);
  });
  it.each(['current', 'diversity', 'skill'] as const)('%s preserves counts, symmetry, four-person selection and court exclusivity', variant => {
    const run = simulate(roster, variant, config, 1);
    expect(run.matches).toHaveLength(config.games);
    expect(run.counts.reduce((a, b) => a + b, 0)).toBe(config.games * 4);
    expect(run.overlap.reduce((a, b) => a + b, 0)).toBe(config.games * (config.games - 1) / 2);
    for (let i = 0; i < roster.length; i++) {
      expect(run.pairs[i].reduce((a, b) => a + b, 0)).toBe(run.counts[i] * 3);
      expect(run.pairs[i][i]).toBe(0);
      for (let j = 0; j < roster.length; j++) expect(run.pairs[i][j]).toBe(run.pairs[j][i]);
    }
    for (const [index, m] of run.matches.entries()) {
      expect(new Set(m.ids).size).toBe(4);
      for (const other of run.matches.slice(0, index)) if (other.end > m.start) {
        expect(other.court).not.toBe(m.court);
        expect(other.ids.filter(id => m.ids.includes(id))).toHaveLength(0);
      }
    }
  });
  it('uses identical exogenous court times across all three variants and computes per-seed summaries', () => {
    const comparison = compare(roster, { ...config, runs: 2 });
    const timing = comparison.variants.map(v => v.sample.matches.map(m => [m.court, m.start, m.end]));
    expect(timing[0]).toEqual(timing[1]); expect(timing[1]).toEqual(timing[2]);
    for (const v of comparison.variants) expect(v.mean.coverage).toBeGreaterThan(0);
  });
  it('hand-calculated overlap statistics include 1-person overlap as non-repetition', () => {
    const run = measure('diversity', 1, [[0, 1, 2, 3], [0, 1, 4, 5], [0, 6, 7, 8]].map(ids => ({ ids, start: 0, end: 1, court: 1, spread: 0, priorOverlap: 0 })), roster.slice(0, 9), 0);
    expect(run.overlap).toEqual([0, 2, 1, 0, 0]);
    expect(run.metrics.repeatRate).toBeCloseTo(100 / 3);
    expect(run.metrics.peers).toBeCloseTo(34 / 9);
  });
  it('repeated games without the opposite band eventually outweigh a fixed proximity preference', () => {
    const grades = [1, 1, 1, 1, 10, 10, 10, 10];
    const ps = grades.map((grade, i) => ({ id: String(i), gender: 'M', skills: { grade }, gameCount: 0,
      waitSince: new Date(0).toISOString(), allowMixedSingle: false, status: 'waiting' })) as SessionPlayer[];
    const h = historyData([]), state = createExchangeState(grades, 3);
    const available = grades.map((_, i) => i);
    const old = chooseImproved(available, ps, [], h.pairs, {}, 0, 1.5);
    expect(new Set(old.map(i => state.bands[i])).size).toBe(1);
    state.gaps.fill(6);
    const group = chooseImproved(available, ps, [], h.pairs, {}, 0, 1.5, state);
    expect(group.some(i => grades[i] === 1)).toBe(true);
    expect(group.some(i => grades[i] === 10)).toBe(true);
    const cost = exchangeCost([0, 1, 4, 5], state);
    state.gaps.fill(12);
    expect(exchangeCost([0, 1, 4, 5], state)).toBeLessThan(cost);
  });
  it('updates only played personal streaks, cannot clear an extreme through the middle or bank surplus exchanges', () => {
    const state = createExchangeState([1, 2, 4, 5, 8, 9, 3, 10], 3);
    state.gaps.fill(3);
    completeExchange([0, 1, 2, 3], state);
    expect(state.gaps).toEqual([4, 4, 0, 0, 3, 3, 3, 3]);
    completeExchange([0, 1, 4, 5], state);
    expect(state.gaps).toEqual([0, 0, 0, 0, 0, 0, 3, 3]);
    completeExchange([0, 1, 4, 5], state);
    completeExchange([0, 1, 2, 3], state);
    expect(state.gaps[0]).toBe(1);
  });
  it('uses the available other band if an extreme is absent, and adds no impossible debt for a single band', () => {
    const two = createExchangeState([1, 2, 4, 5], 3);
    expect(two.targetBands).toEqual([[1], [1], [0], [0]]);
    completeExchange([0, 1, 2, 3], two);
    expect(two.gaps).toEqual([0, 0, 0, 0]);
    const one = createExchangeState([1, 2, 2, 3], 3);
    completeExchange([0, 1, 2, 3], one);
    expect(one.gaps).toEqual([0, 0, 0, 0]);
    expect(exchangeCost([0, 1, 2, 3], one)).toBe(0);
  });
  it('preserves overlap priority even under very large exchange debt', () => {
    const grades = [1, 1, 10, 10, 5, 5, 5, 5];
    const ps = grades.map((grade, i) => ({ id: String(i), gender: 'M', skills: { grade }, gameCount: 0,
      waitSince: new Date(0).toISOString(), allowMixedSingle: false, status: 'waiting' })) as SessionPlayer[];
    const h = historyData([[0, 1, 2, 3]]), state = createExchangeState(grades, 1);
    state.gaps.fill(100);
    const group = chooseImproved(grades.map((_, i) => i), ps, h.masks, h.pairs, {}, 0, 20, state);
    expect(overlapScore(group, h.masks, h.pairs)).toEqual([0, 0]);
  });
  it('measures unique cross-band pairs and individual gaps, including initial and trailing gaps', () => {
    const grades = [1, 2, 4, 5, 7, 8, 3, 10];
    const fixture = roster.slice(0, 8).map((p, i) => ({ ...p, grade: grades[i] }));
    const matches = [[0, 1, 2, 3], [0, 1, 4, 5], [0, 1, 4, 5], [0, 1, 2, 3], [0, 1, 2, 3]].map(ids => ({ ids, start: 0, end: 1, court: 1, spread: 0, priorOverlap: 0 }));
    const run = measure('skill', 1, matches, fixture, 0);
    expect(run.metrics.extremeCoverage).toBeCloseTo(4 / 9 * 100);
    expect(run.metrics.lowerMiddleCoverage).toBeCloseTo(4 / 6 * 100);
    expect(run.metrics.middleUpperCoverage).toBe(0);
    expect(run.metrics.isolatedExtreme).toBe(2); // Unplayed people still count.
    expect(run.metrics.maxExtremeGap).toBe(2);
    expect(run.exchange.games).toEqual([2, 2, 3, 3, 2, 2, 0, 0]);
    expect(run.exchange.maxGaps[0]).toBe(2);
  });
  it('rejects invalid exchange controls', () => {
    expect(() => simulate(roster, 'skill', { ...config, exchangeInterval: 0 }, 1)).toThrow('교류 간격');
    expect(() => simulate(roster, 'skill', { ...config, exchangeInterval: 2.5 }, 1)).toThrow('교류 간격');
    expect(() => simulate(roster, 'skill', { ...config, skillPolicy: 'invalid' as Config['skillPolicy'] }, 1)).toThrow('실력 반영');
  });
  it('waits only for a recent 3+ member regroup, never beyond the original court deadline or without ongoing games', () => {
    const previous = [0, 0, 0, 0, 1, 1, 1, 1], groups = [[0, 1, 2, 3], [4, 5, 6, 7]];
    expect(shouldWaitForMix([0, 1, 2, 3], previous, groups, 1000, 0, 60000, true)).toBe(true);
    expect(shouldWaitForMix([0, 1, 2, 4], previous, groups, 59999, 0, 60000, true)).toBe(true);
    expect(shouldWaitForMix([0, 1, 4, 5], previous, groups, 1000, 0, 60000, true)).toBe(false);
    expect(shouldWaitForMix([0, 1, 2, 3], previous, groups, 60000, 0, 60000, true)).toBe(false);
    expect(shouldWaitForMix([0, 1, 2, 3], previous, groups, 1000, 0, 60000, false)).toBe(false);
  });
  it.each(['current', 'diversity', 'skill'] as const)('%s starts every match within the court wait limit, with no simultaneous player/court use', variant => {
    const people = selectRoster(roster, 16), cfg = { ...config, courts: 4, games: 32, courtWaitSeconds: 60 };
    const run = simulate(people, variant, cfg, 5);
    expect(run.matches).toHaveLength(32);
    expect(run.metrics.maxCourtGap).toBeLessThanOrEqual(60);
    expect(run.metrics.courtUtilization).toBeGreaterThan(90);
    for (const [i, match] of run.matches.entries()) for (const other of run.matches.slice(0, i)) if (other.end > match.start) {
      expect(other.court).not.toBe(match.court);
      expect(other.ids.some(id => match.ids.includes(id))).toBe(false);
    }
  });
  it('exposes the full-capacity tradeoff: zero wait repeats four isolated groups, short waits create cross-court encounters', () => {
    const people = selectRoster(roster, 16), cfg = { ...config, courts: 4, games: 32 };
    const immediate = simulate(people, 'skill', { ...cfg, courtWaitSeconds: 0 }, 1);
    const bounded = simulate(people, 'skill', { ...cfg, courtWaitSeconds: 60 }, 1);
    expect(immediate.metrics.peers).toBe(3);
    expect(immediate.metrics.courtUtilization).toBe(100);
    expect(immediate.metrics.immediateRematchRate).toBe(100 * 28 / 32);
    expect(bounded.metrics.peers).toBeGreaterThan(immediate.metrics.peers);
    expect(bounded.metrics.immediateRematchRate).toBeLessThan(immediate.metrics.immediateRematchRate);
    expect(bounded.metrics.courtUtilization).toBeLessThan(100);
  });
  it('computes court time from actual intervals and keeps final wind-down out of repeated-turn utilization', () => {
    const games = [[1, 0, 10000], [2, 0, 15000], [1, 12000, 22000], [2, 20000, 30000]].map(([court, start, end]) => ({ court, start, end, ids: [0, 1, 2, 3], spread: 0, priorOverlap: 0 }));
    const stats = measureCourts(games, 2);
    expect(stats.courtIdleMinutes).toBeCloseTo(7 / 60);
    expect(stats.courtUtilization).toBe(82.5);
    expect(stats.meanCourtGap).toBe(3.5);
    expect(stats.maxCourtGap).toBe(5);
    expect(stats.elapsedMinutes).toBe(.5);
  });
  it('selects reproducible hypothetical subsets and never changes the complete source roster', () => {
    expect(selectRoster(roster, 30)).toEqual(roster);
    expect(selectRoster(roster, 16)).toHaveLength(16);
    expect(selectRoster([...roster].reverse(), 16).map(p => p.id).sort()).toEqual(selectRoster(roster, 16).map(p => p.id).sort());
    expect(() => selectRoster(roster, 31)).toThrow('참가 인원');
    expect(() => simulate(roster, 'skill', { ...config, courtWaitSeconds: -1 }, 1)).toThrow('코트 대기');
  });
  it('permits standard doubles and one woman from grade 4, independently of the old manual flag', () => {
    const men = Array.from({ length: 3 }, (_, i) => ({ ...roster[i], id: `m${i}`, gender: 'M' as const, grade: 5 }));
    function picked(grade: number, flag: boolean) {
      const people = [...men, { ...roster[3], id: 'f', gender: 'F' as const, grade, allowMixedSingle: flag }];
      const ps = people.map(p => ({ ...p, skills: { grade: p.grade }, gameCount: 0, status: 'waiting', waitSince: new Date(0).toISOString() })) as unknown as SessionPlayer[];
      return chooseImproved([0, 1, 2, 3], ps, [], historyData([], 4).pairs, {}, 0, 0);
    }
    expect(picked(3, true)).toEqual([]);
    expect(picked(4, false)).toEqual([0, 1, 2, 3]);
    expect(picked(5, false)).toEqual([0, 1, 2, 3]);
    expect(compositionOf([...men, { gender: 'F', grade: 4 }])).toBe(3);
    expect(compositionOf([{ gender: 'M', grade: 5 }, ...Array.from({ length: 3 }, () => ({ gender: 'F' as const, grade: 10 }))])).toBe(4);
  });
  it('keeps another court playable instead of consuming the only high-grade woman in a 1F3M group', () => {
    const people = roster.slice(0, 8).map((p, i) => ({ ...p, gender: i < 6 ? 'M' as const : 'F' as const, grade: i === 6 ? 4 : i === 7 ? 3 : 5 }));
    const ps = people.map(p => ({ ...p, skills: { grade: p.grade }, gameCount: 0, status: 'waiting', waitSince: new Date(0).toISOString() })) as unknown as SessionPlayer[];
    const group = chooseImproved(people.map((_, i) => i), ps, [], historyData([]).pairs, {}, 0, 1.5);
    expect(groupCapacity(6, 1, 1)).toBe(2);
    expect(groupCapacity(3, 1, 0)).toBe(0);
    expect(compositionOf(group.map(id => people[id]))).not.toBe(4);
    expect(compositionOf(people.filter((_, id) => !group.includes(id)))).not.toBe(4);
  });
  it('matches active rounded-mean join semantics without counting absent/resting/unchecked people', () => {
    const p = (gameCount: number, status: SessionPlayer['status'] = 'waiting', cockChecked = true) => ({ gameCount, status, cockChecked });
    expect(joinBaseline([p(2, 'playing'), p(5), p(40, 'resting'), p(0, 'waiting', false)])).toBe(4);
    expect(joinBaseline([])).toBe(0);
    expect(joinBaseline([p(4), p(4), p(4)])).toBe(4);
  });
  it.each(['current', 'diversity', 'skill'] as const)('%s never selects before arrival and keeps actual games distinct from the join baseline', variant => {
    const cfg = { ...config, games: 55, lateCount: 4, lateMinutes: 30, courtWaitSeconds: 60 };
    const run = simulate(roster, variant, cfg, 3), late = run.arrivals.flatMap((minute, id) => minute ? [id] : []);
    expect(late).toHaveLength(4);
    const completedBeforeArrival = run.matches.filter(m => m.end <= 30 * 60000);
    const baseline = Math.round(4 * completedBeforeArrival.length / 26);
    expect(baseline).toBeGreaterThan(0);
    for (const id of late) {
      expect(run.baselines[id]).toBe(baseline);
      expect(run.matches.filter(m => m.ids.includes(id)).every(m => m.start >= 30 * 60000)).toBe(true);
      expect(run.counts[id]).toBe(run.matches.filter(m => m.ids.includes(id)).length);
    }
    expect(run.counts.reduce((a, b) => a + b, 0)).toBe(cfg.games * 4);
    expect(run.lateWindowMinutes).toBe(30);
    if (variant !== 'current') expect(run.metrics.invalidCompositionRate).toBe(0);
  });
  it('does not give absent players pre-arrival waiting credit or extend the session for arrivals after the last game', () => {
    const run = simulate(roster, 'skill', { ...config, games: 4, lateCount: 4, lateMinutes: 120 }, 1);
    expect(run.metrics.elapsedMinutes).toBeLessThan(16);
    expect(run.metrics.maxWait).toBeLessThan(16);
    expect(run.metrics.latePostRate).toBe(0);
    for (const [id, minute] of run.arrivals.entries()) if (minute) expect(run.counts[id]).toBe(0);
  });
  it('offers an explicit zero-baseline control without changing arrival identities', () => {
    const cfg = { ...config, games: 55, lateCount: 4, lateMinutes: 30 };
    const a = simulate(roster, 'skill', cfg, 1), b = simulate(roster, 'skill', { ...cfg, lateCorrection: false }, 1);
    expect(a.arrivals).toEqual(b.arrivals);
    expect(a.baselines.some(x => x > 0)).toBe(true);
    expect(b.baselines.every(x => x === 0)).toBe(true);
    expect(arrivalSchedule(roster, { ...cfg, seed: 999 })).toEqual(a.arrivals);
  });
  it('counts post-arrival starts in the same 30-minute window, normalized per person per hour', () => {
    const people = roster.slice(0, 8).map(p => ({ ...p, gender: 'M' as const }));
    const games = [[0, [0, 1, 2, 3]], [30, [0, 1, 6, 7]], [40, [2, 3, 4, 5]], [60, [0, 1, 6, 7]]].map(([minute, ids]) => ({ ids: ids as number[], start: (minute as number) * 60000, end: ((minute as number) + 10) * 60000, court: 1, spread: 0, priorOverlap: 0 }));
    const run = measure('skill', 1, games, people, 0, 1, [0, 0, 0, 0, 0, 0, 30, 30]);
    expect(run.metrics.earlyPostRate).toBe(2);
    expect(run.metrics.latePostRate).toBe(2);
    expect(run.composition).toEqual([4, 0, 0, 0, 0]);
  });

  it('keeps a playable waiting group ahead of busy players despite repeat, skill and game-count advantages', () => {
    const ps = roster.slice(0, 8).map((p, i) => ({ ...p, playerId: p.id, memberId: p.id, mixedCount: 0, joinedAtMatch: 0, gender: 'M', skills: { grade: i < 4 ? 1 : 10 },
      status: i < 4 ? 'waiting' : 'playing', gameCount: i < 4 ? 20 : 0, cockChecked: true,
      waitSince: new Date(0).toISOString() })) as SessionPlayer[];
    const h = historyData([[0, 1, 2, 3]]), exchange = createExchangeState(ps.map(p => p.skills.grade), 1);
    exchange.gaps.fill(100);
    const ids = ps.map((_, i) => i);
    expect(chooseImproved(ids, ps, h.masks, h.pairs, {}, 0, 20, exchange)).toEqual([0, 1, 2, 3]);
    const scoreFirst = chooseImproved(ids, ps, h.masks, h.pairs, {}, 0, 20, exchange, 'score-first');
    expect(scoreFirst.some(id => ps[id].status === 'playing')).toBe(true);
  });
  it('uses the smallest busy-player count only when no legal ready group exists; never reserves four busy people', () => {
    const ps = roster.slice(0, 8).map((p, i) => ({ ...p, playerId: p.id, memberId: p.id, mixedCount: 0, joinedAtMatch: 0, gender: 'M', skills: { grade: 5 },
      status: i < 3 ? 'waiting' : 'playing', gameCount: i < 3 ? 20 : 0, cockChecked: true,
      waitSince: new Date(0).toISOString() })) as SessionPlayer[];
    const ids = ps.map((_, i) => i), pairs = historyData([]).pairs;
    const picked = chooseImproved(ids, ps, [], pairs, {}, 0, 0);
    expect(picked.filter(id => ps[id].status === 'playing')).toHaveLength(1);
    ps[3].status = 'waiting'; ps[3].gender = 'F'; ps[3].skills.grade = 3;
    ps[4].gender = 'F'; ps[4].skills.grade = 4;
    const genderLimited = chooseImproved(ids, ps, [], pairs, {}, 0, 0);
    expect(genderLimited.filter(id => ps[id].status === 'playing')).toHaveLength(1);
    expect(compositionOf(genderLimited.map(id => ({ gender: ps[id].gender, grade: ps[id].skills.grade })))).not.toBe(4);
    ps.forEach(p => p.status = 'playing');
    expect(chooseImproved(ids, ps, [], pairs, {}, 0, 0)).toEqual([]);
  });
  it('does not bring resting or unconfirmed players into fallback proposals', () => {
    const ps = roster.slice(0, 8).map((p, i) => ({ ...p, playerId: p.id, memberId: p.id, mixedCount: 0, joinedAtMatch: 0, gender: 'M', skills: { grade: 5 },
      status: i < 3 ? 'waiting' : 'resting', gameCount: 0, cockChecked: true,
      waitSince: new Date(0).toISOString() })) as SessionPlayer[];
    ps[3].status = 'waiting'; ps[3].cockChecked = false;
    expect(chooseImproved(ps.map((_, i) => i), ps, [], historyData([]).pairs, {}, 0, 0)).toEqual([]);
  });
  it.each(['diversity', 'skill'] as const)('%s never delays a legal ready group, including late arrivals and full courts', variant => {
    for (const count of [16, 20, 24, 30]) {
      const people = selectRoster(roster, count);
      const run = simulate(people, variant, { ...config, courts: 4, games: 32, selectionPolicy: 'ready-first', courtWaitSeconds: 180, lateCount: 2, lateMinutes: 8 }, 9);
      expect(run.metrics.avoidablePlayingProposals).toBe(0);
      expect(run.metrics.avoidableIdleMinutes).toBe(0);
      expect(run.metrics.invalidCompositionRate).toBe(0);
      expect(run.decisions.filter(d => d.reason !== 'started').every(d => d.readyCapacity === 0)).toBe(true);
      // Independently reconstruct the ready pool between every start/end/arrival.
      const lastStart = Math.max(...run.matches.map(m => m.start));
      const events = [...new Set([0, ...run.matches.flatMap(m => [m.start, m.end]), ...run.arrivals.map(x => x * 60000)])].filter(t => t < lastStart);
      for (const t of events) {
        const busy = run.matches.filter(m => m.start <= t && m.end > t);
        if (busy.length === 4) continue;
        const ready = people.filter((_, id) => run.arrivals[id] * 60000 <= t && !busy.some(m => m.ids.includes(id)));
        const men = ready.filter(p => p.gender === 'M').length, high = ready.filter(p => p.gender === 'F' && p.grade >= 4).length;
        expect(groupCapacity(men, ready.length - men - high, high)).toBe(0);
      }
      for (const [i, match] of run.matches.entries()) for (const other of run.matches.slice(0, i)) if (other.end > match.start) {
        expect(other.court).not.toBe(match.court);
        expect(other.ids.some(id => match.ids.includes(id))).toBe(false);
      }
    }
  });
  it('recomputes a busy proposal when an arrival makes a ready group legal, without locking its members', () => {
    const people = roster.slice(0, 9).map((p, i) => ({ ...p, gender: i < 7 ? 'M' as const : 'F' as const, grade: 3, arrivalMinutes: i === 8 ? 1 : 0 }));
    const run = simulate(people, 'skill', { ...config, courts: 2, games: 6, selectionPolicy: 'ready-first' }, 1);
    expect(run.decisions.some(d => d.at === 0 && d.reason === 'playing' && d.readyCount === 4 && d.readyCapacity === 0)).toBe(true);
    expect(run.matches.some(m => m.start === 60000)).toBe(true);
    expect(run.matches[0].end).toBeGreaterThan(60000);
    expect(run.metrics.avoidableIdleMinutes).toBe(0);
  });
  it('isolates the availability policy with an explicit score-only control while keeping the current selector unchanged', () => {
    const cfg = { ...config, selectionPolicy: 'ready-first' as const, games: 30 };
    const current = simulate(roster, 'current', cfg, 1);
    expect(current.metrics.avoidablePlayingProposals).toBeGreaterThan(0);
    expect(current.metrics.avoidableIdleMinutes).toBeGreaterThan(0);
    expect(simulate(roster, 'current', { ...cfg, selectionPolicy: 'score-first' }, 1)).toEqual(current);
    const before = simulate(roster, 'skill', { ...cfg, selectionPolicy: 'score-first' }, 1);
    const after = simulate(roster, 'skill', cfg, 1);
    expect(before.metrics.avoidablePlayingProposals).toBeGreaterThan(0);
    expect(after.metrics.avoidablePlayingProposals).toBe(0);
    expect(after.metrics.courtUtilization).toBeGreaterThan(before.metrics.courtUtilization);
    expect(before.matches.map(m => m.end - m.start)).toEqual(after.matches.map(m => m.end - m.start));
  });
});
