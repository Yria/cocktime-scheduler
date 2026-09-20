import { COMPOSITION_LABELS, compositionOf, selectRoster, skillBand, type Comparison, type Config, type RosterPlayer, type Variant } from './simulator';

declare const __INPUT__: { fetchedAt: string; session: { id: number; scheduled_at: string; court_count: number }; actualCompletedGames: number; players: RosterPlayer[] };
declare const __DEFAULT_RESULTS__: Comparison;
declare const __WORKER_SOURCE__: string;

const source = __INPUT__;
const names: Record<Variant, string> = { current: '변경 전 알고리즘', diversity: '개선 · 중복 최소화', skill: '개선 · 중복 + 실력' };
const colors: Record<Variant, string> = { current: '#2563eb', diversity: '#087f70', skill: '#8050bd' };
const variants: Variant[] = ['current', 'diversity', 'skill'];
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number, digits = 1) => n.toFixed(digits);
const plotWidth = (id: string) => Math.max(260, Math.round($(id).getBoundingClientRect().width));
let results = __DEFAULT_RESULTS__;
let roster = results.roster;
let worker: Worker | null = null;
let workerURL = '';
let person = 0;
let matchVariant: Variant = 'current';

function legend() { return variants.map(v => `<span class="legend-item"><i style="background:${colors[v]}"></i>${names[v]}</span>`).join(''); }
function chart(title: string, body: string, width = 620, height = 240, desc = '') {
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(title)}" xmlns="http://www.w3.org/2000/svg"><title>${escape(title)}</title><desc>${escape(desc)}</desc><style>text{font-family:system-ui,-apple-system,sans-serif;fill:#485367;font-size:13px}</style>${body}</svg>`;
}
function metricBars(key: 'spread' | 'gameStd' | 'maxExtremeGap' | 'meanCourtGap' | 'avoidablePlayingProposals' | 'avoidableIdleMinutes', unit: string) {
  const max = Math.max(1, ...results.variants.map(v => v.p95[key])) * 1.15;
  const width = plotWidth(key === 'spread' ? 'skill-chart' : key === 'gameStd' ? 'fairness-chart' : key === 'meanCourtGap' ? 'court-gap-chart' : key === 'avoidablePlayingProposals' ? 'busy-choice-chart' : key === 'avoidableIdleMinutes' ? 'avoidable-idle-chart' : 'exchange-gap-chart'), start = width < 400 ? 102 : 145, end = width - 58;
  let body = '';
  for (let tick = 0; tick <= 4; tick++) { const x = start + tick / 4 * (end - start); body += `<path d="M${x} 12V174" stroke="#e5e9ef"/><text x="${x}" y="200" text-anchor="middle">${fmt(max * tick / 4)}</text>`; }
  results.variants.forEach((v, i) => {
    const y = 27 + i * 54, x1 = start + v.p05[key] / max * (end - start), x2 = start + v.p95[key] / max * (end - start);
    body += `<text x="0" y="${y + 19}">${names[v.variant].replace('알고리즘', '').replace('개선 · ', '')}</text><rect x="${start}" y="${y}" width="${v.mean[key] / max * (end - start)}" height="29" rx="4" fill="${colors[v.variant]}"/><path d="M${x1} ${y + 14}H${x2}M${x1} ${y + 8}V${y + 20}M${x2} ${y + 8}V${y + 20}" stroke="#172438" stroke-width="2"/><text x="${end + 15}" y="${y + 19}" style="font-weight:700;fill:#172438">${fmt(v.mean[key], 2)}${unit}</text>`;
  });
  return chart(key === 'spread' ? '네 명의 평균 실력 범위' : key === 'gameStd' ? '출전 횟수 표준편차' : key === 'meanCourtGap' ? '코트에서 경기 종료 후 다음 경기까지 평균 공백 초' : key === 'avoidablePlayingProposals' ? '대기자로 편성 가능한데 경기 중인 사람을 포함한 후보 횟수' : key === 'avoidableIdleMinutes' ? '대기자로 시작할 수 있었던 코트의 총 공백 분' : '상·하위 참가자의 반대 실력대 미교류 최장 연속 출전', body, width, 212, '막대는 반복 실행 평균, 가는 선은 실행 결과의 5~95백분위 범위입니다.');
}
function courtTimeline() {
  const width = plotWidth('court-timeline-chart'), left = 42, right = width - 12;
  const selected = Number($<HTMLSelectElement>('timeline-window').value);
  const end = Math.min(selected || Infinity, Math.max(...results.variants.flatMap(v => v.sample.matches.map(m => m.end / 60000))));
  const groupHeight = results.config.courts * 23 + 40, height = groupHeight * 3 + 24;
  let body = '';
  results.variants.forEach((v, index) => {
    const top = index * groupHeight;
    body += `<text x="0" y="${top + 15}" style="font-weight:700;fill:${colors[v.variant]}">${names[v.variant]}</text>`;
    for (let court = 1; court <= results.config.courts; court++) {
      const y = top + 26 + (court - 1) * 23;
      body += `<text x="0" y="${y + 13}">${court}코트</text>`;
      const games = v.sample.matches.filter(m => m.court === court);
      const courtEnd = Math.min(end, Math.max(0, ...games.map(m => m.end / 60000)));
      body += `<rect x="${left}" y="${y}" width="${right - left}" height="16" fill="#f1f4f8"/><rect x="${left}" y="${y}" width="${courtEnd / end * (right - left)}" height="16" fill="#db9b31"/>`;
      for (const m of games) if (m.start / 60000 < end) {
        const x = left + m.start / 60000 / end * (right - left), w = (Math.min(end, m.end / 60000) - m.start / 60000) / end * (right - left);
        body += `<rect x="${x}" y="${y}" width="${w}" height="16" fill="${colors[v.variant]}"><title>${fmt(m.start / 60000)}~${fmt(m.end / 60000)}분 · ${m.ids.map(id => escape(roster[id].name)).join(' · ')}</title></rect>`;
      }
    }
  });
  for (let i = 0; i <= 3; i++) body += `<text x="${left + i / 3 * (right - left)}" y="${height - 4}" text-anchor="middle">${fmt(end * i / 3, 0)}분</text>`;
  return chart('세 알고리즘의 코트별 경기와 빈 시간', body, width, height, '선택 시드의 한 실행. 파랑·초록·보라가 경기, 노랑이 빈 코트, 회색은 해당 코트의 마지막 경기 이후입니다.');
}
function compositionChart() {
  const width = plotWidth('composition-chart'), shades = ['#2563eb', '#ad427e', '#087f70', '#8050bd', '#bc4b26'];
  let body = '';
  results.variants.forEach((v, row) => {
    const top = row * 70;
    body += `<text x="0" y="${top + 15}" style="font-weight:700;fill:${colors[v.variant]}">${names[v.variant]}</text><text x="${width}" y="${top + 15}" text-anchor="end">조건 밖 ${fmt(v.mean.invalidCompositionRate)}%</text>`;
    let x = 0;
    v.composition.forEach((count, index) => {
      const w = count / results.config.games * width;
      body += `<rect x="${x}" y="${top + 28}" width="${w}" height="24" fill="${shades[index]}"><title>${COMPOSITION_LABELS[index]}: 평균 ${fmt(count)}경기 (${fmt(count / results.config.games * 100)}%)</title></rect>`;
      if (w >= 35) body += `<text x="${x + w / 2}" y="${top + 44}" text-anchor="middle" style="fill:white;font-size:12px;font-weight:700">${fmt(count / results.config.games * 100, 0)}%</text>`;
      x += w;
    });
  });
  return chart('성별 구성에 따른 경기 비율', body, width, 210, '네 명의 실제 성별과 여성 등급으로 분류합니다. 조건 밖은 여3남1 또는 여1남3에서 여성이 4점 미만인 경우입니다.');
}
function lateChart() {
  if (!results.config.lateCount && !roster.some(p => p.arrivalMinutes)) return '<p class="empty-chart">위의 ‘늦참 인원’을 선택하면 합류 후 출전 빈도를 비교할 수 있어.</p>';
  const width = plotWidth('late-chart'), left = 38, right = width - 10, bottom = 196;
  const max = Math.max(1, ...results.variants.flatMap(v => [v.mean.earlyPostRate, v.mean.latePostRate])) * 1.2;
  let body = '';
  for (let tick = 0; tick <= 3; tick++) { const y = bottom - tick / 3 * 160; body += `<path d="M${left} ${y}H${right}" stroke="#e5e9ef"/><text x="30" y="${y + 4}" text-anchor="end">${fmt(max * tick / 3)}</text>`; }
  const group = (right - left) / 3;
  results.variants.forEach((v, index) => {
    const center = left + (index + .5) * group, barWidth = Math.min(32, group / 3);
    [v.mean.earlyPostRate, v.mean.latePostRate].forEach((rate, cohort) => {
      const x = center + (cohort ? 3 : -barWidth - 3), y = bottom - rate / max * 160;
      body += `<rect x="${x}" y="${y}" width="${barWidth}" height="${bottom - y}" fill="${cohort ? colors[v.variant] : '#64748b'}"/><text x="${x + barWidth / 2}" y="${y - 7}" text-anchor="middle" style="font-size:12px">${fmt(rate)}</text>`;
    });
    body += `<text x="${center}" y="221" text-anchor="middle">${['현재', '중복', '중복+실력'][index]}</text>`;
  });
  return chart('합류 후 기존 참가자와 늦참자의 시간당 출전 시작 횟수', body, width, 232, '마지막 합류 시각부터 최대 30분을 동일하게 관찰합니다. 각 집단의 1인당 출전 시작 수를 시간당으로 환산합니다. 회색은 기존 참가자, 알고리즘 색상은 늦참자입니다.');
}
function crossBandChart() {
  const width = plotWidth('cross-band-chart'), start = 72, end = width - 48;
  let body = '';
  const bands = [0, 1, 2].map(b => roster.filter(p => skillBand(p.grade) === b).length);
  const rows = [['lowerMiddleCoverage', '하위 ↔ 중위', bands[0] * bands[1]], ['middleUpperCoverage', '중위 ↔ 상위', bands[1] * bands[2]], ['extremeCoverage', '하위 ↔ 상위', bands[0] * bands[2]]] as const;
  rows.forEach(([key, label, possible], row) => {
    const top = row * 108;
    body += `<text x="0" y="${top + 15}" style="font-weight:700;fill:#172438">${label}</text><text x="${width}" y="${top + 15}" text-anchor="end">가능한 ${possible}쌍</text>`;
    results.variants.forEach((v, index) => {
      const y = top + 29 + index * 22;
      body += `<text x="0" y="${y + 13}">${['현재', '중복', '실력'][index]}</text><rect x="${start}" y="${y}" width="${end - start}" height="16" rx="3" fill="#f1f4f8"/><rect x="${start}" y="${y}" width="${v.mean[key] / 100 * (end - start)}" height="16" rx="3" fill="${colors[v.variant]}"/><text x="${width}" y="${y + 13}" text-anchor="end">${fmt(v.mean[key])}%</text>`;
    });
  });
  for (let tick = 0; tick <= 2; tick++) body += `<text x="${start + tick / 2 * (end - start)}" y="337" text-anchor="middle">${tick * 50}%</text>`;
  return chart('실력대 사이에서 한 번 이상 만난 고유 동반 관계 비율', body, width, 346, '각 실력대 사이에서 가능한 모든 쌍 중 실제로 같은 경기에 들어간 쌍의 비율. 모든 막대는 0~100%입니다.');
}
function coverageChart() {
  const width = plotWidth('coverage-chart'), left = 38, right = width - 16, top = 16, bottom = 214, n = results.config.games, maxPeers = roster.length - 1;
  let body = '';
  for (const tick of [...new Set([0, ...[5, 10, 15, 20, 25].filter(t => t < maxPeers), maxPeers])]) { const y = bottom - tick / maxPeers * (bottom - top); body += `<path d="M${left} ${y}H${right}" stroke="#e5e9ef"/><text x="32" y="${y + 4}" text-anchor="end">${tick}</text>`; }
  for (const tick of [...new Set([1, Math.round(n / 4), Math.round(n / 2), Math.round(n * .75), n])]) {
    const x = left + (tick - 1) / (n - 1) * (right - left); body += `<text x="${x}" y="239" text-anchor="middle">${tick}</text>`;
  }
  results.variants.forEach((v, i) => {
    const points = v.series.peers.map((value, k) => `${left + k / (n - 1) * (right - left)},${bottom - value / maxPeers * (bottom - top)}`).join(' ');
    body += `<polyline points="${points}" fill="none" stroke="${colors[v.variant]}" stroke-width="3" ${i ? `stroke-dasharray="${i === 1 ? '8 3' : '2 4'}"` : ''}/><circle cx="${right}" cy="${bottom - v.mean.peers / maxPeers * (bottom - top)}" r="4" fill="${colors[v.variant]}"/>`;
  });
  body += `<text x="${right}" y="260" text-anchor="end">전체 경기 진행 순서</text>`;
  return chart('경기가 진행될수록 한 사람이 만난 서로 다른 사람 수', body, width, 270, `위쪽 선일수록 더 다양한 사람과 만났습니다. 최대 ${maxPeers}명입니다.`);
}
function overlapChart() {
  const width = plotWidth('overlap-chart'), right = width - 2;
  const shades = ['#db9b31', '#da693b', '#b62e4f'];
  const comparisons = results.config.games * (results.config.games - 1) / 2;
  const maxRate = Math.max(1, Math.ceil(Math.max(...results.variants.map(v => v.mean.repeatRate))));
  let body = '';
  results.variants.forEach((v, index) => {
    const y = 15 + index * 69, bins = v.overlap.slice(2);
    body += `<text x="0" y="${y + 14}" style="font-weight:600;fill:${colors[v.variant]}">${names[v.variant]}</text><text x="${right}" y="${y + 14}" text-anchor="end">${fmt(v.mean.repeatRate)}% 중복</text>`;
    let x = 0;
    body += `<rect x="0" y="${y + 27}" width="${right}" height="24" fill="#f1f4f8"/>`;
    bins.forEach((count, i) => { const w = count / comparisons * 100 / maxRate * right; body += `<rect x="${x}" y="${y + 27}" width="${w}" height="24" fill="${shades[i]}"><title>${['2명', '3명', '4명'][i]} 공통: ${fmt(count / comparisons * 100, 2)}%, 평균 ${fmt(count)}쌍</title></rect>`; x += w; });
  });
  for (let tick = 0; tick <= 4; tick++) body += `<text x="${right * tick / 4}" y="239" text-anchor="${tick === 0 ? 'start' : tick === 4 ? 'end' : 'middle'}">${fmt(maxRate * tick / 4)}%</text>`;
  return chart('서로 다른 두 경기의 공통 인원 분포', body, width, 245, `총 ${comparisons}개의 경기 쌍이 분모입니다. 0~1명 공통은 제외하고 2명, 3명, 4명 공통 비율을 같은 축에 표시합니다.`);
}
function histogramChart() {
  const length = Math.max(...results.variants.map(v => v.countHistogram.length));
  const max = Math.max(1, ...results.variants.flatMap(v => v.countHistogram));
  const width = plotWidth('histogram-chart'), left = 36, right = width - 12, bottom = 186, group = (right - left) / length;
  let body = '';
  for (let t = 0; t <= 3; t++) { const y = bottom - t / 3 * 160; body += `<path d="M${left} ${y}H${right}" stroke="#e5e9ef"/><text x="26" y="${y + 4}" text-anchor="end">${fmt(max * t / 3)}</text>`; }
  for (let count = 0; count < length; count++) {
    results.variants.forEach((v, j) => { const value = v.countHistogram[count] || 0, h = value / max * 160; body += `<rect x="${left + count * group + j * group / 3 + 1}" y="${bottom - h}" width="${Math.max(1, group / 3 - 2)}" height="${h}" rx="2" fill="${colors[v.variant]}"><title>${names[v.variant]}: ${count}경기 출전한 사람 평균 ${fmt(value)}명</title></rect>`; });
    body += `<text x="${left + (count + .5) * group}" y="209" text-anchor="middle">${count}</text>`;
  }
  body += `<text x="${right}" y="234" text-anchor="end">한 사람의 출전 횟수</text>`;
  return chart('개인 출전 횟수 분포', body, width, 240, '같은 출전 횟수 부근에 모일수록 경기 수 차이가 작습니다. 세로축은 반복 실행 평균 인원입니다.');
}

