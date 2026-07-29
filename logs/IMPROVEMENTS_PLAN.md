# Log Viewer — fix + debugging enhancements (FLD-4750)

The SDK debug-log viewer at `https://applitools.github.io/demo/logs/logs.html` loads an
Applitools SDK `.log` file and renders a structured view of it.

This change was driven by a live support investigation (**FLD-4750**). The case was an
`eyes.check()` that hung for ~5 minutes inside the *lazy-load scroll poll* and was then
aborted. The viewer actively **misled** the investigation: for a check whose settings clearly
contain a `lazyLoad` object, the summary showed **"Lazy Load: Not Set"**, and nothing in the
viewer surfaced the 5-minute stall, the runaway poll loop, or the abort. Debugging went down
the wrong path as a result.

This document is the explicit plan. Each item lists **what / why / how**.

---

## Log format reference

Every line is:

```
<package> (<context-path>) | <ISO-timestamp> [<LEVEL>] <message>
```

e.g. `core-classic (manager-classic-z28/eyes-classic-t45/check-classic-oau) | 2026-07-13T14:40:32.876Z [INFO ] Command "check" is called with settings { ... }`

Settings dumps are pretty-printed with `util.inspect`, so a single logical message spans many
physical lines. The check settings block looks like:

```
Command "check" is called with settings {
  stitchMode: 'CSS',
  fully: true,
  matchTimeout: 0,
  lazyLoad: { scrollLength: 300, waitingTime: 2000, maxAmountToScroll: 15000 },
  waitBeforeCapture: 2500,
  ...
}
```

Recurring message shapes: `Command "X" is called`, `Request "Y" ...`, `Polling...`,
`Executing poll script`, `Running scrolling sequence to lazy load a view content`, and
heartbeats POSTing to `/api/sessions/sdkprocess/keepalive`.

---

## 1. Fix `lazyLoad` detection (the confirmed bug)

**What.** Parse the `lazyLoad` object from the check-settings block instead of looking for a
top-level boolean.

**Why.** The config parser matched `lazyLoad:\s*(true|false|undefined)`. In real logs `lazyLoad`
is never a boolean — it is an object: `lazyLoad: { scrollLength: 300, waitingTime: 2000,
maxAmountToScroll: 15000 }`. The regex never matched, so `config.lazyLoad` stayed unset and the
overview rendered **"Lazy Load: Not Set"** — the exact false signal from FLD-4750. The
downstream performance code already *expects* an object (`lazyLoad.scrollLength`,
`lazyLoad.waitingTime`, `lazyLoad.maxAmountToScroll`), so the boolean parse was also internally
inconsistent.

**How.** Match the object form and populate a structured value:

```js
const m = line.match(/lazyLoad:\s*\{\s*scrollLength:\s*(\d+),\s*waitingTime:\s*(\d+),\s*maxAmountToScroll:\s*(\d+)\s*\}/);
if (m) config.lazyLoad = { scrollLength:+m[1], waitingTime:+m[2], maxAmountToScroll:+m[3] };
else { const b = line.match(/lazyLoad:\s*(true|false)/); if (b) config.lazyLoad = b[1] === 'true'; }
```

Applied in three places:
- `logs/logs-llm-service.mjs` — `parseConfig()` (the readable source module).
- `logs/assets/index-*.js` — the deployed React bundle carries a minified twin of the same
  buggy regex; patched surgically so the live overview stops saying "Not Set".
- `logs/sdk-debug-analysis.js` — the new panel (below) parses it correctly from the start.

---

## 2. Debugging enhancements

The ideal viewer should make *"check() stuck in the lazyLoad scroll poll for ~5 min, then
aborted"* obvious at a glance. These are delivered as a new self-contained vanilla-JS panel,
`logs/sdk-debug-analysis.js`, rendered at the **top** of the page so the diagnosis is the first
thing you see. It parses the log independently (no dependency on the React bundle).

### 2a. Long silent-stall detection
**What.** Detect and highlight stretches where the only activity is repeated `Polling...` plus
heartbeats (a hung `executePoll`). **Why.** This is the signature of the FLD-4750 hang and is
invisible today. **How.** Classify every event as *noise* (`Polling...`, `Executing poll
script`, heartbeat / keepalive, `Location header: not found`) or *meaningful*. Find the largest
time gap between consecutive meaningful events. Render:
`⚠ N-minute stall starting at <ts>; last meaningful event before it: <event>`.

### 2b. Command / phase timeline with durations
**What.** A timeline of the top-level commands (`makeManager` → `openEyes` → `check` →
`getBaseEyes` → `abort` → `getResults`) with the wall-clock duration of each phase and a bar
visualization. **Why.** Shows *which* phase ate the time (here: `check` → `abort` = ~5 min).
**How.** Take each `Command "X" is called` event; phase duration = next command's start − this
command's start; flag the longest / any phase over a threshold.

### 2c. Filter / collapse heartbeat + poll noise
**What.** Collapse heartbeat and `Polling...` lines in the event stream behind a toggle, with
counts. **Why.** In the sample, ~150 `Polling...` lines and ~60 heartbeat lines bury the real
work. **How.** Render a compact event stream with noise hidden by default and a checkbox to
expand; show "N heartbeats / N polls collapsed".

### 2d. Surface aborts
**What.** Call out each `abort` with the last event before it and any error + stack. **Why.**
The abort and its cause (in the sample, `ReferenceError: metadata is not defined` during
`getSessionMetadata`) are the payoff of the investigation. **How.** Detect the `abort` command,
attach the preceding meaningful event, and scan nearby `[ERROR]` / `[WARN]` lines (including
multi-line stack traces) to display alongside.

### 2e. `executePoll` operation summary
**What.** For each poll loop show iteration count + total duration + outcome, e.g.
`lazyLoad scroll poll: 149 iterations, 5m01s — did not complete (aborted)`. **Why.** Quantifies
the runaway loop. **How.** Group `Polling...` / `Executing poll script` by context path; count
iterations; duration = last − first poll; outcome = completed if normal work follows, otherwise
did-not-complete / aborted.

### 2f. Per-session summary
**What.** One header block: runner type (classic / ufg), agent id, key check settings
(`fully`, `lazyLoad`, `matchTimeout`, `waitBeforeCapture`, `stitchMode`, `matchLevel`), final
status, total duration, and counts (checks / commands / polls / heartbeats). **Why.** The
at-a-glance context a supporter needs before drilling in. **How.** Derive runner from the
`manager-classic` / `manager-ufg` label, parse the check-settings block, and detect final status
(aborted vs. completed) from the command sequence.

---

## Testing

- `logs/sdk-debug-analysis.test.mjs` — a standalone `node:assert` test that runs the analyzer
  against a **synthetic** fixture reproducing the FLD-4750 structure (lazyLoad object, 5-minute
  poll stall, abort with error) — no customer data. Run with `node logs/sdk-debug-analysis.test.mjs`.
- Verified interactively against the real sample log from the ticket.

## Deployment note

`applitools/demo` (branch `gh-pages`) is a **GitHub Actions deploy target** — `logs/` is
rebuilt and force-committed by CI ("Update logs viewer deployment"). The React app's original
source repo was not locatable from here. This PR patches the deployed artifacts so the fix is
live immediately and adds the new panel as a standalone file; the `parseConfig` regex fix should
also be carried into the upstream source repo so it survives the next redeploy.
