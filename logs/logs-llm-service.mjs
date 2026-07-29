const errorIndicators = [
  "Exception:",
  "Error at",
  "reason: Error:",
  "Error in",
  "failed due to an error",
  "error during",
  "error in",
  "Error during",
  "status: 'error'"
];
function genericSearch(data, predicate, childSelector = (value) => typeof value === "object" && value !== null ? value : null) {
  if (typeof data !== "object" || data === null) {
    return [];
  }
  const entries = Object.entries(data);
  if (!entries.length) {
    return [];
  }
  return entries.filter(([key, value]) => predicate(key, value)).concat(
    entries.flatMap(([, value]) => {
      const child = childSelector(value);
      return child ? genericSearch(child, predicate, childSelector) : [];
    })
  );
}
function searchObjects(data, needle = "render-target") {
  return genericSearch(data, (key) => key.includes(needle));
}
function searchLogs(data, needle) {
  const results = [];
  if (data.logs && Array.isArray(data.logs) && data.logs.some((line) => line.includes(needle))) {
    results.push(["root", data]);
  }
  const nestedResults = genericSearch(data, (_, value) => {
    const logEntry = value;
    return logEntry?.logs?.some((line) => line.includes(needle)) ?? false;
  });
  return results.concat(nestedResults);
}
function extractNMLInfo(data) {
  const nmlLogs = searchLogs(data, 'Request "takeScreenshots" was performed on applitools lib');
  if (nmlLogs.length === 0) {
    return null;
  }
  try {
    const [, logData] = nmlLogs[0];
    const logs = logData?.logs;
    if (!logs || !Array.isArray(logs)) {
      return null;
    }
    const infoLine = logs.find(
      (line) => line.includes('Request "takeScreenshots" was performed on applitools lib')
    );
    if (!infoLine) {
      return null;
    }
    const libVersionMatch = infoLine.match(/applitools lib v([\d.]+)/);
    const protocolVersionMatch = infoLine.match(/through protocol v([\d.]+)/);
    if (!libVersionMatch || !protocolVersionMatch) {
      return null;
    }
    const logsText = logs.join("\n");
    const osMatch = logsText.match(/OS:\s*['"]([^'"]+)['"]/);
    const modelMatch = logsText.match(/model:\s*['"]([^'"]+)['"]/);
    const nameMatch = logsText.match(/name:\s*['"]([^'"]+)['"]/);
    const orientationMatch = logsText.match(/orientation:\s*['"]([^'"]+)['"]/);
    const nmlInfo = {
      libraryVersion: libVersionMatch[1],
      protocolVersion: protocolVersionMatch[1],
      device: {
        os: osMatch?.[1] || "Unknown",
        model: modelMatch?.[1] || "Unknown",
        name: nameMatch?.[1] || "Unknown",
        orientation: orientationMatch?.[1] || "Unknown"
      }
    };
    return nmlInfo;
  } catch (error) {
    console.warn("Failed to parse NML info:", error);
    return null;
  }
}
function addErrorNotations(obj) {
  let hasError = false;
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      continue;
    }
    const value = obj[key];
    if (typeof value === "object" && value !== null) {
      const childHasError = addErrorNotations(value);
      if (childHasError) {
        value.hasError = true;
        hasError = true;
      }
    } else if (typeof value === "string") {
      const containsError = errorIndicators.some((indicator) => value.includes(indicator));
      if (containsError) {
        hasError = true;
      }
    }
  }
  if (hasError) {
    obj.hasError = true;
  }
  return hasError;
}
function buildDataIndex(data) {
  const index = {
    eyesUfg: /* @__PURE__ */ new Map(),
    eyesClassic: /* @__PURE__ */ new Map(),
    eyesBase: /* @__PURE__ */ new Map(),
    managersUfg: /* @__PURE__ */ new Map(),
    managersClassic: /* @__PURE__ */ new Map(),
    environments: /* @__PURE__ */ new Map(),
    renderTargets: /* @__PURE__ */ new Map(),
    checks: /* @__PURE__ */ new Map(),
    closes: /* @__PURE__ */ new Map(),
    eyesBasesByEyes: /* @__PURE__ */ new Map(),
    eyesBaseHasClose: /* @__PURE__ */ new Set(),
    eyesHasAnyClose: /* @__PURE__ */ new Set(),
    eyesHasResultsBase: /* @__PURE__ */ new Set(),
    eyesResultsOnly: /* @__PURE__ */ new Set(),
    errorNodes: [],
    fatalNodes: [],
    warnNodes: [],
    uploadNodes: [],
    networkNodes: [],
    deletedSessionIds: /* @__PURE__ */ new Set()
  };
  const eyesSeenOutsideResults = /* @__PURE__ */ new Set();
  const eyesSeenInsideResults = /* @__PURE__ */ new Set();
  function visit(node, key, nearestEyesId, nearestEyesBaseId, insideResultsPath) {
    if (/^eyes-ufg-[a-z0-9]+$/.test(key)) {
      if (!index.eyesUfg.has(key)) index.eyesUfg.set(key, node);
      if (insideResultsPath) {
        eyesSeenInsideResults.add(key);
      } else {
        eyesSeenOutsideResults.add(key);
      }
    } else if (/^eyes-classic-[a-z0-9]+$/.test(key)) {
      if (!index.eyesClassic.has(key)) index.eyesClassic.set(key, node);
      if (insideResultsPath) {
        eyesSeenInsideResults.add(key);
      } else {
        eyesSeenOutsideResults.add(key);
      }
    } else if (/^eyes-base-[a-z0-9]+$/.test(key)) {
      const hasResultsBase = Object.keys(node).some((k) => k.includes("get-results-base-"));
      const isResultsGatheringBase = insideResultsPath && hasResultsBase;
      if (!isResultsGatheringBase) {
        index.eyesBase.set(key, node);
        if (nearestEyesId) {
          if (!index.eyesBasesByEyes.has(nearestEyesId)) {
            index.eyesBasesByEyes.set(nearestEyesId, []);
          }
          index.eyesBasesByEyes.get(nearestEyesId).push([key, node]);
        }
      } else if (nearestEyesId) {
        index.eyesHasResultsBase.add(nearestEyesId);
      }
    } else if (/^manager-ufg-/.test(key)) {
      index.managersUfg.set(key, node);
    } else if (/^manager-classic-/.test(key)) {
      index.managersClassic.set(key, node);
    } else if (/^environment-/.test(key)) {
      index.environments.set(key, node);
    } else if (key.startsWith("render-target")) {
      index.renderTargets.set(key, node);
    } else if (/^check-/.test(key)) {
      index.checks.set(key, node);
    } else if (/^close-/.test(key)) {
      index.closes.set(key, node);
      if (key.startsWith("close-base-") && nearestEyesBaseId) {
        index.eyesBaseHasClose.add(nearestEyesBaseId);
      }
      if (nearestEyesId) {
        index.eyesHasAnyClose.add(nearestEyesId);
      }
    } else if (key.includes("get-eyes-results") && nearestEyesId) {
      index.eyesHasResultsBase.add(nearestEyesId);
    }
    if (node.logs && Array.isArray(node.logs)) {
      let hasError = false;
      let hasFatal = false;
      let hasWarn = false;
      let hasUpload = false;
      let hasNetwork = false;
      for (const line of node.logs) {
        if (!hasError && line.includes("[ERROR]")) hasError = true;
        if (!hasFatal && line.includes("[FATAL]")) hasFatal = true;
        if (!hasWarn && line.includes("[WARN]")) hasWarn = true;
        if (!hasUpload && line.includes("Upload called for")) hasUpload = true;
        if (!hasNetwork && line.includes('Request "')) hasNetwork = true;
        if (line.includes("deleteTest") && line.includes("testId")) {
          const dm = line.match(/testId[:\s]*['"](\d{15,})['"]/);
          if (dm) index.deletedSessionIds.add(dm[1]);
        }
      }
      if (hasError) index.errorNodes.push([key, node]);
      if (hasFatal) index.fatalNodes.push([key, node]);
      if (hasWarn) index.warnNodes.push([key, node]);
      if (hasUpload) index.uploadNodes.push([key, node]);
      if (hasNetwork) index.networkNodes.push([key, node]);
    }
    const childInsideResults = insideResultsPath || key.includes("get-manager-results") || key.includes("get-eyes-results");
    const childNearestEyesId = /^eyes-ufg-[a-z0-9]+$/.test(key) || /^eyes-classic-[a-z0-9]+$/.test(key) ? key : nearestEyesId;
    const childNearestEyesBaseId = /^eyes-base-[a-z0-9]+$/.test(key) ? key : nearestEyesBaseId;
    for (const childKey of Object.keys(node)) {
      if (childKey === "logs") continue;
      const child = node[childKey];
      if (child && typeof child === "object" && !Array.isArray(child)) {
        visit(
          child,
          childKey,
          childNearestEyesId,
          childNearestEyesBaseId,
          childInsideResults
        );
      }
    }
  }
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      visit(value, key, null, null, false);
    }
  }
  for (const id of eyesSeenInsideResults) {
    if (!eyesSeenOutsideResults.has(id)) {
      index.eyesResultsOnly.add(id);
    }
  }
  return index;
}
function cleanLogData(data) {
  data = data.replace(/\r\n/g, "\n");
  const trimmedData = data.trim();
  if (trimmedData.startsWith("[") && trimmedData.includes('"metadata"')) {
    try {
      const jsonLogs = JSON.parse(data);
      if (Array.isArray(jsonLogs) && jsonLogs.length > 0) {
        const ufgLines = jsonLogs.map((entry) => {
          const msg = entry.text?.log?.msg;
          return msg;
        }).filter((line) => line !== null);
        data = ufgLines.reverse().join("\n");
      }
    } catch (error) {
      console.warn("Failed to parse as Coralogix JSON format:", error);
    }
  }
  return data.split("\n").map(
    (s) => s.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+(stdout|stderr)\s+\w\s+/, "")
  ).map((s) => s.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,7}Z\s+/, "")).map((s) => s.replace(/^background\.js:\d+\s+/, "")).map((s) => s.replace(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]\s+/, "")).map((s) => s.replace(/^\[\d+-\d+\]\s/, "")).join("\n");
}
const CHUNK_LINE_COUNT = 1e4;
const ENTRY_START_PATTERN = /^[a-z][\w-]* \(/;
function chunkedParse(cleaned, parser) {
  const lines = cleaned.split("\n");
  let logs = [];
  let i = 0;
  while (i < lines.length) {
    let end = Math.min(i + CHUNK_LINE_COUNT, lines.length);
    while (end < lines.length && !ENTRY_START_PATTERN.test(lines[end])) {
      end++;
    }
    const chunk = lines.slice(i, end).join("\n");
    logs = logs.concat(parser.parseLogs(chunk));
    i = end;
  }
  return logs;
}
function runLogPipeline(raw, parser) {
  const cleaned = cleanLogData(raw);
  const logs = chunkedParse(cleaned, parser);
  const structured = parser.structureLogs(logs);
  const analyzed = parser.analyzeLogs(structured);
  if (analyzed && typeof analyzed === "object") {
    addErrorNotations(analyzed);
  }
  const index = buildDataIndex(analyzed);
  return {
    cleaned,
    logs,
    structured,
    analyzed,
    index,
    lineCount: cleaned.split("\n").length
  };
}
const mod$a = {
  id: "logsOverview",
  title: "Logs Overview",
  isPresent: () => true,
  extract(data, index) {
    const topLevelKeyCount = Object.keys(data).filter(
      (k) => typeof data[k] === "object"
    ).length;
    return {
      topLevelKeyCount,
      managers: index.managersUfg.size + index.managersClassic.size,
      eyes: index.eyesUfg.size + index.eyesClassic.size,
      checks: index.checks.size,
      environments: index.environments.size,
      renderTargets: index.renderTargets.size
    };
  },
  summarize(p) {
    return {
      oneLine: `${p.managers} manager(s), ${p.eyes} eyes, ${p.checks} check(s), ${p.environments} env(s)`,
      count: p.topLevelKeyCount,
      severity: "info",
      ...p
    };
  }
};
const mod$9 = {
  id: "testResults",
  title: "Test Results",
  isPresent: (_data, index) => index.eyesUfg.size + index.eyesClassic.size > 0,
  extract(_data, index) {
    return {
      totalEyes: index.eyesUfg.size + index.eyesClassic.size,
      ufgEyes: index.eyesUfg.size,
      classicEyes: index.eyesClassic.size,
      baseSessions: index.eyesBase.size,
      closedSessions: index.closes.size,
      resultsFetched: index.eyesHasResultsBase.size,
      deletedSessionIds: Array.from(index.deletedSessionIds),
      resultsOnlyEyes: Array.from(index.eyesResultsOnly)
    };
  },
  summarize(p) {
    return {
      oneLine: `${p.totalEyes} eyes (${p.ufgEyes} UFG, ${p.classicEyes} classic); ${p.resultsFetched} with results; ${p.deletedSessionIds.length} deleted`,
      count: p.totalEyes,
      severity: "info",
      ufgEyes: p.ufgEyes,
      classicEyes: p.classicEyes,
      baseSessions: p.baseSessions,
      closedSessions: p.closedSessions,
      resultsFetched: p.resultsFetched,
      deletedSessions: p.deletedSessionIds.length,
      resultsOnlyEyes: p.resultsOnlyEyes.length
    };
  }
};
function parseExplicitErrorLog(logLine) {
  let component = "Unknown";
  let label = "";
  let timestamp = "Unknown";
  let level = "ERROR";
  let message = logLine;
  try {
    const errorMatch = logLine.match(/\[([^\]]+)\]/);
    if (errorMatch && (errorMatch[1] === "ERROR" || errorMatch[1] === "FATAL" || errorMatch[1] === "WARN")) {
      level = errorMatch[1];
      const levelIndex = logLine.indexOf(`[${level}]`);
      const beforeLevel = logLine.substring(0, levelIndex).trim();
      message = logLine.substring(levelIndex + level.length + 2).trim();
      const pipeIndex = beforeLevel.indexOf("|");
      let beforeTimestamp;
      let timestampPart;
      if (pipeIndex > 0) {
        beforeTimestamp = beforeLevel.substring(0, pipeIndex).trim();
        timestampPart = beforeLevel.substring(pipeIndex + 1).trim();
      } else {
        const timestampMatch = beforeLevel.match(
          /^(.+?)\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\d]*Z?)$/
        );
        if (timestampMatch) {
          beforeTimestamp = timestampMatch[1].trim();
          timestampPart = timestampMatch[2];
        } else {
          beforeTimestamp = beforeLevel;
          timestampPart = "";
        }
      }
      const labelMatch = beforeTimestamp.match(/^([^\s(]+)\s*\(([^)]+)\)$/);
      if (labelMatch) {
        component = labelMatch[1];
        label = labelMatch[2];
      } else {
        component = beforeTimestamp || "Unknown";
      }
      if (timestampPart) {
        timestamp = timestampPart;
      }
      return { component, label, timestamp, level, message };
    }
  } catch {
  }
  return null;
}
const TRUNCATE = 240;
function truncate(s) {
  return s.length > TRUNCATE ? s.slice(0, TRUNCATE) + "…" : s;
}
function collect(nodes, match, topN) {
  const out = [];
  outer: for (const [contextKey, node] of nodes) {
    if (!node.logs) continue;
    for (const line of node.logs) {
      if (!line.includes(match)) continue;
      const parsed = parseExplicitErrorLog(line);
      if (parsed && (parsed.level === match.replace(/[\\[\]]/g, "") || true)) {
        out.push({
          level: parsed.level,
          component: parsed.component,
          label: parsed.label,
          timestamp: parsed.timestamp,
          message: truncate(parsed.message),
          contextKey
        });
      } else {
        out.push({
          level: match.replace(/[\\[\]]/g, ""),
          component: "Unknown",
          label: "",
          timestamp: "",
          message: truncate(line),
          contextKey
        });
      }
      if (out.length >= topN) break outer;
    }
  }
  return out;
}
const mod$8 = {
  id: "errorAnalysis",
  title: "Error Analysis",
  isPresent: (_data, index) => index.fatalNodes.length + index.errorNodes.length + index.warnNodes.length > 0,
  extract(_data, index, opts) {
    const topN = opts?.topN ?? 5;
    return {
      sampleFatal: collect(index.fatalNodes, "[FATAL]", topN),
      sampleErrors: collect(index.errorNodes, "[ERROR]", topN),
      sampleWarnings: collect(index.warnNodes, "[WARN]", topN),
      totalFatal: index.fatalNodes.length,
      totalErrors: index.errorNodes.length,
      totalWarnings: index.warnNodes.length
    };
  },
  summarize(p) {
    let severity = "info";
    if (p.totalFatal > 0) severity = "fatal";
    else if (p.totalErrors > 0) severity = "error";
    else if (p.totalWarnings > 0) severity = "warn";
    return {
      oneLine: `${p.totalFatal} fatal, ${p.totalErrors} errors, ${p.totalWarnings} warnings`,
      count: p.totalFatal + p.totalErrors + p.totalWarnings,
      severity,
      totalFatal: p.totalFatal,
      totalErrors: p.totalErrors,
      totalWarnings: p.totalWarnings,
      topFatal: p.sampleFatal,
      topErrors: p.sampleErrors,
      topWarnings: p.sampleWarnings
    };
  }
};
function sanitizeNodeInspectTokens(s) {
  return s.replace(/<ref \*\d+>\s*/g, "").replace(/\[(?:Async|Generator)?Function(?:\s+\([^)]*\))?(?:\s*:\s*[^\]]+)?\]/g, "null").replace(/\[Circular(?:\s*\*\d+)?\]/g, "null").replace(/\[Symbol\([^\]]*\)\]/g, "null").replace(/\[(?:Getter|Setter|Getter\/Setter)\]/g, "null").replace(/\[(?:Map|Set|WeakMap|WeakSet|Object|Array|ArrayBuffer)\]/g, "null").replace(/\bNaN\b/g, "null").replace(/-?\bInfinity\b/g, "null");
}
function parseLooseObject(src) {
  if (typeof src !== "string" || !src.trim()) return null;
  let s = sanitizeNodeInspectTokens(src.trim());
  const opener = s[0];
  if (opener === "{" || opener === "[") {
    const closer = opener === "{" ? "}" : "]";
    let depth = 0;
    let inString = null;
    let escape = false;
    let endIdx = -1;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inString) {
        if (ch === "\\") escape = true;
        else if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
        continue;
      }
      if (ch === opener) depth++;
      else if (ch === closer) {
        depth--;
        if (depth === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
    if (endIdx > 0) s = s.slice(0, endIdx);
  }
  const normalized = s.replace(/'((?:\\.|[^'\\])*)'/g, (_m, inner) => {
    const unescaped = inner.replace(/\\'/g, "'");
    const reEscaped = unescaped.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${reEscaped}"`;
  }).replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":').replace(/\bundefined\b/g, "null").replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}