function renderSummary() {
  const current = results.variants[0].mean;
  $('cards').innerHTML = results.variants.map((v, index) => {
    const diff = v.mean.peers - current.peers;
    return `<article class="result-card" style="--variant:${colors[v.variant]}"><div class="variant-title"><span class="number">0${index + 1}</span><h2>${names[v.variant]}</h2></div><p class="card-caption">${[results.config.selectionPolicy === 'legacy-wait' ? '기존 추천 함수 · 대기자만' : '기존 추천 함수 · 경기 중 후보 최대 3명', '허용 구성·출전 균형 안에서 중복 최소화', results.config.skillPolicy === 'exchange' ? '가까운 실력 선호 + 개인별 교류 보정' : '이전 방식 · 가까운 실력만 선호'][index]}</p><div class="primary-metric"><strong>${fmt(v.mean.peers)}</strong><span>/ ${roster.length - 1}명</span></div><p class="primary-label">한 사람당 만난 서로 다른 사람</p><p class="delta">${index ? `변경 전 대비 ${diff >= 0 ? '+' : ''}${fmt(diff)}명` : '세 방식의 비교 기준'}</p><dl><div><dt>두 경기 간 2명 이상 겹침</dt><dd>${fmt(v.mean.repeatRate)}%</dd></div><div><dt>네 명의 평균 실력 범위</dt><dd>${fmt(v.mean.spread, 2)}등급</dd></div><div><dt>상·하위 동반 관계 달성</dt><dd>${fmt(v.mean.extremeCoverage)}%</dd></div></dl></article>`;
  }).join('');
  const { games, courts, runs, seed } = results.config;
  $('result-meta').textContent = `${roster.length}명 · ${games}경기 × ${runs}회 반복 · ${courts}코트 · ${results.config.selectionPolicy === 'legacy-wait' ? `이전 시뮬 / 대기 상한 ${results.config.courtWaitSeconds ?? 0}초` : results.config.selectionPolicy === 'score-first' ? '대기 우선 해제 (대조 실험)' : '대기자 우선 정책'} · 늦참 ${results.config.lateCount ?? 0}명 (${results.config.lateCorrection === false ? '보정 없음' : '평균 보정'}) · 시드 ${seed}~${seed + runs - 1} · ③ ${results.config.skillPolicy === 'exchange' ? `교류 보정 / 간격 기준 ${results.config.exchangeInterval}경기` : '이전 실력 방식'}`;
  const s = results.variants[2].mean;
  $('insight').innerHTML = `<strong>대기자가 있는데도 기다렸나</strong><span>출전 가능한 팀이 있는데 경기 중인 사람을 포함한 후보: ① <b>${fmt(current.avoidablePlayingProposals)}회</b> → ③ <b>${fmt(s.avoidablePlayingProposals)}회</b>. 시작할 수 있었던 코트의 공백은 ① ${fmt(current.avoidableIdleMinutes)}분 → ③ ${fmt(s.avoidableIdleMinutes)}분이야. 아래 차트에서 만남 다양성도 함께 확인해.</span>`;
  $('isolation-note').textContent = `상·하위 ${roster.filter(p => skillBand(p.grade) !== 1).length}명 중 반대 실력대를 한 번도 못 만난 사람: ${results.variants.map(v => `${names[v.variant]} ${fmt(v.mean.isolatedExtreme)}명`).join(' · ')}. 반복 실행 평균이며 미출전자도 포함해.`;
  const bandCounts = [0, 1, 2].map(b => roster.filter(p => skillBand(p.grade) === b).length);
  $('band-note').textContent = `분석용 구간: 하위 1~3등급 ${bandCounts[0]}명 · 중위 4~6등급 ${bandCounts[1]}명 · 상위 7~10등급 ${bandCounts[2]}명. 상·하위 ${bandCounts[0] * bandCounts[2]}쌍 중 만난 비율이야.`;
  $('scenario-note').textContent = roster.length === 30 ? '기록된 30명 전체 명단으로 실행한 결과야.' : `기록된 30명 중 실력 분포에 걸쳐 고정 선택한 ${roster.length}명의 가정 실험이야. 실제 ${roster.length}명 모임 기록은 아니야.`;
  $('court-summary').innerHTML = results.variants.map(v => `<div style="--variant:${colors[v.variant]}"><b>${names[v.variant]}</b><strong>${fmt(v.mean.courtUtilization)}<small>% 가동</small></strong><span>최장 공백 평균 ${fmt(v.mean.maxCourtGap)}초<br>동일 네 명 연속 재경기 ${fmt(v.mean.immediateRematchRate)}%</span></div>`).join('');
  $('court-insight').textContent = `③에서 평균 공백 ${fmt(s.meanCourtGap)}초 · 한 사람당 ${fmt(s.peers)}명과 만남. 가동률은 마지막 경기 시작까지 계산하며 마지막 정리 시간은 제외해. 휴식·이동·사람을 부르는 시간은 모형에 포함하지 않았어.`;
  const sample = results.variants[2].sample, latePeople = sample.arrivals.flatMap((minute, id) => minute > 0 ? [`${roster[id].name} (${minute}분)`] : []);
  $('late-note').textContent = latePeople.length ? `가정한 늦참자: ${latePeople.join(' · ')}. 시드 ${results.config.seed}의 관찰 구간 ${fmt(sample.lateWindowMinutes)}분. 회색은 기존 참가자, 각 알고리즘 색상은 늦참자야. 실제 출전은 0부터 세고, 추천용 보정값만 별도로 더해.` : '늦참 보정은 합류 당시 참가 중인 사람들의 평균 판수에서 시작해. 대기 시간도 실제 합류부터 세어.';
  $('metric-table').innerHTML = `<table><caption>반복 실행 평균 · 괄호는 5~95백분위</caption><thead><tr><th>지표</th>${variants.map(v => `<th>${names[v]}</th>`).join('')}</tr></thead><tbody>${([
    ['playingProposals', '경기 중 포함 후보 (회)'], ['avoidablePlayingProposals', '대기팀 가능한데 경기 중 포함 (회)'], ['avoidableIdleMinutes', '시작 가능했던 코트 공백 합 (분)'], ['repeatRate', '2명 이상 겹침 (%)'], ['tripleRate', '3명 이상 겹침 (%)'], ['coverage', '전체 동반 관계 달성 (%)'], ['peers', '평균 고유 동반 인원'], ['spread', '평균 실력 범위'], ['gameStd', '출전 표준편차'], ['maxWait', '최대 대기 (분)'], ['freshRate', '6개 동반 쌍 모두 첫 만남인 경기 (%)'],
    ['lowerMiddleCoverage', '하위·중위 동반 관계 달성 (%)'], ['middleUpperCoverage', '중위·상위 동반 관계 달성 (%)'], ['extremeCoverage', '하위·상위 동반 관계 달성 (%)'], ['isolatedExtreme', '반대 실력대 미동반 상·하위 인원'], ['maxExtremeGap', '반대 실력대 미교류 최장 연속 출전'],
    ['courtUtilization', '편성 구간 코트 가동률 (%)'], ['meanCourtGap', '경기 사이 평균 코트 공백 (초)'], ['maxCourtGap', '가장 긴 코트 공백 (초)'], ['courtIdleMinutes', '코트별 공백 합계 (분)'], ['immediateRematchRate', '동일 네 명의 연속 재경기 (%)'], ['elapsedMinutes', '전체 완료까지 경과 (분)'],
    ['invalidCompositionRate', '요청한 성별 구성 밖의 경기 (%)'], ['earlyPostRate', '합류 후 기존 참가자 1인당 출전 (회/시간)'], ['latePostRate', '합류 후 늦참자 1인당 출전 (회/시간)'],
  ] as const).map(([key, label]) => `<tr><th>${label}</th>${results.variants.map(v => `<td>${fmt(v.mean[key], 2)} <small>(${fmt(v.p05[key], 2)}~${fmt(v.p95[key], 2)})</small></td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderPeople() {
  const selected = roster[person];
  $('person-meta').textContent = `시드 ${results.config.seed}의 한 실행 · ${selected.name} 기준 · 합류 ${results.variants[0].sample.arrivals[person]}분 · 같은 편 / 상대편 구분 없음`;
  const counts = results.variants.map(v => v.sample.pairs[person]);
  const exchangeLabel = skillBand(selected.grade) === 1 ? '다른 실력대' : '반대 실력대';
  $('person-summary').innerHTML = results.variants.map((v, i) => `<span style="--variant:${colors[v.variant]}"><b>${names[v.variant]}</b> 실제 ${v.sample.counts[person]}경기 · 추천용 보정 +${v.sample.baselines[person]} · ${counts[i].filter(x => x > 0).length}명과 만남 · ${counts[i].filter((x, j) => j !== person && x === 0).length}명 미동반<br>${exchangeLabel} 동반 ${v.sample.exchange.games[person]}경기 · 최장 미교류 ${v.sample.exchange.maxGaps[person]}경기</span>`).join('');
  const max = Math.max(1, ...counts.flat());
  const otherIds = roster.map((_, i) => i).filter(i => i !== person).sort((a, b) => roster[a].name.localeCompare(roster[b].name, 'ko'));
  $('people-bars').innerHTML = otherIds.map(id => `<div class="person-row"><div class="person-name">${escape(roster[id].name)}</div><div class="person-values">${results.variants.map((v, i) => `<div class="person-bar" aria-label="${escape(roster[id].name)}와 ${names[v.variant]} ${counts[i][id]}회"><span class="bar-track"><span style="width:${counts[i][id] / max * 100}%;background:${colors[v.variant]}"></span></span><b style="color:${colors[v.variant]}">${counts[i][id]}<small>회</small></b></div>`).join('')}</div></div>`).join('');
}
function renderMatches() {
  const run = results.variants.find(v => v.variant === matchVariant)!.sample;
  $('matches').innerHTML = run.matches.map((m, i) => `<li><span class="match-index">${i + 1}</span><div><strong>${m.ids.map(id => escape(roster[id].name)).join(' · ')}</strong><small>${m.court}코트 · ${fmt(m.start / 60000)}분에 시작 · ${COMPOSITION_LABELS[compositionOf(m.ids.map(id => roster[id]))]} · 실력 범위 ${m.spread}등급</small></div><span class="overlap-badge ${m.priorOverlap >= 3 ? 'high' : ''}">기존 경기와 최대 ${m.priorOverlap}명 공통</span></li>`).join('');
}
function renderCharts() {
  $('coverage-chart').innerHTML = coverageChart(); $('overlap-chart').innerHTML = overlapChart();
  $('skill-chart').innerHTML = metricBars('spread', ''); $('fairness-chart').innerHTML = metricBars('gameStd', '');
  $('histogram-chart').innerHTML = histogramChart();
  $('cross-band-chart').innerHTML = crossBandChart(); $('exchange-gap-chart').innerHTML = metricBars('maxExtremeGap', '');
  $('busy-choice-chart').innerHTML = metricBars('avoidablePlayingProposals', ''); $('avoidable-idle-chart').innerHTML = metricBars('avoidableIdleMinutes', '');
  $('court-gap-chart').innerHTML = metricBars('meanCourtGap', ''); $('court-timeline-chart').innerHTML = courtTimeline();
  $('composition-chart').innerHTML = compositionChart(); $('late-chart').innerHTML = lateChart();
  $<HTMLButtonElement>('late-export').disabled = !$('late-chart').querySelector('svg');
}
function render() {
  renderSummary(); renderCharts();
  $('sample-label').textContent = `아래 상세는 시드 ${results.config.seed} 한 실행의 결과야. 위 차트는 ${results.config.runs}회 평균이야.`;
  renderPeople(); renderMatches();
}

function readConfig(): Config {
  return { games: Number($<HTMLInputElement>('games').value), courts: Number($<HTMLSelectElement>('courts').value),
    runs: Number($<HTMLSelectElement>('runs').value), seed: Number($<HTMLInputElement>('seed').value), skillWeight: Number($<HTMLInputElement>('skill-weight').value),
    selectionPolicy: $<HTMLSelectElement>('selection-policy').value as Config['selectionPolicy'], skillPolicy: $<HTMLSelectElement>('skill-policy').value as Config['skillPolicy'], exchangeInterval: Number($<HTMLInputElement>('exchange-interval').value), courtWaitSeconds: Number($<HTMLSelectElement>('court-wait').value),
    lateCount: Number($<HTMLSelectElement>('late-count').value), lateMinutes: Number($<HTMLInputElement>('late-minutes').value), lateCorrection: $<HTMLSelectElement>('late-correction').value === 'true' };
}
function stop() { worker?.terminate(); worker = null; if (workerURL) URL.revokeObjectURL(workerURL); workerURL = ''; $('run-button').removeAttribute('disabled'); $('cancel-button').hidden = true; $('progress').hidden = true; }
function run(event: SubmitEvent) {
  event.preventDefault(); stop();
  $('status').classList.remove('error'); $('status').textContent = '같은 조건으로 세 알고리즘을 비교하고 있어…';
  $('run-button').setAttribute('disabled', ''); $('cancel-button').hidden = false; $('progress').hidden = false;
  $<HTMLProgressElement>('progress').value = 0;
  try {
    workerURL = URL.createObjectURL(new Blob([__WORKER_SOURCE__], { type: 'text/javascript' }));
    worker = new Worker(workerURL);
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { $<HTMLProgressElement>('progress').value = data.done / data.total; $('status').textContent = `${data.done} / ${data.total}회 계산 중 · 아래에는 이전 결과 표시`; }
      if (data.type === 'result') { results = data.result; roster = results.roster; updatePeopleOptions(); render(); stop(); $('status').textContent = '비교 완료 · 아래 차트에 새 조건을 반영했어.'; document.body.dataset.ready = 'true'; }
      if (data.type === 'error') { stop(); $('status').textContent = data.message; $('status').classList.add('error'); }
    };
    worker.onerror = () => { stop(); $('status').textContent = '계산을 시작하지 못했어. HTML 파일을 Chrome 또는 Edge에서 열어 다시 실행해 줘.'; $('status').classList.add('error'); };
    worker.postMessage({ roster: selectRoster(source.players, Number($<HTMLSelectElement>('participants').value)), config: readConfig() });
  } catch { stop(); $('status').textContent = '이 브라우저에서 계산 기능을 열지 못했어. 기본 비교 결과는 아래에서 볼 수 있어.'; $('status').classList.add('error'); }
}

const date = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(source.session.scheduled_at));
const women = source.players.filter(p => p.gender === 'F').length;
$('source-note').textContent = `${date} · 실제 출전자 30명 (남 ${30 - women} / 여 ${women}) · ${source.session.court_count}코트 · 완료 ${source.actualCompletedGames}경기`;
$('fetched-at').textContent = new Date(source.fetchedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
document.querySelectorAll('.legend:not(.severity)').forEach(el => el.innerHTML = legend());
for (const [id, value] of Object.entries({ games: results.config.games, courts: results.config.courts, runs: results.config.runs, seed: results.config.seed, 'skill-weight': results.config.skillWeight, 'skill-policy': results.config.skillPolicy, 'exchange-interval': results.config.exchangeInterval, participants: roster.length, 'selection-policy': results.config.selectionPolicy ?? 'ready-first', 'court-wait': results.config.courtWaitSeconds ?? 0, 'late-count': results.config.lateCount ?? 0, 'late-minutes': results.config.lateMinutes ?? 30, 'late-correction': results.config.lateCorrection !== false })) $<HTMLInputElement>(id).value = String(value);
function updateSelectionControls() { $<HTMLSelectElement>('court-wait').disabled = $<HTMLSelectElement>('selection-policy').value !== 'legacy-wait'; }
$('selection-policy').addEventListener('change', updateSelectionControls); updateSelectionControls();
function updateLateControls() { for (const id of ['late-minutes', 'late-correction']) $<HTMLInputElement>(id).disabled = $<HTMLSelectElement>('late-count').value === '0'; }
$('late-count').addEventListener('change', updateLateControls); updateLateControls();
function updateSkillControls() { $<HTMLInputElement>('exchange-interval').disabled = $<HTMLSelectElement>('skill-policy').value === 'nearby'; }
$('skill-policy').addEventListener('change', updateSkillControls); updateSkillControls();
function updateCourtOptions() {
  const maximum = Math.floor(Number($<HTMLSelectElement>('participants').value) / 4);
  for (const option of Array.from($<HTMLSelectElement>('courts').options)) option.disabled = Number(option.value) > maximum;
  if (Number($<HTMLSelectElement>('courts').value) > maximum) $<HTMLSelectElement>('courts').value = String(maximum);
}
$('participants').addEventListener('change', updateCourtOptions); updateCourtOptions();
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.addEventListener('click', () => {
  const full = button.dataset.preset === 'full';
  $<HTMLSelectElement>('participants').value = full ? '16' : '30';
  updateCourtOptions();
  $<HTMLSelectElement>('courts').value = full ? '4' : '5';
  $<HTMLInputElement>('games').value = full ? '32' : '55';
  $<HTMLFormElement>('controls').requestSubmit();
}));
$('timeline-window').addEventListener('change', () => $('court-timeline-chart').innerHTML = courtTimeline());
let resizeFrame = 0;
window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(renderCharts); });
function updatePeopleOptions() {
  const selectedId = $<HTMLSelectElement>('person').selectedOptions[0]?.dataset.playerId;
  $<HTMLSelectElement>('person').innerHTML = roster.map((p, i) => ({ ...p, index: i })).sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(p => `<option value="${p.index}" data-player-id="${escape(p.id)}">${escape(p.name)}</option>`).join('');
  const preserved = roster.findIndex(p => p.id === selectedId);
  if (preserved >= 0) $<HTMLSelectElement>('person').value = String(preserved);
  person = Number($<HTMLSelectElement>('person').value);
}
updatePeopleOptions();
$('person').addEventListener('change', () => { person = Number($<HTMLSelectElement>('person').value); renderPeople(); });
$('match-variant').addEventListener('change', () => { matchVariant = $<HTMLSelectElement>('match-variant').value as Variant; renderMatches(); });
$('controls').addEventListener('submit', event => run(event as SubmitEvent));
$('cancel-button').addEventListener('click', () => { stop(); $('status').textContent = '계산을 중지했어. 이전 비교 결과를 유지하고 있어.'; });
document.querySelectorAll<HTMLButtonElement>('[data-export]').forEach(button => button.addEventListener('click', () => {
  const svg = $(button.dataset.export!).querySelector('svg'); if (!svg) return;
  const url = URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `팀편성-${button.dataset.export}.svg`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}));
render(); document.body.dataset.ready = 'true';
