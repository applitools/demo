/*
 * Standalone test for the SDK Debug Analysis panel. No test framework required:
 *   node logs/sdk-debug-analysis.test.mjs
 *
 * Uses a SYNTHETIC fixture that reproduces the FLD-4750 structure (lazyLoad object in the
 * check settings, a multi-minute poll stall, an abort with an error + stack) — deliberately
 * contains no customer identifiers.
 */
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { analyzeLog, renderReport } = require(path.join(here, 'sdk-debug-analysis.js'));

// ---------- build synthetic log ----------
const BASE = Date.parse('2026-01-01T00:00:00.000Z');
const iso = (ms) => new Date(BASE + ms).toISOString();
const CTX = 'manager-classic-z28/eyes-classic-t45/check-classic-oau';
const lines = [];
const push = (label, ctx, ms, level, msg) =>
  lines.push(`${label} (${ctx}) | ${iso(ms)} [${level}] ${msg}`);

push('core', 'manager-classic-z28', 0, 'INFO ', "Command \"makeManager\" is called with settings {");
lines.push('  agentId: \'eyes.playwright/1.47.8\'');
lines.push('}');
push('core-classic', 'manager-classic-z28/eyes-classic-t45', 1000, 'INFO ', "Command \"openEyes\" is called with settings {}");
push('core-classic', CTX, 2000, 'INFO ', "Command \"check\" is called with settings {");
lines.push('  stitchMode: \'CSS\',');
lines.push('  fully: true,');
lines.push('  matchTimeout: 0,');
lines.push('  matchLevel: \'Strict\',');
lines.push('  lazyLoad: { scrollLength: 300, waitingTime: 2000, maxAmountToScroll: 15000 },');
lines.push('  waitBeforeCapture: 2500,');
lines.push('  waitBetweenStitches: 2000');
lines.push('}');
push('core-classic', CTX, 2100, 'INFO ', 'Running scrolling sequence to lazy load a view content');
push('driver', CTX, 2150, 'INFO ', 'Executing poll script');

// 5-minute poll stall: Polling every 2s, heartbeat every 10s
let pollCount = 0;
for (let t = 2200; t <= 302200; t += 2000) {
  push('driver', CTX, t, 'INFO ', 'Polling...');
  pollCount++;
  if ((t - 2200) % 10000 === 0) {
    push('core-requests', 'manager-classic-z28/heartbeat-base-cdu/core-request-lw8', t + 50, 'INFO ',
      'Request "heartbeat" [0--x] will be sent to the address "[POST]https://server/api/sessions/sdkprocess/keepalive" with body {}');
  }
}

// abort with error + stack
push('core-classic', 'manager-classic-z28/eyes-classic-t45/abort-gmf', 303000, 'INFO ', "Command \"abort\" is called with settings {}");
push('driver', CTX, 303010, 'WARN ', 'Error during script execution with argument undefined');
push('driver', CTX, 303011, 'ERROR', 'frame.evaluateHandle: ReferenceError: metadata is not defined');
lines.push('    at anonymous (eval at evaluate (:303:30), <anonymous>:3:12)');
lines.push('    at Object.getSessionMetadata (driver.js:529:30)');
push('core-classic', 'manager-classic-z28/eyes-classic-t45/get-eyes-results-4ix', 303100, 'INFO ', "Command \"getResults\" is called with settings {}");

const log = lines.join('\n');

// ---------- run + assert ----------
const report = analyzeLog(log);
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

console.log('SDK Debug Analysis — synthetic FLD-4750 fixture');

check('lazyLoad is parsed as an OBJECT (the core bug fix)', () => {
  const ll = report.summary.checkSettings.lazyLoad;
  assert.strictEqual(typeof ll, 'object');
  assert.strictEqual(ll.scrollLength, 300);
  assert.strictEqual(ll.waitingTime, 2000);
  assert.strictEqual(ll.maxAmountToScroll, 15000);
});

check('the OLD regex would have missed it (documents the bug)', () => {
  const line = '  lazyLoad: { scrollLength: 300, waitingTime: 2000, maxAmountToScroll: 15000 },';
  assert.strictEqual(/lazyLoad:\s*(true|false|undefined)/.test(line), false);
});

check('other check settings parsed', () => {
  const cs = report.summary.checkSettings;
  assert.strictEqual(cs.fully, true);
  assert.strictEqual(cs.matchTimeout, 0);
  assert.strictEqual(cs.waitBeforeCapture, 2500);
  assert.strictEqual(cs.stitchMode, 'CSS');
  assert.strictEqual(cs.matchLevel, 'Strict');
});

check('runner detected as Classic', () => {
  assert.strictEqual(report.summary.runner, 'Classic');
});

check('agent id extracted', () => {
  assert.strictEqual(report.summary.agentId, 'eyes.playwright/1.47.8');
});

check('final status is Aborted', () => {
  assert.strictEqual(report.summary.aborted, true);
  assert.strictEqual(report.summary.finalStatus, 'Aborted');
});

check('long silent stall detected (~5 minutes)', () => {
  assert.ok(report.stalls.length >= 1, 'expected at least one stall');
  const top = report.stalls[0];
  assert.ok(top.durationMs >= 4 * 60 * 1000, 'stall should be ~5 min, got ' + top.durationMs);
  assert.ok(top.pollCount > 100, 'stall should contain many polls, got ' + top.pollCount);
  assert.ok(top.heartbeatCount > 0, 'stall should contain heartbeats');
});

check('executePoll op summarised as lazyLoad scroll poll that did not complete', () => {
  const lazy = report.pollOps.find((p) => p.label === 'lazyLoad scroll poll');
  assert.ok(lazy, 'expected a lazyLoad scroll poll op');
  assert.ok(lazy.iterations >= 140, 'expected ~150 iterations, got ' + lazy.iterations);
  assert.match(lazy.outcome, /did not complete/);
});

check('abort surfaced with preceding event and the error', () => {
  assert.strictEqual(report.aborts.length >= 1, true);
  const ab = report.aborts[0];
  assert.ok(ab.before, 'expected a preceding event');
  assert.ok(ab.error, 'expected an error');
  assert.strictEqual(ab.error.level, 'ERROR');
  assert.match(ab.error.message, /ReferenceError: metadata is not defined/);
});

check('phase timeline flags the longest phase around the stall', () => {
  assert.ok(report.longestPhase, 'expected a longest phase');
  assert.ok(report.longestPhase.durationMs >= 4 * 60 * 1000, 'longest phase should be ~5 min');
});

check('noise is collapsed in the event stream', () => {
  const noiseRuns = report.stream.filter((x) => x.kind === 'noise');
  assert.ok(noiseRuns.length >= 1, 'expected collapsed noise runs');
  const totalPolls = noiseRuns.reduce((n, r) => n + r.polls, 0);
  assert.strictEqual(totalPolls, pollCount);
});

check('rendered HTML shows correct Lazy Load and the stall (not "Not Set")', () => {
  const html = renderReport(report);
  assert.match(html, /Enabled — scrollLength 300/);
  assert.match(html, /silent stall/);
  assert.match(html, /lazyLoad scroll poll/);
  // the Lazy Load card must not read "Not Set"
  assert.doesNotMatch(html, /Lazy Load<\/div><div class="v sda-muted">Not Set/);
});

console.log(`\nAll ${passed} checks passed.`);
