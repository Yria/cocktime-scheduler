import type { RosterPlayer } from './simulator';

// Standalone synthetic fixture. Recorded member data stays in local input.json.
export const testRoster: RosterPlayer[] = Array.from({ length: 30 }, (_, i) => ({
  id: `synthetic-player-${String(i + 1).padStart(2, '0')}`,
  name: `테스트 선수 ${i + 1}`,
  gender: i < 20 ? 'M' : 'F',
  grade: i % 10 + 1,
  allowMixedSingle: false,
}));
