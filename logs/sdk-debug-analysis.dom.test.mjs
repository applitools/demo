/*
 * DOM-integration test for the SDK Debug Analysis panel — exercises the real browser code path
 * (file-input change -> FileReader -> render into #sda-root) using a minimal dependency-free fake
 * DOM. Verifies the user-observable behavior: loading a log renders the diagnosis panel.
 *
 *   node logs/sdk-debug-analysis.dom.test.mjs
 */
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ---- minimal fake DOM (set up before loading the module) ----
function makeEl() {
  return {
    _html: '',
    id: '',
    style: {},
    listeners: {},
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    dispatch(type, ev) { (this.listeners[type] || []).forEach((fn) => fn(ev)); },
    querySelector() { return null; },       // skip noise-toggle wiring in this harness
    querySelectorAll() { return []; },
    insertBefore(node) { return node; },
    get firstChild() { return null; },
  };
}
const els = {
  'file-input': makeEl(),
  'drop-area': makeEl(),
  'sda-root': makeEl(),
};
globalThis.document = {
  readyState: 'complete',
  getElementById: (id) => els[id] || null,
  querySelector: (sel) => (sel === 'main' ? makeEl() : null),
  createElement: () => makeEl(),
  body: makeEl(),
  addEventListener() {},
};
globalThis.FileReader = class {
  readAsText(text) { this.result = text; if (this.onload) this.onload(); }
};

// ---- load the module (auto-wires against the fake DOM) ----
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
require(path.join(here, 'sdk-debug-analysis.js'));

// ---- build a small FLD-4750-shaped log ----
const BASE = Date.parse('2026-01-01T00:00:00.000Z');
const iso = (ms) => new Date(BASE + ms).toISOString();
const CTX = 'manager-classic-z28/eyes-classic-t45/check-classic-oau';
const lines = [];
lines.push('core-classic (' + CTX + ') | ' + iso(0) + ' [INFO ] Command "check" is called with settings {');
lines.push('  fully: true,');
lines.push('  lazyLoad: { scrollLength: 300, waitingTime: 2000, maxAmountToScroll: 15000 },');
lines.push('  waitBeforeCapture: 2500');
lines.push('}');
lines.push('core-classic (' + CTX + ') | ' + iso(100) + ' [INFO ] Running scrolling sequence to lazy load a view content');
for (let t = 1000; t <= 121000; t += 2000) {
  lines.push('driver (' + CTX + ') | ' + iso(t) + ' [INFO ] Polling...');
}
lines.push('core-classic (manager-classic-z28/eyes-classic-t45/abort-gmf) | ' + iso(122000) + ' [INFO ] Command "abort" is called with settings {}');
const log = lines.join('\n');

// ---- simulate the user selecting a file ----
els['file-input'].dispatch('change', { target: { files: [log] } });

const html = els['sda-root'].innerHTML;
assert.ok(html && html.length > 0, 'panel should have rendered into #sda-root');
assert.match(html, /SDK Debug Analysis/);
assert.match(html, /Enabled — scrollLength 300/); // lazyLoad fixed, not "Not Set"
assert.match(html, /silent stall/);               // stall detected
assert.match(html, /lazyLoad scroll poll/);        // executePoll op summarised
assert.match(html, /eyes\.check aborted/);          // abort surfaced

// drop-area path too
els['sda-root']._html = '';
els['drop-area'].dispatch('drop', { preventDefault() {}, dataTransfer: { files: [log] } });
assert.match(els['sda-root'].innerHTML, /SDK Debug Analysis/, 'drop path should also render');

console.log('DOM integration test: all checks passed.');
