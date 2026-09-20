import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const out = resolve('reports/team-simulator-20260916');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
const errors = [], external = [], failed = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('request', r => { if (/^https?:/.test(r.url())) external.push(r.url()); });
page.on('requestfailed', r => failed.push(r.url()));
await page.goto(pathToFileURL(`${out}/index.html`).href);
await page.waitForSelector('body[data-ready="true"]');
assert.equal(await page.locator('.result-card').count(), 3);
assert.equal(await page.locator('#person option').count(), 30);
assert.equal(await page.locator('.person-row').count(), 29);
assert.equal(await page.locator('.chart svg').count(), 12);
const result = JSON.parse(readFileSync(`${out}/results.json`, 'utf8'));
const cardValues = await page.locator('.primary-metric strong').allTextContents();
assert.deepEqual(cardValues, result.variants.map(v => v.mean.peers.toFixed(1)));

async function lint(label) {
  const report = await page.evaluate(() => {
    const issues = [];
    const rgb = s => s.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [255, 255, 255];
    const lum = rgb => rgb.map(x => { x /= 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
    for (const el of document.querySelectorAll('button,input,select')) {
      if (!el.getClientRects().length) continue;
      const box = el.getBoundingClientRect();
      if (box.height < 43.9) issues.push(`small target: ${el.id || el.textContent}`);
      if (!(el.getAttribute('aria-label') || el.textContent.trim() || el.closest('label'))) issues.push(`missing label: ${el.id}`);
    }
    for (const el of document.querySelectorAll('h1,h2,h3,p,dt,dd,label,.legend-item,.source-note,.chart-note,.person-name')) {
      if (!el.getClientRects().length) continue;
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) issues.push(`text overflow: ${el.textContent.slice(0, 40)}`);
      let ancestor = el, background = 'rgb(244,246,249)';
      while (ancestor) { const c = getComputedStyle(ancestor).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { background = c; break; } ancestor = ancestor.parentElement; }
      const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(background));
      const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      if (ratio < 4.5) issues.push(`contrast ${ratio.toFixed(2)}: ${el.textContent.slice(0, 40)}`);
    }
    for (const svg of document.querySelectorAll('.chart svg')) {
      const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      for (const text of svg.querySelectorAll('text')) if (parseFloat(getComputedStyle(text).fontSize) * scale < 11) issues.push('tiny chart text');
    }
    return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, issues };
  });
  assert.ok(report.documentWidth <= report.viewport, `${label}: page overflow`);
  assert.deepEqual(report.issues, [], label);
  return report;
}
const desktop = await lint('desktop');
await page.screenshot({ path: `${out}/overview-desktop.png` });
await page.screenshot({ path: `${out}/desktop.png`, fullPage: true });
mkdirSync(`${out}/charts`, { recursive: true });
for (const id of ['busy-choice-chart', 'avoidable-idle-chart', 'court-gap-chart', 'court-timeline-chart', 'coverage-chart', 'overlap-chart', 'cross-band-chart', 'exchange-gap-chart', 'skill-chart', 'fairness-chart', 'histogram-chart', 'composition-chart']) {
  writeFileSync(`${out}/charts/${id}.svg`, await page.locator(`#${id} svg`).evaluate(svg => svg.outerHTML));
}
await page.locator('.chart-grid').last().scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/charts-desktop.png` });
await page.locator('#cross-band-chart').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/exchange-desktop.png` });
await page.locator('#person').selectOption({ index: 12 });
assert.equal(await page.locator('.person-bar').count(), 87);
await page.locator('.people-section').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/people-desktop.png` });

// Browser worker must compute new results offline, not merely swap precomputed labels.
assert.equal(await page.locator('#court-wait').isDisabled(), true);
const availability = JSON.parse(readFileSync(`${out}/availability-results.json`, 'utf8'));
await page.locator('.availability-section').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/availability-desktop.png` });
await page.locator('#selection-policy').selectOption('score-first');
await page.locator('#run-button').click();
await page.waitForFunction(() => document.getElementById('status').textContent.includes('비교 완료'));
assert.deepEqual(await page.locator('.primary-metric strong').allTextContents(), availability.scoreFirst.variants.map(v => v.mean.peers.toFixed(1)));
assert.ok((await page.locator('#busy-choice-chart').textContent()).includes(availability.scoreFirst.variants[2].mean.avoidablePlayingProposals.toFixed(2)));
await page.locator('#selection-policy').selectOption('ready-first');
const capacity = JSON.parse(readFileSync(`${out}/capacity-results.json`, 'utf8'));
await page.locator('[data-preset="full"]').click();
await page.waitForFunction(() => document.getElementById('status').textContent.includes('비교 완료'));
assert.equal(await page.locator('#person option').count(), 16);
assert.equal(await page.locator('.person-row').count(), 15);
assert.equal(await page.locator('#courts option:disabled').count(), 3);
assert.ok((await page.locator('#scenario-note').textContent()).includes('가정 실험'));
assert.deepEqual(await page.locator('.primary-metric strong').allTextContents(), capacity.ready.variants.map(v => v.mean.peers.toFixed(1)));
assert.ok((await page.locator('#court-summary').textContent()).includes(capacity.ready.variants[2].mean.courtUtilization.toFixed(1)));
await lint('capacity desktop');
await page.locator('.court-section').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/capacity-desktop.png` });
await page.locator('#timeline-window').selectOption('0');
assert.equal(await page.locator('#court-timeline-chart svg').count(), 1);
await page.locator('#selection-policy').selectOption('legacy-wait');
assert.equal(await page.locator('#court-wait').isDisabled(), false);
await page.locator('#run-button').click();
await page.waitForFunction(() => document.getElementById('status').textContent.includes('비교 완료'));
assert.deepEqual(await page.locator('.primary-metric strong').allTextContents(), capacity.bounded.variants.map(v => v.mean.peers.toFixed(1)));
await page.locator('#court-wait').selectOption('0');
await page.locator('#run-button').click();
await page.waitForFunction(() => document.getElementById('status').textContent.includes('비교 완료'));
assert.deepEqual(await page.locator('.primary-metric strong').allTextContents(), ['3.0', '3.0', '3.0']);
assert.ok((await page.locator('#court-summary').textContent()).includes('100.0'));
await page.locator('#court-wait').selectOption('60');
await page.locator('#selection-policy').selectOption('ready-first');
await page.locator('[data-preset="source"]').click();
await page.waitForFunction(() => document.getElementById('status').textContent.includes('비교 완료'));
assert.equal(await page.locator('#person option').count(), 30);
assert.equal(await page.locator('.person-row').count(), 29);
const late = JSON.parse(readFileSync(`${out}/late-results.json`, 'utf8'));
await page.locator('#late-count').selectOption('4');
assert.equal(await page.locator('#late-minutes').isDisabled(), false);
await page.locator('#run-button').click();
await page.waitForFunction(() => document.getElementById('status').textContent.includes('비교 완료'));
assert.deepEqual(await page.locator('.primary-metric strong').allTextContents(), late.corrected.variants.map(v => v.mean.peers.toFixed(1)));
assert.equal(await page.locator('.chart svg').count(), 13);
assert.ok((await page.locator('#late-chart').textContent()).includes(late.corrected.variants[2].mean.latePostRate.toFixed(1)));
await lint('late arrivals desktop');
await page.locator('.rules-charts').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/rules-desktop.png` });
for (const id of ['composition-chart', 'late-chart']) writeFileSync(`${out}/charts/late-scenario-${id}.svg`, await page.locator(`#${id} svg`).evaluate(svg => svg.outerHTML));
await page.locator('#late-correction').selectOption('false');
await page.locator('#run-button').click();
await page.waitForFunction(() => document.getElementById('status').textContent.includes('비교 완료'));
assert.deepEqual(await page.locator('.primary-metric strong').allTextContents(), late.uncorrected.variants.map(v => v.mean.peers.toFixed(1)));
await page.locator('#late-correction').selectOption('true');
await page.locator('#late-count').selectOption('0');
assert.equal(await page.locator('#late-minutes').isDisabled(), true);
await page.locator('#skill-policy').selectOption('nearby');
assert.equal(await page.locator('#exchange-interval').isDisabled(), true);
await page.locator('#run-button').click();
await page.waitForFunction(() => document.getElementById('status').textContent.includes('비교 완료'));
const nearby = JSON.parse(readFileSync(`${out}/nearby-results.json`, 'utf8'));
assert.deepEqual(await page.locator('.primary-metric strong').allTextContents(), nearby.variants.map(v => v.mean.peers.toFixed(1)));
assert.ok((await page.locator('#cross-band-chart').textContent()).includes(nearby.variants[2].mean.extremeCoverage.toFixed(1) + '%'));
assert.ok((await page.locator('#result-meta').textContent()).includes('이전 실력 방식'));
await page.locator('#skill-policy').selectOption('exchange');
assert.equal(await page.locator('#exchange-interval').isDisabled(), false);
await page.locator('#exchange-interval').fill('1');
await page.locator('#games').fill('18');
await page.locator('#runs').selectOption('1');
await page.locator('#seed').fill('17');
await page.locator('#skill-weight').fill('0');
await page.locator('#run-button').click();
await page.waitForFunction(() => document.getElementById('status').textContent.includes('비교 완료'));
assert.ok((await page.locator('#result-meta').textContent()).includes('18경기 × 1회'));
assert.ok((await page.locator('#result-meta').textContent()).includes('간격 기준 1경기'));
const values = await page.locator('.primary-metric strong').allTextContents();
assert.equal(values[1], values[2]);
const detailValues = await page.locator('.person-bar b').allTextContents();
for (let i = 0; i < 29; i++) assert.equal(detailValues[i * 3 + 1], detailValues[i * 3 + 2]);
await page.getByText('선택 시드의 경기별 네 명 보기', { exact: true }).click();
assert.equal(await page.locator('#matches li').count(), 18);
await page.locator('#match-variant').selectOption('skill');
assert.equal(await page.locator('#matches li').count(), 18);
const download = page.waitForEvent('download');
await page.locator('[data-export="coverage-chart"]').click();
const saved = await download;
assert.ok(saved.suggestedFilename().endsWith('.svg'));
await saved.saveAs(`${out}/coverage-export.svg`);

