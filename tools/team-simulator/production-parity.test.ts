import { describe, expect, it, vi } from 'vitest';
import { autoFillTeammates } from '../../src/lib/teamSelection/recommendTeammates';
import { allowedGameType } from '../../src/lib/teamSelection/groupPolicy';
import type { SessionPlayer } from '../../src/types';
import { rng, simulate, type Config, type RosterPlayer } from './simulator';
import { testRoster } from './test-roster';

const roster: RosterPlayer[] = testRoster;
const epoch = Date.UTC(2026, 8, 8, 10);
const config: Config = { games: 55, courts: 5, runs: 1, seed: 1, skillWeight: 1.5, skillPolicy: 'exchange', exchangeInterval: 3, selectionPolicy: 'ready-first' };

describe('production selector matches the independently implemented simulator policy', () => {
  it.each([0, 4])('replays every decision of 20 seeds, with %i late arrivals', lateCount => {
    for (let seed = 1; seed <= 20; seed++) {
      const run = simulate(roster, 'skill', { ...config, lateCount, lateMinutes: 30 }, seed);
      const random = rng(seed ^ 0x81d3), order = roster.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      let started = 0;
      for (const decision of run.decisions) {
        const prior = run.matches.slice(0, started);
        const completed = prior.filter(m => m.end <= decision.at).sort((a, b) => a.end - b.end || a.court - b.court);
        const ongoing = prior.filter(m => m.end > decision.at);
        const players: SessionPlayer[] = roster.map((p, id) => {
          const played = completed.filter(m => m.ids.includes(id)), arrived = run.arrivals[id] * 60000 <= decision.at;
          return { ...p, playerId: p.id, memberId: p.id, skills: { grade: p.grade },
            status: !arrived ? 'resting' : ongoing.some(m => m.ids.includes(id)) ? 'playing' : 'waiting',
            gameCount: played.length + run.baselines[id], mixedCount: 0,
            waitSince: new Date(epoch + Math.max(run.arrivals[id] * 60000, ...played.map(m => m.end))).toISOString(),
            joinedAt: new Date(epoch + run.arrivals[id] * 60000).toISOString(), joinedAtMatch: 0, cockChecked: arrived };
        });
        const now = vi.spyOn(Date, 'now').mockReturnValue(epoch + decision.at);
        try {
          const picked = autoFillTeammates([], order.map(id => players[id]).filter(p => p.status !== 'resting'), {
            players, cockCheckEnabled: true,
            groupHistory: completed.map((m, index) => ({ matchId: String(index), members: m.ids.map(id => players[id].id), completedAt: new Date(epoch + m.end).toISOString() })),
            playingIds: new Set(ongoing.flatMap(m => m.ids.map(id => players[id].id))),
            lastGameType: Object.fromEntries(prior.flatMap(m => m.ids.map(id => [players[id].id, allowedGameType(m.ids.map(i => players[i]))!]))),
          }, 4, undefined, { maxPlaying: 3 });
          expect(picked.map(p => p.id), `seed ${seed}, at ${decision.at}, decision ${started}`).toEqual(decision.ids.map(id => players[id].id));
        } finally { now.mockRestore(); }
        if (decision.reason === 'started') started++;
      }
    }
  });
});
