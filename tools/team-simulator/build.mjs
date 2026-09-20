import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve('tools/team-simulator');
const out = resolve('reports/team-simulator-20260916');
mkdirSync(out, { recursive: true });
const esbuildDir = readdirSync('node_modules/.pnpm').find(name => name.startsWith('esbuild@'));
if (!esbuildDir) throw new Error('Install the project dependencies before building the simulator.');
const { build } = await import(pathToFileURL(resolve('node_modules/.pnpm', esbuildDir, 'node_modules/esbuild/lib/main.js')));
await build({ entryPoints: [`${root}/simulator.ts`], outfile: `${out}/engine.mjs`, bundle: true, platform: 'node', format: 'esm', target: 'es2022' });
const { compare, selectRoster } = await import(pathToFileURL(`${out}/engine.mjs`).href + `?v=${Date.now()}`);
const input = JSON.parse(readFileSync(`${root}/input.json`, 'utf8'));
const config = { games: input.actualCompletedGames, courts: input.session.court_count, runs: Number(process.env.SIM_RUNS || 20), seed: 1, skillWeight: 1.5, skillPolicy: 'exchange', exchangeInterval: 3, selectionPolicy: 'ready-first', courtWaitSeconds: 60, lateCount: 0, lateMinutes: 30, lateCorrection: true };
console.log(`Simulating ${input.players.length} players, ${config.games} matches, ${config.runs} seeds × 3 variants`);
const result = compare(input.players, config, (done, total) => { if (done % 15 === 0 || done === total) console.log(`${done}/${total}`); });
writeFileSync(`${out}/results.json`, JSON.stringify(result, null, 2));
const nearbyResult = compare(input.players, { ...config, skillPolicy: 'nearby' });
writeFileSync(`${out}/nearby-results.json`, JSON.stringify(nearbyResult, null, 2));
const capacityRoster = selectRoster(input.players, 16);
const capacityConfig = { ...config, games: 32, courts: 4 };
const capacity = { ready: compare(capacityRoster, capacityConfig), immediate: compare(capacityRoster, { ...capacityConfig, selectionPolicy: 'legacy-wait', courtWaitSeconds: 0 }), bounded: compare(capacityRoster, { ...capacityConfig, selectionPolicy: 'legacy-wait' }) };
writeFileSync(`${out}/capacity-results.json`, JSON.stringify(capacity, null, 2));
const lateConfig = { ...config, lateCount: 4, lateMinutes: 30 };
const late = { corrected: compare(input.players, lateConfig), uncorrected: compare(input.players, { ...lateConfig, lateCorrection: false }) };
writeFileSync(`${out}/late-results.json`, JSON.stringify(late, null, 2));
console.log('Comparing ready priority against its score-only control and the previous simulator');
const availability = { readyFirst: result, scoreFirst: compare(input.players, { ...config, selectionPolicy: 'score-first' }), legacy: compare(input.players, { ...config, selectionPolicy: 'legacy-wait' }) };
writeFileSync(`${out}/availability-results.json`, JSON.stringify(availability, null, 2));
const scenarios = [capacity.ready, ...[20, 24].map(count => compare(selectRoster(input.players, count), { ...config, courts: 4 })), result];
writeFileSync(`${out}/availability-scenarios.json`, JSON.stringify(scenarios, null, 2));
copyFileSync(`${root}/input.json`, `${out}/input.json`);
const worker = await build({ entryPoints: [`${root}/worker.ts`], bundle: true, write: false, format: 'iife', target: 'es2022', minify: true });
const app = await build({ entryPoints: [`${root}/app.ts`], bundle: true, write: false, format: 'iife', target: 'es2022', minify: true,
  define: { __INPUT__: JSON.stringify(input), __DEFAULT_RESULTS__: JSON.stringify(result), __WORKER_SOURCE__: JSON.stringify(worker.outputFiles[0].text) } });
const html = readFileSync(`${root}/template.html`, 'utf8').replace('/* CSS */', readFileSync(`${root}/style.css`, 'utf8')).replace('/* APP */', () => app.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
writeFileSync(`${out}/index.html`, html);
const sources = ['tools/team-simulator/baseline/recommendTeammates.ts', 'tools/team-simulator/baseline/rankCandidates.ts', 'tools/team-simulator/baseline/pairPlayers.ts', 'src/types/index.ts',
  'src/lib/teamSelection/recommendTeammates.ts', 'src/lib/teamSelection/groupPolicy.ts',
  'tools/team-simulator/simulator.ts', 'tools/team-simulator/input.json'];
const hashes = Object.fromEntries(sources.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]));
mkdirSync(`${out}/current-source`, { recursive: true });
for (const file of sources.filter(file => file.includes('/baseline/'))) copyFileSync(file, `${out}/current-source/${file.split('/').at(-1)}`);
writeFileSync(`${out}/provenance.json`, JSON.stringify({ builtAt: new Date().toISOString(), hashes, config,
  baseline: 'Frozen pre-migration autoFillTeammates (2026-09-18), no manual seed, waiting + playing pool, maxPlaying=3. Proposals with busy players wait for the next completion/arrival and are recomputed; no exclusive reservation or fixed queue. This harness is not a reproduction of the full production app.',
  objectives: 'Improved: a legal ready group always wins; preserve maximum disjoint ready group capacity. Only when none is legal, propose a legal group with the fewest busy players (at least one ready anchor). Then minimize overplay, max overlap, pair encounters, participation/wait/rotation + skill. A score-first ablation removes the hard availability priority but keeps W_PLAYING=30 and all remaining objectives. It is a synthetic control, not the previous improved algorithm.',
  assumptions: ['default all present initially; optional fixed-seed late arrivals are hypothetical', 'no voluntary rest; join count is rounded mean of active corrected counts, not fabricated match history', 'no human assembly delay, manual seeds, persistent queue or exclusive reservations; provisional groups are recomputed on each completion/arrival', 'new default has no mixing wait; courtWaitSeconds only applies in legacy-wait mode (all three selectors ready-only, reproducing the old simulator)', '10-15 minute uniform durations, shared per start number, future ends hidden from selection', 'all scheduled simulated matches complete', 'avoidable idle is fillable empty courts integrated over time before the last start; unit court-minutes, disjoint legal group capacity is respected', 'proposal counts count re-evaluation events, not distinct teams or actual match starts'],
  capacityExperiment: { participants: 16, games: 32, courts: 4, description: 'Hypothetical fixed grade-spanning subset of the recorded 30 players, not an actual 16-person session.' } }, null, 2));
console.log(JSON.stringify(result.variants.map(v => ({ variant: v.variant, ...v.mean })), null, 2));
console.log(out + '/index.html');
