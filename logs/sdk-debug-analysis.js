/*
 * SDK Debug Analysis panel for the Applitools log viewer.
 *
 * Self-contained, dependency-free. Parses an Applitools SDK debug `.log` file and surfaces the
 * things that make hang / abort cases quick to diagnose (driven by FLD-4750):
 *   - correct lazyLoad detection (object form in the check-settings block)
 *   - long silent-stall detection (hung executePoll: only Polling... + heartbeats)
 *   - a command / phase timeline with durations
 *   - executePoll operation summaries (iterations + duration + outcome)
 *   - abort surfacing with the preceding event and any error / stack
 *   - heartbeat / poll noise collapsing
 *   - a per-session summary
 *
 * Works in the browser (classic <script>, self-wires to the file input) and in Node
 * (module.exports) so the analysis is unit-testable without a DOM.
 */
(function (global) {
  'use strict';

  // <package> (<context-path>) | <ISO-timestamp> [<LEVEL>] <message>
  var LINE_RE = /^(\S+) (?:\(([^)]+)\) )?\| (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)? (?:\[([A-Z]+)\s*\])? (.+)$/;

  var STALL_THRESHOLD_MS = 30 * 1000; // flag silent stretches longer than this
  var MIN_POLL_ITERATIONS = 5; // ignore trivial poll loops

  // ---------- parsing ----------

  function parseLog(text) {
    var lines = String(text).split(/\r?\n/);
    var events = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m = line.match(LINE_RE);
      if (m) {
        var ts = m[3] ? Date.parse(m[3]) : NaN;
        events.push({
          label: m[1],
          contextPath: m[2] || null,
          context: m[2] ? m[2].split('/') : [],
          tsIso: m[3] || null,
          tsMs: isNaN(ts) ? null : ts,
          level: m[4] || null,
          message: m[5],
          lineNo: i + 1,
        });
      } else if (events.length) {
        // util.inspect continuation line — belongs to the previous event's message
        events[events.length - 1].message += '\n' + line;
      }
    }
    return events;
  }

  function firstLine(ev) {
    var nl = ev.message.indexOf('\n');
    return nl === -1 ? ev.message : ev.message.slice(0, nl);
  }

  // ---------- classification ----------

  function isHeartbeat(ev) {
    var msg = ev.message;
    return (
      (ev.contextPath && /heartbeat/i.test(ev.contextPath)) ||
      /"heartbeat"/.test(msg) ||
      /keepalive/.test(msg) ||
      /Heartbeat acquired/.test(msg) ||
      /Starting heartbeats/.test(msg)
    );
  }
  function isPolling(ev) {
    return /^Polling\.\.\./.test(ev.message);
  }
  function isPollScript(ev) {
    return /Executing poll script/.test(firstLine(ev));
  }
  function isLocationNoise(ev) {
    return /Location header: not found/.test(firstLine(ev));
  }
  function isNoise(ev) {
    return isHeartbeat(ev) || isPolling(ev) || isPollScript(ev) || isLocationNoise(ev);
  }
  function commandName(ev) {
    var m = firstLine(ev).match(/Command "([^"]+)" is called/);
    return m ? m[1] : null;
  }
  function shortCtx(contextPath) {
    if (!contextPath) return '(root)';
    var parts = contextPath.split('/');
    return parts[parts.length - 1];
  }

  // ---------- settings ----------

  function parseCheckSettings(message) {
    var s = {};
    var lazyObj = message.match(
      /lazyLoad:\s*\{\s*scrollLength:\s*(\d+),\s*waitingTime:\s*(\d+),\s*maxAmountToScroll:\s*(\d+)\s*\}/
    );
    if (lazyObj) {
      s.lazyLoad = {
        scrollLength: +lazyObj[1],
        waitingTime: +lazyObj[2],
        maxAmountToScroll: +lazyObj[3],
      };
    } else {
      var lazyBool = message.match(/lazyLoad:\s*(true|false)/);
      if (lazyBool) s.lazyLoad = lazyBool[1] === 'true';
    }
    var pick = function (re, key, cast) {
      var mm = message.match(re);
      if (mm) s[key] = cast ? cast(mm[1]) : mm[1];
    };
    pick(/fully:\s*(true|false)/, 'fully', function (v) { return v === 'true'; });
    pick(/matchTimeout:\s*(\d+)/, 'matchTimeout', Number);
    pick(/waitBeforeCapture:\s*(\d+)/, 'waitBeforeCapture', Number);
    pick(/waitBetweenStitches:\s*(\d+)/, 'waitBetweenStitches', Number);
    pick(/stitchMode:\s*'([^']+)'/, 'stitchMode');
    pick(/matchLevel:\s*'([^']+)'/, 'matchLevel');
    return s;
  }

  // ---------- analysis ----------

  function analyzeLog(text) {
    var events = parseLog(text);
    var withTs = events.filter(function (e) { return e.tsMs != null; });
    var firstTs = withTs.length ? withTs[0].tsMs : null;
    var lastTs = withTs.length ? withTs[withTs.length - 1].tsMs : null;

    // runner type
    var runner = 'unknown';
    for (var i = 0; i < events.length; i++) {
      var hay = (events[i].label || '') + ' ' + (events[i].contextPath || '');
      if (/ufg/i.test(hay)) { runner = 'Ultrafast Grid (ufg)'; break; }
      if (/classic/i.test(hay)) { runner = 'Classic'; break; }
    }

    // agent id
    var agentId = null;
    for (var a = 0; a < events.length && !agentId; a++) {
      var am = events[a].message.match(/agentId:\s*'([^']+)'/);
      if (am) agentId = am[1];
    }

    // commands
    var commands = [];
    events.forEach(function (ev) {
      var name = commandName(ev);
      if (name) commands.push({ name: name, contextPath: ev.contextPath, tsMs: ev.tsMs, tsIso: ev.tsIso, ev: ev });
    });

    // check settings (first check command)
    var checkSettings = null;
    for (var c = 0; c < commands.length; c++) {
      if (commands[c].name === 'check') { checkSettings = parseCheckSettings(commands[c].ev.message); break; }
    }

    var aborted = commands.some(function (c) { return c.name === 'abort'; });
    var finalStatus = aborted ? 'Aborted' : (commands.length ? 'Completed / not aborted' : 'Unknown');

    // ---- phase timeline (per command) ----
    var timeline = commands.map(function (cmd, idx) {
      var nextTs = idx + 1 < commands.length ? commands[idx + 1].tsMs : lastTs;
      var dur = cmd.tsMs != null && nextTs != null ? nextTs - cmd.tsMs : null;
      return {
        name: cmd.name,
        ctx: shortCtx(cmd.contextPath),
        tsMs: cmd.tsMs,
        tsIso: cmd.tsIso,
        durationMs: dur,
      };
    });
    var longestPhase = null;
    timeline.forEach(function (p) {
      if (p.durationMs != null && (!longestPhase || p.durationMs > longestPhase.durationMs)) longestPhase = p;
    });

    // ---- stall detection ----
    var meaningful = events.filter(function (e) { return e.tsMs != null && !isNoise(e); });
    var stalls = [];
    for (var s = 0; s + 1 < meaningful.length; s++) {
      var gap = meaningful[s + 1].tsMs - meaningful[s].tsMs;
      if (gap >= STALL_THRESHOLD_MS) {
        var polls = 0, hbeats = 0;
        for (var k = 0; k < events.length; k++) {
          var e = events[k];
          if (e.tsMs != null && e.tsMs > meaningful[s].tsMs && e.tsMs < meaningful[s + 1].tsMs) {
            if (isPolling(e)) polls++;
            else if (isHeartbeat(e)) hbeats++;
          }
        }
        stalls.push({
          durationMs: gap,
          startTs: meaningful[s].tsIso,
          endTs: meaningful[s + 1].tsIso,
          lastMeaningful: firstLine(meaningful[s]),
          lastMeaningfulCtx: shortCtx(meaningful[s].contextPath),
          nextMeaningful: firstLine(meaningful[s + 1]),
          pollCount: polls,
          heartbeatCount: hbeats,
        });
      }
    }
    stalls.sort(function (x, y) { return y.durationMs - x.durationMs; });

    // ---- executePoll operations ----
    var pollGroups = {};
    events.forEach(function (ev) {
      if (!(isPolling(ev) || isPollScript(ev)) || ev.tsMs == null) return;
      var key = ev.contextPath || '(root)';
      var g = pollGroups[key] || (pollGroups[key] = { contextPath: ev.contextPath, iterations: 0, firstTs: ev.tsMs, lastTs: ev.tsMs, firstIso: ev.tsIso, lastIso: ev.tsIso });
      if (isPolling(ev)) g.iterations++;
      g.firstTs = Math.min(g.firstTs, ev.tsMs);
      g.lastTs = Math.max(g.lastTs, ev.tsMs);
      if (ev.tsMs <= g.firstTs) g.firstIso = ev.tsIso;
      if (ev.tsMs >= g.lastTs) g.lastIso = ev.tsIso;
    });
    var hasLazyScroll = events.some(function (e) { return /Running scrolling sequence to lazy load/.test(firstLine(e)); });
    var pollOps = Object.keys(pollGroups)
      .map(function (k) { return pollGroups[k]; })
      .filter(function (g) { return g.iterations >= MIN_POLL_ITERATIONS; })
      .map(function (g) {
        var durationMs = g.lastTs - g.firstTs;
        var isLazy = hasLazyScroll && g.contextPath && /check/.test(g.contextPath);
        // outcome: aborted if the session was aborted and this poll ended right before it
        var outcome = 'completed';
        if (aborted) {
          var abortTs = commands.filter(function (c) { return c.name === 'abort'; })[0].tsMs;
          if (abortTs != null && abortTs - g.lastTs < 5000) outcome = 'did not complete (aborted)';
        }
        return {
          label: isLazy ? 'lazyLoad scroll poll' : 'poll @ ' + shortCtx(g.contextPath),
          contextPath: g.contextPath,
          iterations: g.iterations,
          durationMs: durationMs,
          firstIso: g.firstIso,
          lastIso: g.lastIso,
          outcome: outcome,
        };
      })
      .sort(function (x, y) { return y.durationMs - x.durationMs; });

    // ---- aborts ----
    var abortInfos = commands
      .filter(function (c) { return c.name === 'abort'; })
      .map(function (c) {
        var before = null;
        for (var b = meaningful.length - 1; b >= 0; b--) {
          if (meaningful[b].tsMs < c.tsMs) { before = meaningful[b]; break; }
        }
        // find nearest error/warn around the abort
        var error = null;
        for (var e2 = 0; e2 < events.length; e2++) {
          var ev2 = events[e2];
          if ((ev2.level === 'ERROR' || ev2.level === 'WARN') && ev2.tsMs != null && Math.abs(ev2.tsMs - c.tsMs) < 10000) {
            if (!error || ev2.level === 'ERROR') {
              error = { level: ev2.level, message: ev2.message, tsIso: ev2.tsIso };
              if (ev2.level === 'ERROR') break;
            }
          }
        }
        return {
          tsIso: c.tsIso,
          ctx: shortCtx(c.contextPath),
          before: before ? { text: firstLine(before), ctx: shortCtx(before.contextPath), tsIso: before.tsIso } : null,
          error: error,
        };
      });

    // ---- event stream (noise collapsed into runs) ----
    var stream = [];
    var run = null;
    events.forEach(function (ev) {
      if (isNoise(ev)) {
        if (!run) run = { kind: 'noise', polls: 0, heartbeats: 0, other: 0, startIso: ev.tsIso, endIso: ev.tsIso, startTs: ev.tsMs, endTs: ev.tsMs };
        if (isPolling(ev)) run.polls++;
        else if (isHeartbeat(ev)) run.heartbeats++;
        else run.other++;
        if (ev.tsIso) run.endIso = ev.tsIso;
        if (ev.tsMs != null) run.endTs = ev.tsMs;
      } else {
        if (run) { stream.push(run); run = null; }
        stream.push({ kind: 'event', ev: ev });
      }
    });
    if (run) stream.push(run);

    return {
      summary: {
        runner: runner,
        agentId: agentId,
        checkSettings: checkSettings,
        finalStatus: finalStatus,
        aborted: aborted,
        totalDurationMs: firstTs != null && lastTs != null ? lastTs - firstTs : null,
        startIso: withTs.length ? withTs[0].tsIso : null,
        endIso: withTs.length ? withTs[withTs.length - 1].tsIso : null,
        counts: {
          events: events.length,
          commands: commands.length,
          checks: commands.filter(function (c) { return c.name === 'check'; }).length,
          polls: events.filter(isPolling).length,
          heartbeats: events.filter(isHeartbeat).length,
        },
      },
      timeline: timeline,
      longestPhase: longestPhase,
      stalls: stalls,
      pollOps: pollOps,
      aborts: abortInfos,
      stream: stream,
    };
  }

  // ---------- formatting ----------

  function fmtDuration(ms) {
    if (ms == null || isNaN(ms)) return '—';
    if (ms < 1000) return ms + 'ms';
    var h = Math.floor(ms / 3600000); ms -= h * 3600000;
    var m = Math.floor(ms / 60000); ms -= m * 60000;
    var s = Math.floor(ms / 1000);
    var msRem = ms - s * 1000;
    var out = [];
    if (h) out.push(h + 'h');
    if (m) out.push(m + 'm');
    if (s || (!h && !m)) out.push(s + (msRem && !h && !m ? '.' + String(msRem).padStart(3, '0') : '') + 's');
    return out.join(' ');
  }
  function fmtClock(iso) {
    if (!iso) return '—';
    var m = iso.match(/T(\d{2}:\d{2}:\d{2}\.\d{3})Z/);
    return m ? m[1] : iso;
  }
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function fmtLazy(lazy) {
    if (lazy == null) return { text: 'Not Set', cls: 'sda-muted' };
    if (lazy === false) return { text: 'Disabled', cls: 'sda-muted' };
    if (lazy === true) return { text: 'Enabled', cls: 'sda-ok' };
    return {
      text: 'Enabled — scrollLength ' + lazy.scrollLength + ', waitingTime ' + lazy.waitingTime +
        'ms, maxAmountToScroll ' + lazy.maxAmountToScroll,
      cls: 'sda-ok',
    };
  }

  // ---------- rendering ----------

  var STYLE = [
    '#sda-panel{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c2330;background:#f7f9fc;border:1px solid #d7dee8;border-radius:10px;padding:18px 20px;margin:16px 0}',
    '#sda-panel h3{margin:22px 0 8px;font-size:15px;letter-spacing:.02em;text-transform:uppercase;color:#5a6473}',
    '#sda-panel h3:first-of-type{margin-top:4px}',
    '.sda-title{font-size:20px;font-weight:700;margin:0 0 2px}',
    '.sda-sub{color:#6b7482;font-size:12px;margin:0 0 8px}',
    '.sda-cards{display:flex;flex-wrap:wrap;gap:10px}',
    '.sda-card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;min-width:150px}',
    '.sda-card .k{font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#8a94a3}',
    '.sda-card .v{font-size:15px;font-weight:600;margin-top:2px}',
    '.sda-alert{border-radius:8px;padding:12px 14px;margin:8px 0;border:1px solid}',
    '.sda-alert.crit{background:#fff1f0;border-color:#ffa39e}',
    '.sda-alert.warn{background:#fffbe6;border-color:#ffe58f}',
    '.sda-alert.ok{background:#f6ffed;border-color:#b7eb8f}',
    '.sda-alert .h{font-weight:700;font-size:14px}',
    '.sda-alert .d{font-size:13px;margin-top:4px;color:#3c4656}',
    '.sda-alert code{background:rgba(0,0,0,.06);padding:1px 5px;border-radius:4px;font-size:12px}',
    '#sda-panel table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}',
    '#sda-panel th,#sda-panel td{text-align:left;padding:7px 10px;border-bottom:1px solid #eef1f5}',
    '#sda-panel th{background:#f0f3f8;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#6b7482}',
    '#sda-panel tr:last-child td{border-bottom:none}',
    '.sda-bar{height:8px;background:#4c8bf5;border-radius:4px;min-width:2px}',
    '.sda-row-hot td{background:#fff1f0}',
    '.sda-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}',
    '.sda-ok{color:#237804;font-weight:600}',
    '.sda-muted{color:#8a94a3}',
    '.sda-crit{color:#cf1322;font-weight:600}',
    '.sda-stream{max-height:420px;overflow:auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:6px 8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5}',
    '.sda-ev{white-space:pre-wrap;word-break:break-word}',
    '.sda-ev.lvl-ERROR{color:#cf1322}.sda-ev.lvl-WARN{color:#ad6800}',
    '.sda-collapsed{color:#8a94a3;font-style:italic;cursor:pointer;padding:2px 0}',
    '.sda-collapsed:hover{color:#4c8bf5}',
    '.sda-toolbar{display:flex;gap:14px;align-items:center;margin:8px 0;font-size:13px}',
    '.sda-pill{display:inline-block;background:#eef2f8;border-radius:10px;padding:1px 8px;font-size:11px;color:#5a6473}',
  ].join('\n');

  function renderReport(report) {
    var s = report.summary;
    var html = [];
    html.push('<style>' + STYLE + '</style>');
    html.push('<div id="sda-panel">');
    html.push('<div class="sda-title">SDK Debug Analysis</div>');
    html.push('<div class="sda-sub">Automated diagnosis of the loaded Applitools SDK log</div>');

    // ----- headline alerts (stall / abort) -----
    var topStall = report.stalls[0];
    if (topStall) {
      html.push('<div class="sda-alert crit"><div class="h">⚠ ' + fmtDuration(topStall.durationMs) +
        ' silent stall starting at ' + esc(fmtClock(topStall.startTs)) + '</div>' +
        '<div class="d">During the stall the only activity was <code>' + topStall.pollCount +
        ' Polling...</code> + <code>' + topStall.heartbeatCount + ' heartbeats</code> — a hung executePoll.<br>' +
        'Last meaningful event before it: <code>' + esc(topStall.lastMeaningful) + '</code> <span class="sda-pill">' +
        esc(topStall.lastMeaningfulCtx) + '</span><br>' +
        'Resumed with: <code>' + esc(topStall.nextMeaningful) + '</code></div></div>');
    }
    report.aborts.forEach(function (ab) {
      var d = 'Abort at <code>' + esc(fmtClock(ab.tsIso)) + '</code>';
      if (ab.before) d += '<br>Last event before abort: <code>' + esc(ab.before.text) + '</code> <span class="sda-pill">' + esc(ab.before.ctx) + '</span>';
      if (ab.error) d += '<br>' + (ab.error.level === 'ERROR' ? '<span class="sda-crit">Error</span>' : '<span style="color:#ad6800">Warning</span>') +
        ': <code>' + esc(firstLineOf(ab.error.message)) + '</code>';
      html.push('<div class="sda-alert warn"><div class="h">⛔ eyes.check aborted</div><div class="d">' + d + '</div></div>');
    });
    if (!topStall && !report.aborts.length) {
      html.push('<div class="sda-alert ok"><div class="h">✓ No long stalls or aborts detected</div></div>');
    }

    // ----- session summary -----
    html.push('<h3>Session summary</h3><div class="sda-cards">');
    var lazy = fmtLazy(s.checkSettings ? s.checkSettings.lazyLoad : null);
    var cs = s.checkSettings || {};
    var card = function (k, v, cls) { html.push('<div class="sda-card"><div class="k">' + esc(k) + '</div><div class="v ' + (cls || '') + '">' + v + '</div></div>'); };
    card('Runner', esc(s.runner));
    card('Final status', esc(s.finalStatus), s.aborted ? 'sda-crit' : 'sda-ok');
    card('Total duration', esc(fmtDuration(s.totalDurationMs)));
    card('Lazy Load', esc(lazy.text), lazy.cls);
    card('fully', cs.fully === undefined ? '—' : String(cs.fully));
    card('matchTimeout', cs.matchTimeout === undefined ? '—' : cs.matchTimeout + 'ms');
    card('waitBeforeCapture', cs.waitBeforeCapture === undefined ? '—' : cs.waitBeforeCapture + 'ms');
    card('stitchMode', esc(cs.stitchMode || '—'));
    if (s.agentId) card('Agent', esc(s.agentId));
    card('Commands / Checks', s.counts.commands + ' / ' + s.counts.checks);
    card('Polls / Heartbeats', s.counts.polls + ' / ' + s.counts.heartbeats);
    html.push('</div>');

    // ----- executePoll ops -----
    if (report.pollOps.length) {
      html.push('<h3>executePoll operations</h3><table><thead><tr><th>Operation</th><th>Iterations</th><th>Duration</th><th>Outcome</th><th>Window</th></tr></thead><tbody>');
      report.pollOps.forEach(function (p) {
        var hot = /did not complete/.test(p.outcome);
        html.push('<tr' + (hot ? ' class="sda-row-hot"' : '') + '><td>' + esc(p.label) + '</td><td>' + p.iterations +
          '</td><td>' + esc(fmtDuration(p.durationMs)) + '</td><td class="' + (hot ? 'sda-crit' : 'sda-ok') + '">' + esc(p.outcome) +
          '</td><td class="sda-mono">' + esc(fmtClock(p.firstIso)) + ' → ' + esc(fmtClock(p.lastIso)) + '</td></tr>');
      });
      html.push('</tbody></table>');
    }

    // ----- phase timeline -----
    if (report.timeline.length) {
      var maxDur = report.longestPhase ? report.longestPhase.durationMs : 0;
      html.push('<h3>Command &amp; phase timeline</h3><table><thead><tr><th>Command</th><th>Context</th><th>Start</th><th>Duration</th><th style="width:30%">&nbsp;</th></tr></thead><tbody>');
      report.timeline.forEach(function (p) {
        var hot = report.longestPhase && p === report.longestPhase;
        var w = maxDur && p.durationMs != null ? Math.max(2, Math.round((p.durationMs / maxDur) * 100)) : 0;
        html.push('<tr' + (hot ? ' class="sda-row-hot"' : '') + '><td><strong>' + esc(p.name) + '</strong></td><td class="sda-mono">' + esc(p.ctx) +
          '</td><td class="sda-mono">' + esc(fmtClock(p.tsIso)) + '</td><td>' + esc(fmtDuration(p.durationMs)) +
          '</td><td><div class="sda-bar" style="width:' + w + '%' + (hot ? ';background:#cf1322' : '') + '"></div></td></tr>');
      });
      html.push('</tbody></table>');
    }

    // ----- event stream with noise collapse -----
    html.push('<h3>Event stream</h3>');
    html.push('<div class="sda-toolbar"><label><input type="checkbox" id="sda-show-noise"> Show heartbeat &amp; polling noise</label>' +
      '<span class="sda-pill">' + s.counts.polls + ' polls + ' + s.counts.heartbeats + ' heartbeats collapsed</span></div>');
    html.push('<div class="sda-stream" id="sda-stream">');
    report.stream.forEach(function (item, idx) {
      if (item.kind === 'noise') {
        var parts = [];
        if (item.polls) parts.push(item.polls + ' Polling...');
        if (item.heartbeats) parts.push(item.heartbeats + ' heartbeat');
        if (item.other) parts.push(item.other + ' other');
        var span = item.startTs != null && item.endTs != null ? ' (' + fmtDuration(item.endTs - item.startTs) + ')' : '';
        html.push('<div class="sda-collapsed" data-noise="' + idx + '">▶ ' + esc(parts.join(', ')) + ' noise line(s)' + esc(span) + '</div>');
      } else {
        var ev = item.ev;
        var cls = 'sda-ev' + (ev.level ? ' lvl-' + ev.level : '');
        html.push('<div class="' + cls + '">' + esc(fmtClock(ev.tsIso)) + ' [' + esc(ev.level || '') + '] <span class="sda-pill">' +
          esc(shortCtx(ev.contextPath)) + '</span> ' + esc(ev.message) + '</div>');
      }
    });
    html.push('</div>');

    html.push('</div>'); // #sda-panel
    return html.join('');
  }

  function firstLineOf(msg) {
    var nl = String(msg).indexOf('\n');
    return nl === -1 ? msg : String(msg).slice(0, nl);
  }

  // ---------- DOM wiring (browser only) ----------

  function ensureContainer() {
    var el = document.getElementById('sda-root');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'sda-root';
    var main = document.querySelector('main');
    if (main) main.insertBefore(el, main.firstChild);
    else document.body.insertBefore(el, document.body.firstChild);
    return el;
  }

  function renderInto(container, report) {
    container.innerHTML = renderReport(report);
    var showNoise = container.querySelector('#sda-show-noise');
    var stream = container.querySelector('#sda-stream');
    if (showNoise && stream) {
      var apply = function () {
        stream.querySelectorAll('.sda-collapsed').forEach(function (n) {
          n.style.display = showNoise.checked ? 'none' : '';
        });
        // Noise is already collapsed into summary rows; the toggle just reveals/hides those rows.
      };
      showNoise.addEventListener('change', apply);
      apply();
    }
  }

  function analyzeAndRender(text) {
    try {
      var report = analyzeLog(text);
      renderInto(ensureContainer(), report);
    } catch (err) {
      var c = ensureContainer();
      c.innerHTML = '<div style="color:#cf1322;font-family:sans-serif;padding:10px">SDK Debug Analysis failed: ' + esc(err && err.message) + '</div>';
      if (global.console) global.console.error(err);
    }
  }

  function readFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { analyzeAndRender(reader.result); };
    reader.readAsText(file);
  }

  function wire() {
    var input = document.getElementById('file-input');
    if (input) {
      input.addEventListener('change', function (e) {
        if (e.target.files && e.target.files[0]) readFile(e.target.files[0]);
      });
    }
    var drop = document.getElementById('drop-area');
    if (drop) {
      drop.addEventListener('dragover', function (e) { e.preventDefault(); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
      });
    }
  }

  var api = {
    parseLog: parseLog,
    analyzeLog: analyzeLog,
    renderReport: renderReport,
    fmtDuration: fmtDuration,
    STALL_THRESHOLD_MS: STALL_THRESHOLD_MS,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SdkDebugAnalysis = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
    else wire();
  }
})(typeof window !== 'undefined' ? window : globalThis);