const parseOrThrow = (src) => {
  const r = parseLooseObject(src);
  if (r === null || r === void 0) throw new Error("Failed to parse log object literal");
  return r;
};
function sliceFromMarker(node, marker) {
  const logs = node.logs;
  if (!Array.isArray(logs) || logs.length === 0) return null;
  const joined = logs.join("\n");
  const idx = joined.indexOf(marker);
  return idx === -1 ? null : joined.substring(idx + marker.length - 1);
}
function findAgentSdk(data) {
  for (const [, node] of searchLogs(data, "Core is initialized")) {
    if (!Array.isArray(node.logs)) continue;
    for (const line of node.logs) {
      const m = line.match(/for agent ([^/]+\/[^/]+\/([^/\s]+)\/([^\s]+))/);
      if (m) return { name: m[2], version: m[3] };
    }
  }
  return null;
}
function findCoreInitSdkObject(data) {
  for (const [, node] of searchLogs(data, "Core is initialized")) {
    const slice = sliceFromMarker(node, "Core is initialized");
    if (!slice) continue;
    const objStart = slice.indexOf("{");
    if (objStart === -1) continue;
    try {
      const parsed = parseOrThrow(slice.substring(objStart));
      if (parsed?.sdk?.name) return parsed;
    } catch {
    }
  }
  return null;
}
function findCoreUniversalSdk(data) {
  for (const [, node] of searchLogs(data, "Core universal is going to be initialized")) {
    const slice = sliceFromMarker(node, "Core universal is going to be initialized with options ");
    if (!slice) continue;
    const objStart = slice.indexOf("{");
    if (objStart === -1) continue;
    try {
      const parsed = parseOrThrow(slice.substring(objStart));
      const sdk = parsed?.defaultEnvironment?.sdk;
      if (sdk?.name) return sdk;
    } catch {
    }
  }
  return null;
}
function extractRawSdkData(data) {
  let sdkData = null;
  const logEventLogs = searchLogs(data, "logEvent");
  if (logEventLogs.length > 0) {
    try {
      const settingsJson = sliceFromMarker(logEventLogs[0][1], "with settings [");
      if (settingsJson) {
        const settings = parseOrThrow(settingsJson);
        const candidate = settings?.[0];
        if (candidate?.event?.environment?.sdk?.name) {
          sdkData = candidate;
        }
      }
    } catch (e) {
      console.warn("Failed to parse logEvent settings:", e);
    }
  }
  if (!sdkData) {
    const makeManagerLogs = searchLogs(data, "makeManager");
    if (makeManagerLogs.length > 0) {
      try {
        const settingsJson = sliceFromMarker(makeManagerLogs[0][1], "with settings {");
        if (settingsJson) {
          const settings = parseOrThrow(settingsJson);
          let sdkName = "Unknown";
          let sdkVersion = "Unknown";
          let resolvedSdkBlock = null;
          if (settings.sdk?.name) {
            sdkName = settings.sdk.name;
            sdkVersion = settings.sdk.currentVersion || settings.sdk.version || "Unknown";
            resolvedSdkBlock = settings.sdk;
          } else {
            const universal = findCoreUniversalSdk(data);
            if (universal?.name) {
              sdkName = universal.name;
              sdkVersion = universal.currentVersion || universal.version || "Unknown";
              resolvedSdkBlock = universal;
            } else {
              const initObj = findCoreInitSdkObject(data);
              if (initObj?.sdk?.name) {
                sdkName = initObj.sdk.name;
                sdkVersion = initObj.sdk.currentVersion || initObj.sdk.version || "Unknown";
                resolvedSdkBlock = initObj.sdk;
              } else {
                const agent = findAgentSdk(data);
                if (agent) {
                  sdkName = agent.name;
                  sdkVersion = agent.version;
                }
              }
            }
          }
          if ((!sdkName || sdkName === "Unknown") && settings.agentId) {
            const parts = String(settings.agentId).split("/");
            sdkName = parts[0] || "Unknown";
            sdkVersion = parts[1] || "Unknown";
          }
          if (sdkName !== "Unknown" || settings.agentId) {
            sdkData = {
              agentId: settings.agentId,
              event: {
                environment: {
                  sdk: {
                    name: sdkName,
                    currentVersion: sdkVersion,
                    ...resolvedSdkBlock && {
                      ...resolvedSdkBlock,
                      name: sdkName,
                      currentVersion: sdkVersion
                    }
                  }
                },
                concurrency: settings.concurrency
              }
            };
          }
        }
      } catch (e) {
        console.warn("Failed to parse makeManager settings:", e);
      }
    }
  }
  if (!sdkData) {
    const universal = findCoreUniversalSdk(data);
    if (universal?.name) {
      sdkData = {
        event: {
          environment: {
            sdk: {
              name: universal.name,
              currentVersion: universal.currentVersion || universal.version || "Unknown",
              ...universal
            }
          }
        }
      };
    }
  }
  if (!sdkData) {
    const initObj = findCoreInitSdkObject(data);
    if (initObj?.sdk?.name) {
      sdkData = {
        event: {
          environment: {
            sdk: {
              name: initObj.sdk.name,
              currentVersion: initObj.sdk.currentVersion || initObj.sdk.version || "Unknown",
              ...initObj.sdk
            }
          }
        }
      };
    }
  }
  if (!sdkData) {
    const agent = findAgentSdk(data);
    if (agent) {
      sdkData = {
        event: {
          environment: { sdk: { name: agent.name, currentVersion: agent.version } }
        }
      };
    }
  }
  return sdkData;
}
function extractCoreMetadata(data) {
  const coreInitLogs = searchLogs(data, "Core is initialized");
  if (coreInitLogs.length === 0) return null;
  try {
    for (const [, logData] of coreInitLogs) {
      if (!logData?.logs) continue;
      const logsText = logData.logs.join("\n");
      if (logsText.includes("{")) {
        try {
          const objStart = logsText.indexOf("{");
          const objJson = logsText.substring(objStart);
          const coreData = parseOrThrow(objJson);
          if (coreData.versions || coreData.platform) {
            return {
              versions: coreData.versions || null,
              platform: coreData.platform || null,
              arch: coreData.arch || null,
              ram: coreData.ram || null,
              ci: coreData.ci || null
            };
          }
        } catch {
        }
      }
      const versionMatch = logsText.match(
        /versions:\s*\{\s*core:\s*['"]([^'"]+)['"],?\s*node:\s*['"]([^'"]+)['"]/
      );
      const platformMatch = logsText.match(/platform:\s*['"]([^'"]+)['"]/);
      const archMatch = logsText.match(/arch:\s*['"]([^'"]+)['"]/);
      const ramMatch = logsText.match(/ram:\s*(\d+)/);
      const ciMatch = logsText.match(/ci:\s*(null|['"][^'"]*['"])/);
      if (versionMatch || platformMatch) {
        return {
          versions: versionMatch ? { core: versionMatch[1], node: versionMatch[2] } : null,
          platform: platformMatch ? platformMatch[1] : null,
          arch: archMatch ? archMatch[1] : null,
          ram: ramMatch ? parseInt(ramMatch[1], 10) : null,
          ci: ciMatch && ciMatch[1] !== "null" ? ciMatch[1].replace(/['"]/g, "") : null
        };
      }
    }
  } catch (e) {
    console.warn("Failed to parse Core metadata:", e);
  }
  return null;
}
function extractDriverCapabilities(data) {
  const driverCapabilitiesLogs = searchLogs(data, "Extracted driver capabilities");
  if (driverCapabilitiesLogs.length === 0) return null;
  try {
    for (const [, logData] of driverCapabilitiesLogs) {
      if (!logData?.logs) continue;
      const logsText = logData.logs.join("\n");
      const deviceNameMatch = logsText.match(/deviceName:\s*['"]([^'"]+)['"]/);
      const platformNameMatch = logsText.match(/platformName:\s*['"]([^'"]+)['"]/);
      const platformVersionMatch = logsText.match(/platformVersion:\s*['"]([^'"]+)['"]/);
      const automationNameMatch = logsText.match(/automationName:\s*['"]([^'"]+)['"]/);
      const orientationMatch = logsText.match(/orientation:\s*['"]([^'"]+)['"]/);
      const browserNameMatch = logsText.match(/browserName:\s*['"]([^'"]+)['"]/);
      const udidMatch = logsText.match(/udid:\s*['"]([^'"]+)['"]/);
      if (deviceNameMatch || platformNameMatch) {
        return {
          deviceName: deviceNameMatch ? deviceNameMatch[1] : null,
          platformName: platformNameMatch ? platformNameMatch[1] : null,
          platformVersion: platformVersionMatch ? platformVersionMatch[1] : null,
          automationName: automationNameMatch ? automationNameMatch[1] : null,
          orientation: orientationMatch ? orientationMatch[1] : null,
          browserName: browserNameMatch && browserNameMatch[1] ? browserNameMatch[1] : null,
          udid: udidMatch ? udidMatch[1] : null
        };
      }
    }
  } catch (e) {
    console.warn("Failed to parse driver capabilities:", e);
  }
  return null;
}
const SENSITIVE_KEYS = /* @__PURE__ */ new Set(["apiKey", "accessToken"]);
function redactSensitive(obj) {
  if (typeof obj === "string") {
    return obj.replace(/([?&])(accessKey|apiKey|sig|se|sv|sp|sr)=[^&"'\s]*/g, "$1$2=[redacted]");
  }
  if (Array.isArray(obj)) return obj.map(redactSensitive);
  if (obj !== null && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = SENSITIVE_KEYS.has(k) ? "[redacted]" : redactSensitive(v);
    }
    return out;
  }
  return obj;
}
function extractAccountInfo(data) {
  const MARKER = 'Request "getAccountInfo" finished successfully with body ';
  for (const [, node] of searchLogs(data, "finished successfully with body")) {
    const slice = sliceFromMarker(node, MARKER);
    if (!slice) continue;
    const objStart = slice.indexOf("{");
    if (objStart === -1) continue;
    try {
      const parsed = parseLooseObject(slice.substring(objStart));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const p = parsed;
        if (p.uploadUrl || p.ufgServer || p.supportedEnvironmentsUrl) {
          return redactSensitive(p);
        }
      }
    } catch {
    }
  }
  return null;
}
function extractGeneralInfo(data) {
  let sdkData = extractRawSdkData(data);
  const coreMetadata = extractCoreMetadata(data);
  const driverCapabilities = extractDriverCapabilities(data);
  const nmlInfo = extractNMLInfo(data);
  const accountInfo = extractAccountInfo(data);
  if (!sdkData && (coreMetadata || driverCapabilities)) {
    sdkData = {
      event: {
        environment: {
          sdk: { name: "Unknown", currentVersion: coreMetadata?.versions?.core || "Unknown" }
        }
      }
    };
  }
  return { sdkData, coreMetadata, driverCapabilities, nmlInfo, accountInfo };
}
const mod$7 = {
  id: "generalInfo",
  title: "General Information",
  isPresent: () => true,
  extract(data, index) {
    const sd = data;
    const { sdkData, coreMetadata, driverCapabilities, nmlInfo, accountInfo } = extractGeneralInfo(sd);
    const managers = index.managersUfg.size + index.managersClassic.size;
    const eyes = index.eyesUfg.size + index.eyesClassic.size;
    const environments = index.environments.size;
    let sdkSummary = null;
    if (sdkData) {
      const sdk = sdkData.event?.environment?.sdk ?? {};
      sdkSummary = {
        name: sdk.name || "Unknown",
        version: sdk.currentVersion || sdk.version || "Unknown",
        agentId: sdkData.agentId,
        concurrency: sdkData.event?.concurrency
      };
    }
    return {
      time: typeof data.time === "number" ? data.time : void 0,
      startedAt: typeof data.startedAt === "number" ? data.startedAt : void 0,
      testStructure: {
        userTests: managers,
        testInstances: eyes,
        checkPhases: index.checks.size,
        environments,
        avgEnvsPerUserTest: managers > 0 ? environments / managers : 0
      },
      sdk: sdkSummary,
      coreMetadata,
      driver: driverCapabilities,
      nml: nmlInfo ? {
        libraryVersion: nmlInfo.libraryVersion,
        protocolVersion: nmlInfo.protocolVersion,
        deviceOs: nmlInfo.device?.os,
        deviceModel: nmlInfo.device?.model
      } : null,
      accountInfo
    };
  },
  summarize(p) {
    const sdkLabel = p.sdk ? `${p.sdk.name}@${p.sdk.version}` : "Unknown SDK";
    const platform = p.coreMetadata?.platform ?? p.driver?.platformName ?? "unknown platform";
    const eyesServerUrl = p.accountInfo?.eyesServer?.eyesServerUrl;
    const accountHost = eyesServerUrl ? new URL(eyesServerUrl).hostname : null;
    let accountSummary = null;
    if (p.accountInfo) {
      const a = p.accountInfo;
      const eyesServer = a.eyesServer;
      const ufgServer = a.ufgServer;
      const concurrency = a.serverConcurrency;
      accountSummary = {
        ...eyesServer?.eyesServerUrl && { eyesServerUrl: eyesServer.eyesServerUrl },
        ...ufgServer?.ufgServerUrl && { ufgServerUrl: ufgServer.ufgServerUrl },
        ...concurrency?.sessionConcurrency != null && {
          sessionConcurrency: concurrency.sessionConcurrency
        },
        ...a.rcaEnabled != null && { rcaEnabled: a.rcaEnabled },
        ...a.selfHealingEnabled != null && { selfHealingEnabled: a.selfHealingEnabled },
        ...a.ecEnabled != null && { ecEnabled: a.ecEnabled },
        ...a.maxImageHeight != null && { maxImageHeight: a.maxImageHeight }
      };
    }
    return {
      oneLine: `${sdkLabel} on ${platform}; ${p.testStructure.userTests} user test(s)${accountHost ? `; account: ${accountHost}` : ""}`,
      count: p.testStructure.userTests,
      severity: "info",
      sdk: p.sdk,
      testStructure: p.testStructure,
      coreMetadata: p.coreMetadata,
      driver: p.driver,
      nml: p.nml,
      accountInfo: accountSummary
    };
  }
};
const mod$6 = {
  id: "resourceUploads",
  title: "Resource Uploads",
  isPresent(data, index) {
    if (index.uploadNodes.length > 0) return true;
    const sd = data;
    return searchLogs(sd, "blob.core.windows.net").length > 0 || searchLogs(sd, "eyestestwusi0").length > 0;
  },
  extract(data, index, opts) {
    const topN = opts?.topN ?? 5;
    const sd = data;
    const blobs = [...searchLogs(sd, "blob.core.windows.net"), ...searchLogs(sd, "eyestestwusi0")];
    const samples = [];
    for (const [, node] of index.uploadNodes) {
      if (samples.length >= topN) break;
      const line = node.logs?.find((l) => l.includes("Upload called for"));
      if (line) samples.push(line.length > 200 ? line.slice(0, 200) + "…" : line);
    }
    return {
      uploadCount: index.uploadNodes.length,
      blobReferences: blobs.length,
      sampleNodes: index.uploadNodes.slice(0, topN).map(([k]) => k),
      sampleLines: samples
    };
  },
  summarize(p) {
    return {
      oneLine: `${p.uploadCount} upload call(s); ${p.blobReferences} blob storage reference(s)`,
      count: p.uploadCount,
      severity: "info",
      sampleNodes: p.sampleNodes,
      sampleLines: p.sampleLines
    };
  }
};
function extractTimestamp(logLine) {
  const timestampMatch = logLine.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
  return timestampMatch ? new Date(timestampMatch[1]) : null;
}
function parsePartInfo(logLine) {
  const partMatch = logLine.match(/Processing part (\d+_\d+_\d+x\d+)/);
  if (!partMatch) return null;
  const partId = partMatch[1];
  const indexMatch = partId.match(/^(\d+)_/);
  const index = indexMatch ? parseInt(indexMatch[1], 10) : 0;
  return { id: partId, index };
}
function parseScrollPosition(logLine) {
  const scrollMatch = logLine.match(/Move to \{ x: (\d+), y: (\d+) \}/);
  if (!scrollMatch) return null;
  return {
    x: parseInt(scrollMatch[1], 10),
    y: parseInt(scrollMatch[2], 10)
  };
}
function parseCropRegion(logLine) {
  const cropMatch = logLine.match(
    /cropPartRegion is \{ x: (\d+), y: (\d+), width: (\d+), height: (\d+) \}/
  );
  if (!cropMatch) return null;
  return {
    x: parseInt(cropMatch[1], 10),
    y: parseInt(cropMatch[2], 10),
    width: parseInt(cropMatch[3], 10),
    height: parseInt(cropMatch[4], 10)
  };
}
function parseActualOffset(logLine) {
  const offsetMatch = logLine.match(
    /Actual offset is \{ x: (\d+), y: (\d+) \}\s*,\s*remaining offset is \{ x: (\d+), y: (\d+) \}/
  );
  if (!offsetMatch) return null;
  return {
    actual: {
      x: parseInt(offsetMatch[1], 10),
      y: parseInt(offsetMatch[2], 10)
    },
    remaining: {
      x: parseInt(offsetMatch[3], 10),
      y: parseInt(offsetMatch[4], 10)
    }
  };
}
function parseViewportSize(logs) {
  for (const line of logs) {
    const viewportMatch = line.match(/Extracted viewport size \{ height: (\d+), width: (\d+) \}/);
    if (viewportMatch) {
      return {
        height: parseInt(viewportMatch[1], 10),
        width: parseInt(viewportMatch[2], 10)
      };
    }
  }
  return null;
}
function parseScrollerSize(logs) {
  for (const line of logs) {
    const scrollerMatch = line.match(
      /Scroller size: \{ x: \d+, y: \d+, width: (\d+), height: (\d+) \}/
    );
    if (scrollerMatch) {
      return {
        width: parseInt(scrollerMatch[1], 10),
        height: parseInt(scrollerMatch[2], 10)
      };
    }
  }
  return null;
}
function parseStitchMode(logs) {
  for (const line of logs) {
    const stitchModeMatch = line.match(/stitchMode:\s*'([^']+)'/);
    if (stitchModeMatch) {
      return stitchModeMatch[1];
    }
  }
  return "Unknown";
}
function extractRawSettings(logs) {
  let inSettingsBlock = false;
  const settingsLines = [];
  let braceDepth = 0;
  for (const line of logs) {
    if (line.includes('Command "check" is called with settings {')) {
      inSettingsBlock = true;
      const startIndex = line.indexOf("settings {");
      if (startIndex !== -1) {
        const settingsPart = line.substring(startIndex + "settings ".length);
        settingsLines.push(settingsPart);
        braceDepth = 1;
      }
      continue;
    }
    if (inSettingsBlock) {
      for (const char of line) {
        if (char === "{") braceDepth++;
        if (char === "}") braceDepth--;
      }
      settingsLines.push(line.trim());
      if (braceDepth === 0) {
        break;
      }
    }
  }
  return settingsLines.length > 0 ? settingsLines.join("\n") : void 0;
}
function parseConfig(logs) {
  const config = {};
  for (const line of logs) {
    const waitBeforeCaptureMatch = line.match(/waitBeforeCapture:\s*(\d+)/);
    if (waitBeforeCaptureMatch) {
      config.waitBeforeCapture = parseInt(waitBeforeCaptureMatch[1], 10);
    }
    const waitBetweenStitchesMatch = line.match(/waitBetweenStitches:\s*(\d+)/);
    if (waitBetweenStitchesMatch) {
      config.waitBetweenStitches = parseInt(waitBetweenStitchesMatch[1], 10);
    }
    const retryTimeoutMatch = line.match(/retryTimeout:\s*(\d+)/);
    if (retryTimeoutMatch) {
      config.retryTimeout = parseInt(retryTimeoutMatch[1], 10);
    }
    const stepIndexMatch = line.match(/stepIndex:\s*(\d+)/);
    if (stepIndexMatch) {
      config.stepIndex = parseInt(stepIndexMatch[1], 10);
    }
    const hideScrollbarsMatch = line.match(/hideScrollbars:\s*(true|false)/);
    if (hideScrollbarsMatch) {
      config.hideScrollbars = hideScrollbarsMatch[1] === "true";
    }
    const hideCaretMatch = line.match(/hideCaret:\s*(true|false)/);
    if (hideCaretMatch) {
      config.hideCaret = hideCaretMatch[1] === "true";
    }
    const matchLevelMatch = line.match(/matchLevel:\s*'([^']+)'/);
    if (matchLevelMatch) {
      config.matchLevel = matchLevelMatch[1];
    }
    const ignoreCaretMatch = line.match(/ignoreCaret:\s*(true|false)/);
    if (ignoreCaretMatch) {
      config.ignoreCaret = ignoreCaretMatch[1] === "true";
    }
    const sendDomMatch = line.match(/sendDom:\s*(true|false)/);
    if (sendDomMatch) {
      config.sendDom = sendDomMatch[1] === "true";
    }
    const useDomMatch = line.match(/useDom:\s*(true|false)/);
    if (useDomMatch) {
      config.useDom = useDomMatch[1] === "true";
    }
    const lazyLoadObjectMatch = line.match(
      /lazyLoad:\s*\{\s*scrollLength:\s*(\d+),\s*waitingTime:\s*(\d+),\s*maxAmountToScroll:\s*(\d+)\s*\}/
    );
    if (lazyLoadObjectMatch) {
      config.lazyLoad = {
        scrollLength: parseInt(lazyLoadObjectMatch[1], 10),
        waitingTime: parseInt(lazyLoadObjectMatch[2], 10),
        maxAmountToScroll: parseInt(lazyLoadObjectMatch[3], 10)
      };
    } else {
      const lazyLoadBoolMatch = line.match(/lazyLoad:\s*(true|false)/);
      if (lazyLoadBoolMatch) {
        config.lazyLoad = lazyLoadBoolMatch[1] === "true";
      }
    }
    const autProxyMatch = line.match(/autProxy:\s*(true|false|undefined)/);
    if (autProxyMatch && autProxyMatch[1] !== "undefined") {
      config.autProxy = autProxyMatch[1] === "true";
    }
    const overlapMatch = line.match(/overlap:\s*\{\s*top:\s*(\d+),\s*bottom:\s*(\d+)\s*\}/);
    if (overlapMatch) {
      config.overlap = {
        top: parseInt(overlapMatch[1], 10),
        bottom: parseInt(overlapMatch[2], 10)
      };
    }
    const normalizationMatch = line.match(/normalization:\s*\{([^}]*)\}/);
    if (normalizationMatch) {
      const normContent = normalizationMatch[1];
      if (normContent.trim()) {
        const limitMatch = normContent.match(
          /limit:\s*\{\s*maxImageHeight:\s*(\d+),\s*maxImageArea:\s*(\d+)\s*\}/
        );
        if (limitMatch) {
          config.normalization = {
            limit: {
              maxImageHeight: parseInt(limitMatch[1], 10),
              maxImageArea: parseInt(limitMatch[2], 10)
            }
          };
        }
      } else {
        config.normalization = {};
      }
    }
    const fullyMatch = line.match(/fully:\s*(true|false)/);
    if (fullyMatch) {
      config.fully = fullyMatch[1] === "true";
    }
    const nameMatch = line.match(/name:\s*'([^']+)'/);
    if (nameMatch) {
      config.name = nameMatch[1];
    }
  }
  return config;
}
function parseStitchParts(logs) {
  const parts = [];
  let currentPart = null;
  let currentPartLogs = [];
  let scrollCompleteTime;
  let screenshotStartTime;
  let screenshotEndTime;
  for (let i = 0; i < logs.length; i++) {
    const line = logs[i];
    const timestamp = extractTimestamp(line);
    const partInfo = parsePartInfo(line);
    if (partInfo) {
      if (currentPart && currentPart.id) {
        if (currentPart.endTime && timestamp) {
          currentPart.timingBreakdown.cropTime = timestamp.getTime() - currentPart.endTime.getTime();
        }
        currentPart.rawLogs = currentPartLogs;
        parts.push(currentPart);
      }
      currentPart = {
        id: partInfo.id,
        index: partInfo.index,
        startTime: timestamp ?? void 0,
        scrollPosition: { x: 0, y: 0 },
        cropRegion: { x: 0, y: 0, width: 0, height: 0 },
        timingBreakdown: {}
      };
      currentPartLogs = [line];
      scrollCompleteTime = void 0;
      screenshotStartTime = void 0;
      screenshotEndTime = void 0;
      continue;
    }
    if (currentPart) {
      currentPartLogs.push(line);
    }
    const scrollPos = parseScrollPosition(line);
    if (scrollPos && currentPart) {
      currentPart.scrollPosition = scrollPos;
    }
    const actualOffset = parseActualOffset(line);
    if (actualOffset && currentPart) {
      currentPart.actualOffset = actualOffset.actual;
      currentPart.remainingOffset = actualOffset.remaining;
      scrollCompleteTime = timestamp ?? void 0;
      if (currentPart.startTime && scrollCompleteTime) {
        currentPart.timingBreakdown.scrollTime = scrollCompleteTime.getTime() - currentPart.startTime.getTime();
      }
    }
    const cropRegion = parseCropRegion(line);
    if (cropRegion && currentPart) {
      currentPart.cropRegion = cropRegion;
    }
    if (line.includes("Taking screenshot")) {
      screenshotStartTime = timestamp ?? void 0;
    }
    if (line.includes("cropping...") && currentPart && currentPart.startTime) {
      screenshotEndTime = timestamp ?? void 0;
      if (screenshotStartTime && screenshotEndTime) {
        currentPart.timingBreakdown.screenshotTime = screenshotEndTime.getTime() - screenshotStartTime.getTime();
      }
      currentPart.endTime = timestamp ?? void 0;
      if (currentPart.endTime) {
        currentPart.duration = currentPart.endTime.getTime() - currentPart.startTime.getTime();
        currentPart.timingBreakdown.totalTime = currentPart.duration;
      }
    }
    if (line.includes("restoring scroller state") && currentPart && currentPart.endTime) {
      if (!currentPart.timingBreakdown.cropTime && timestamp) {
        currentPart.timingBreakdown.cropTime = timestamp.getTime() - currentPart.endTime.getTime();
      }
    }
  }
  if (currentPart && currentPart.id) {
    currentPart.rawLogs = currentPartLogs;
    parts.push(currentPart);
  }
  return parts;
}
function extractClassicCheckData(data) {
  const classicChecks = [];
  const checkObjects = searchObjects(data, "check-classic");
  for (const [checkId, checkData] of checkObjects) {
    if (!checkData.logs || !Array.isArray(checkData.logs)) continue;
    const logs = checkData.logs;
    let context = "Unknown";
    const contextMatch = logs[0]?.match(/^([^|]+)\s+\|/);
    if (contextMatch) {
      context = contextMatch[1].trim();
    }
    const viewport = parseViewportSize(logs) ?? { width: 0, height: 0 };
    const scrollerSize = parseScrollerSize(logs) ?? { width: 0, height: 0 };
    const stitchMode = parseStitchMode(logs);
    const config = parseConfig(logs);
    const parts = parseStitchParts(logs);
    const rawSettings = extractRawSettings(logs);
    const startTime = parts[0]?.startTime;
    const endTime = parts[parts.length - 1]?.endTime;
    const totalDuration = startTime && endTime ? endTime.getTime() - startTime.getTime() : void 0;
    classicChecks.push({
      id: checkId,
      context,
      stitchMode,
      viewport,
      scrollerSize,
      parts,
      config,
      startTime,
      endTime,
      totalDuration,
      rawLogs: logs,
      rawSettings
    });
  }
  return classicChecks;
}
function summarizeCheck(c) {
  const totalDurationMs = c.parts.reduce((acc, p) => acc + (p.duration ?? 0), 0);
  return {
    id: c.id,
    context: c.context,
    stitchMode: c.stitchMode,
    viewport: c.viewport,
    scrollerSize: c.scrollerSize,
    partCount: c.parts.length,
    totalDurationMs
  };
}
const mod$5 = {
  id: "classicCheck",
  title: "Classic Check Analysis",
  isPresent: (data) => extractClassicCheckData(data).length > 0,
  extract(data, _index, opts) {
    const all = extractClassicCheckData(data);
    const topN = opts?.topN ?? 10;
    const limited = all.slice(0, topN);
    return {
      checks: limited.map(summarizeCheck),
      totalChecks: all.length,
      totalParts: all.reduce((acc, c) => acc + c.parts.length, 0)
    };
  },
  summarize(p) {
    return {
      oneLine: `${p.totalChecks} classic check(s) with ${p.totalParts} stitch part(s)`,
      count: p.totalChecks,
      severity: "info",
      checks: p.checks,
      totalParts: p.totalParts
    };
  }
};
function safeParseConfig(configStr) {
  try {
    const trimmed = configStr.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return null;
    }
    const jsonified = trimmed.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":').replace(/:\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*([,}])/g, ':"$1"$2').replace(/:\s*true\s*([,}])/g, ":true$1").replace(/:\s*false\s*([,}])/g, ":false$1").replace(/:\s*null\s*([,}])/g, ":null$1").replace(/:\s*(\d+)\s*([,}])/g, ":$1$2");
    const parsed = JSON.parse(jsonified);
    return parsed;
  } catch {
    return null;
  }
}
function extractBalancedBracesContent(lines, startIndex) {
  const settingsLine = lines[startIndex];
  const braceIndex = settingsLine.indexOf("{");
  if (braceIndex === -1) {
    return null;
  }
  const configLines = [settingsLine.substring(braceIndex)];
  let braceCount = (settingsLine.match(/{/g) || []).length - (settingsLine.match(/}/g) || []).length;
  let lineIndex = startIndex + 1;
  while (braceCount > 0 && lineIndex < lines.length) {
    const line = lines[lineIndex];
    configLines.push(line);
    braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
    lineIndex++;
  }
  return braceCount === 0 ? configLines.join("\n") : null;
}
function createPerformanceConfig(configData) {
  return {
    lazyLoad: configData.lazyLoad,
    waitBeforeCapture: configData.waitBeforeCapture || 0,
    layoutBreakpoints: configData.layoutBreakpoints,
    concurrency: configData.event?.concurrency || configData.concurrency || 1,
    environments: configData.environments || [],
    testName: configData.name || "Unknown",
    useDom: configData.useDom,
    enablePatterns: configData.enablePatterns,
    ignoreDisplacements: configData.ignoreDisplacements,
    hooks: configData.hooks,
    disableBrowserFetching: configData.disableBrowserFetching
  };
}
function extractAllPerformanceConfigs(data) {
  try {
    const allConfigs = [];
    let totalCheckOperations = 0;
    const checkCommands = searchLogs(data, 'Command "check" is called with settings');
    const checkAndCloseCommands = searchLogs(
      data,
      'Command "checkAndClose" is called with settings'
    );
    const allCheckCommands = [...checkCommands, ...checkAndCloseCommands];
    totalCheckOperations = allCheckCommands.length;
    for (const checkCommand of allCheckCommands) {
      try {
        const logLines = checkCommand[1]?.logs || [];
        const lines = logLines;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('Command "check" is called with settings') || lines[i].includes('Command "checkAndClose" is called with settings')) {
            try {
              const configStr = extractBalancedBracesContent(lines, i);
              if (configStr) {
                const config = safeParseConfig(configStr);
                if (config) {
                  allConfigs.push(createPerformanceConfig(config));
                  break;
                }
              }
            } catch {
            }
          }
        }
      } catch {
      }
    }
    if (allConfigs.length === 0) {
      const logEvents = searchLogs(data, "logEvent");
      if (logEvents.length > 0) {
        try {
          const logLine = logEvents[0]?.[1].logs?.[0];
          if (logLine && typeof logLine === "string") {
            const settingsPart = logLine.split("with settings ")[1];
            if (settingsPart) {
              const sdkData = safeParseConfig(settingsPart.split("[")[0]);
              if (sdkData) {
                allConfigs.push({
                  ...createPerformanceConfig(sdkData),
                  testName: "From logEvent"
                });
              }
            }
          }
        } catch {
        }
      }
      if (allConfigs.length === 0) {
        const lazyLoadLogs = searchLogs(data, "lazyLoad");
        for (const logEntry of lazyLoadLogs) {
          try {
            const logLines = logEntry[1]?.logs || [];
            for (const logLine of logLines) {
              if (logLine.includes("scrollLength") && logLine.includes("waitingTime")) {
                const fullMatch = logLine.match(/{[\s\S]*lazyLoad[\s\S]*}/);
                if (fullMatch) {
                  try {
                    const config = safeParseConfig(fullMatch[0]);
                    if (config?.lazyLoad) {
                      allConfigs.push({
                        ...createPerformanceConfig(config),
                        testName: "From lazyLoad logs"
                      });
                      break;
                    }
                  } catch {
                  }
                }
              }
            }
            if (allConfigs.length > 0) break;
          } catch {
          }
        }
      }
    }
    return {
      configs: allConfigs,
      totalCheckOperations
    };
  } catch (error) {
    console.error("Error extracting performance configs:", error);
    return { configs: [], totalCheckOperations: 0 };
  }
}
function analyzeConfigurationVariations(allConfigs) {
  if (!allConfigs || allConfigs.length === 0) return null;
  const lazyLoadGroups = {};
  const waitBeforeCaptureGroups = {};
  const environmentGroups = {};
  const layoutBreakpointsGroups = {};
  const uniqueScreens = /* @__PURE__ */ new Set();
  allConfigs.forEach((config) => {
    if (config.lazyLoad) {
      const lazyKey = `${config.lazyLoad.scrollLength}-${config.lazyLoad.waitingTime}-${config.lazyLoad.maxAmountToScroll}`;
      lazyLoadGroups[lazyKey] = lazyLoadGroups[lazyKey] || { config: config.lazyLoad, count: 0 };
      lazyLoadGroups[lazyKey].count++;
    } else {
      lazyLoadGroups["none"] = lazyLoadGroups["none"] || { config: null, count: 0 };
      lazyLoadGroups["none"].count++;
    }
    const waitKey = (config.waitBeforeCapture || 0).toString();
    waitBeforeCaptureGroups[waitKey] = waitBeforeCaptureGroups[waitKey] || {
      value: config.waitBeforeCapture || 0,
      count: 0
    };
    waitBeforeCaptureGroups[waitKey].count++;
    const envKey = Object.entries(config.environments || {}).sort().map((keyVal) => keyVal.join("=")).join("|") || "none";
    environmentGroups[envKey] = environmentGroups[envKey] || {
      count: config.environments?.length || 0,
      occurrences: 0,
      exampleEnvironments: config.environments || []
    };
    environmentGroups[envKey].occurrences++;
    if (config.environments) {
      config.environments.forEach((env) => {
        if (env.width && env.height) {
          uniqueScreens.add(`${env.width}x${env.height}`);
        } else if (env.chromeEmulationInfo?.deviceName) {
          const orientation = env.chromeEmulationInfo.screenOrientation || "portrait";
          uniqueScreens.add(`chrome-${env.chromeEmulationInfo.deviceName}-${orientation}`);
        } else if (env.iosDeviceInfo?.deviceName) {
          const orientation = env.iosDeviceInfo.screenOrientation || "portrait";
          const version = env.iosDeviceInfo.version ? `-${env.iosDeviceInfo.version}` : "";
          uniqueScreens.add(`ios-${env.iosDeviceInfo.deviceName}${version}-${orientation}`);
        } else if (env.androidDeviceInfo?.deviceName) {
          const orientation = env.androidDeviceInfo.screenOrientation || "portrait";
          const version = env.androidDeviceInfo.version ? `-${env.androidDeviceInfo.version}` : "";
          uniqueScreens.add(`android-${env.androidDeviceInfo.deviceName}${version}-${orientation}`);
        }
      });
    }
    const layoutKey = config.layoutBreakpoints?.breakpoints ? "enabled" : "disabled";
    layoutBreakpointsGroups[layoutKey] = layoutBreakpointsGroups[layoutKey] || {
      enabled: Boolean(config.layoutBreakpoints?.breakpoints),
      count: 0
    };
    layoutBreakpointsGroups[layoutKey].count++;
  });
  return {
    lazyLoadGroups,
    waitBeforeCaptureGroups,
    environmentGroups,
    layoutBreakpointsGroups,
    uniqueScreens,
    totalConfigurations: allConfigs.length,
    uniqueConfigurations: Object.keys(lazyLoadGroups).length + Object.keys(waitBeforeCaptureGroups).length
  };
}
const mod$4 = {
  id: "performanceConfig",
  title: "Potential Check Settings Issues",
  isPresent(data) {
    const result = extractAllPerformanceConfigs(data);
    if (!result.configs.length) return false;
    return analyzeConfigurationVariations(result.configs) !== null;
  },
  extract(data) {
    const result = extractAllPerformanceConfigs(data);
    const variations = analyzeConfigurationVariations(result.configs);
    return {
      totalConfigs: result.configs.length,
      totalCheckOperations: result.totalCheckOperations,
      hasVariations: !!variations,
      lazyLoadGroupCount: variations ? Object.keys(variations.lazyLoadGroups ?? {}).length : 0,
      waitBeforeCaptureGroupCount: variations ? Object.keys(variations.waitBeforeCaptureGroups ?? {}).length : 0,
      layoutBreakpointsGroupCount: variations ? Object.keys(variations.layoutBreakpointsGroups ?? {}).length : 0,
      environmentGroupCount: variations ? Object.keys(variations.environmentGroups ?? {}).length : 0
    };
  },
  summarize(p) {
    return {
      oneLine: `${p.totalConfigs} config(s) across ${p.totalCheckOperations} check op(s); variations: ${p.hasVariations ? "yes" : "no"}`,
      count: p.totalConfigs,
      severity: p.hasVariations && p.lazyLoadGroupCount > 1 ? "warn" : "info",
      lazyLoadGroupCount: p.lazyLoadGroupCount,
      waitBeforeCaptureGroupCount: p.waitBeforeCaptureGroupCount,
      layoutBreakpointsGroupCount: p.layoutBreakpointsGroupCount,
      environmentGroupCount: p.environmentGroupCount
    };
  }
};
function timeOf(node) {
  return typeof node?.time === "number" ? node.time : 0;
}
function topByTime(entries, topN) {
  return entries.map(([key, node]) => ({ key, timeMs: timeOf(node) })).filter((e) => e.timeMs > 0).sort((a, b) => b.timeMs - a.timeMs).slice(0, topN);
}
const mod$3 = {
  id: "timeAnalysis",
  title: "Time Analysis Overview",
  isPresent: (data) => typeof data.time === "number",
  extract(data, index, opts) {
    const topN = opts?.topN ?? 5;
    const sd = data;
    const renders = [];
    function collect2(node) {
      for (const k of Object.keys(node)) {
        if (k === "logs") continue;
        const v = node[k];
        if (v && typeof v === "object" && !Array.isArray(v)) {
          if (k.startsWith("render-")) renders.push([k, v]);
          collect2(v);
        }
      }
    }
    collect2(sd);
    return {
      totalTimeMs: typeof sd.time === "number" ? sd.time : void 0,
      startedAt: typeof sd.startedAt === "number" ? sd.startedAt : void 0,
      finishedAt: typeof sd.finishedAt === "number" ? sd.finishedAt : void 0,
      topManagers: topByTime(
        [...index.managersUfg.entries(), ...index.managersClassic.entries()],
        topN
      ),
      topEyes: topByTime([...index.eyesUfg.entries(), ...index.eyesClassic.entries()], topN),
      slowestEnvironments: topByTime([...index.environments.entries()], topN),
      slowestRenders: topByTime(renders, topN)
    };
  },
  summarize(p) {
    const total = p.totalTimeMs ? Math.round(p.totalTimeMs / 1e3) : 0;
    return {
      oneLine: `${total}s total${p.topEyes.length ? `; slowest eyes ${Math.round(p.topEyes[0].timeMs)}ms` : ""}`,
      count: p.topEyes.length,
      severity: "info",
      totalTimeMs: p.totalTimeMs,
      topManagers: p.topManagers,
      topEyes: p.topEyes,
      slowestEnvironments: p.slowestEnvironments,
      slowestRenders: p.slowestRenders
    };
  }
};
const mod$2 = {
  id: "networkAnalysis",
  title: "Network Analysis",
  isPresent: (_data, index) => index.networkNodes.length > 0,
  extract(_data, index, opts) {
    const topN = opts?.topN ?? 5;
    const samples = [];
    for (const [contextKey, node] of index.networkNodes) {
      if (samples.length >= topN) break;
      const line = node.logs?.find((l) => l.includes('Request "'));
      if (line) {
        samples.push({
          contextKey,
          line: line.length > 240 ? line.slice(0, 240) + "…" : line
        });
      }
    }
    return {
      totalNetworkNodes: index.networkNodes.length,
      topNodes: index.networkNodes.slice(0, topN).map(([k]) => k),
      sampleLines: samples
    };
  },
  summarize(p) {
    return {
      oneLine: `${p.totalNetworkNodes} node(s) with network requests`,
      count: p.totalNetworkNodes,
      severity: "info",
      topNodes: p.topNodes,
      sampleLines: p.sampleLines
    };
  }
};
function flattenValue(v, key, out) {
  if (v === null || v === void 0) return;
  if (Array.isArray(v)) {
    v.forEach((item, i) => flattenValue(item, `${key}.${i}`, out));
  } else if (typeof v === "object") {
    for (const [k, child] of Object.entries(v)) {
      flattenValue(child, `${key}.${k}`, out);
    }
  } else {
    out[key] = v;
  }
}
function flattenObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    flattenValue(v, k, out);
  }
  return out;
}
function extractOpenEyesSettings(data, topN) {
  const results = [];
  const MARKER = 'Command "openEyes" is called with settings ';
  for (const [, node] of searchLogs(data, 'Command "openEyes" is called')) {
    if (results.length >= topN) break;
    if (!Array.isArray(node.logs)) continue;
    const joined = node.logs.join("\n");
    const idx = joined.indexOf(MARKER);
    if (idx === -1) continue;
    const afterMarker = joined.substring(idx + MARKER.length);
    const objStart = afterMarker.indexOf("{");
    if (objStart === -1) continue;
    const parsed = parseLooseObject(afterMarker.substring(objStart));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const redacted = redactSensitive(parsed);
      results.push(flattenObject(redacted));
    }
  }
  return results;
}
const mod$1 = {
  id: "testDetails",
  title: "Test Details",
  isPresent: (_data, index) => index.eyesUfg.size + index.eyesClassic.size > 0,
  extract(data, index, opts) {
    const topN = opts?.topN ?? 20;
    const allEyes = [...index.eyesUfg.keys(), ...index.eyesClassic.keys()];
    const sessions = allEyes.slice(0, topN).map((eyesId) => {
      const bases = index.eyesBasesByEyes.get(eyesId) ?? [];
      return {
        eyesId,
        baseSessionCount: bases.length,
        closed: index.eyesHasAnyClose.has(eyesId),
        hasResults: index.eyesHasResultsBase.has(eyesId)
      };
    });
    let closed = 0;
    let withResults = 0;
    for (const id of allEyes) {
      if (index.eyesHasAnyClose.has(id)) closed++;
      if (index.eyesHasResultsBase.has(id)) withResults++;
    }
    return {
      sampleSessions: sessions,
      totalSessions: allEyes.length,
      closedSessions: closed,
      resultsSessions: withResults,
      sampleOpenEyesSettings: extractOpenEyesSettings(data, 3)
    };
  },
  summarize(p) {
    return {
      oneLine: `${p.totalSessions} session(s); ${p.closedSessions} closed; ${p.resultsSessions} with results`,
      count: p.totalSessions,
      severity: "info",
      closedSessions: p.closedSessions,
      resultsSessions: p.resultsSessions,
      sampleSessions: p.sampleSessions,
      sampleOpenEyesSettings: p.sampleOpenEyesSettings
    };
  }
};
const mod = {
  id: "renderTargets",
  title: "Render Targets Analysis",
  isPresent: (_data, index) => index.renderTargets.size > 0,
  extract(_data, index, opts) {
    const topN = opts?.topN ?? 20;
    return {
      total: index.renderTargets.size,
      sampleIds: Array.from(index.renderTargets.keys()).slice(0, topN)
    };
  },
  summarize(p) {
    return {
      oneLine: `${p.total} render target(s)`,
      count: p.total,
      severity: "info",
      sampleIds: p.sampleIds
    };
  }
};
const SECTIONS = [
  mod$a,
  mod$9,
  mod$8,
  mod$7,
  mod$6,
  mod$5,
  mod$4,
  mod$3,
  mod$2,
  mod$1,
  mod
];
let cached = null;
function isCoreParser(x) {
  return !!x && typeof x.parseLogs === "function" && typeof x.structureLogs === "function" && typeof x.analyzeLogs === "function";
}
function fromGlobal() {
  const g = globalThis;
  return isCoreParser(g.exports) ? g.exports : null;
}
async function resolveParser(override) {
  if (override) return override;
  if (cached) return cached;
  const fromGlob = fromGlobal();
  if (fromGlob) {
    cached = fromGlob;
    return fromGlob;
  }
  const mod2 = await import("@applitools/core/dist/troubleshoot/logs");
  if (!isCoreParser(mod2)) {
    throw new Error(
      "Failed to load @applitools/core parser from dist/troubleshoot/logs. Either install @applitools/core or pass options.parser explicitly."
    );
  }
  cached = mod2;
  return cached;
}
const SCHEMA_VERSION = "1";
function pointer(id) {
  return `/sections/${id}`;
}
async function structureLogForLLM(content, options = {}) {
  const detail = options.detail ?? "summary";
  const parser = await resolveParser(options.parser);
  const pipelineResult = runLogPipeline(content, parser);
  const { analyzed, index, lineCount } = pipelineResult;
  const indexEntries = [];
  const sections = {};
  for (const section of SECTIONS) {
    const present = section.isPresent(analyzed, index);
    let oneLine = `${section.title}: not present`;
    let itemCount = 0;
    let severity = "info";
    let summarized = null;
    let extracted = void 0;
    if (present) {
      extracted = section.extract(analyzed, index, options);
      summarized = section.summarize(extracted, options);
      oneLine = String(summarized.oneLine);
      itemCount = summarized.count;
      severity = summarized.severity;
    }
    indexEntries.push({
      id: section.id,
      title: section.title,
      oneLineSummary: oneLine,
      itemCount,
      severity,
      present,
      pointer: pointer(section.id)
    });
    if (!present) continue;
    if (detail === "index-only") continue;
    if (detail === "summary") sections[section.id] = summarized;
    else sections[section.id] = extracted;
  }
  let sdkMeta;
  const generalEntry = sections.generalInfo;
  if (generalEntry?.sdk) {
    sdkMeta = { name: generalEntry.sdk.name, version: generalEntry.sdk.version };
  }
  const metadata = {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    sourceBytes: typeof content === "string" ? content.length : 0,
    sourceLines: lineCount,
    schemaVersion: SCHEMA_VERSION,
    detail,
    sdk: sdkMeta
  };
  return { metadata, index: indexEntries, sections };
}
async function structureLogFile(filePath, options) {
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(filePath, "utf8");
  return structureLogForLLM(content, options);
}
export {
  structureLogFile,
  structureLogForLLM
};