const mobileReports = [];
for (const width of [390, 320, 768]) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(pathToFileURL(`${out}/index.html`).href);
  await page.waitForSelector('body[data-ready="true"]');
  mobileReports.push(await lint(String(width)));
  if (width === 390) {
    await page.screenshot({ path: `${out}/overview-mobile.png` });
    await page.screenshot({ path: `${out}/mobile.png`, fullPage: true });
    await page.locator('.availability-section').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/availability-mobile.png` });
    await page.locator('.chart-grid').last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/charts-mobile.png` });
    await page.locator('#cross-band-chart').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/exchange-mobile.png` });
    await page.locator('.people-section').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/people-mobile.png` });
    await page.locator('[data-preset="full"]').click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('비교 완료'));
    mobileReports.push(await lint('capacity mobile'));
    await page.locator('.court-section').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/capacity-mobile.png` });
    await page.locator('#late-count').selectOption('4');
    await page.locator('[data-preset="source"]').click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('비교 완료'));
    mobileReports.push(await lint('late arrivals mobile'));
    await page.locator('.rules-charts').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/rules-mobile.png` });
  }
}
assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(failed, []);
const report = { desktop, mobile: mobileReports, errors, external, failed, checks: ['offline worker rerun', 'nearby policy reproduces saved results', 'exchange policy and interval controls', 'zero skill = diversity', '30-player and 16-player presets', 'court limits follow participant count', 'zero court wait repeats four fixed groups at full capacity', 'one-minute wait matches saved capacity results', '29/15 peer rows', '12 default / 13 late-arrival SVG charts', 'availability priority and score-only control', 'avoidable busy proposals and idle charts', 'legacy waiting mode reproduces prior results', 'late arrival correction on/off matches saved simulations', 'composition chart', 'timeline range selection', 'SVG export', 'match list', 'responsive widths 320/390/768/1440', 'contrast/labels/chart font sizes'] };
writeFileSync(`${out}/browser-qa.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
