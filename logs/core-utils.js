// Core utility functions for log analysis

// Search for objects in nested data structure by key name
function searchObjects(data, needle="render-target") {
  if(typeof data === "object") {
      const entries = Object.entries(data)
      if(entries.length)
          return entries.filter(([name]) => name.includes(needle)).concat(entries.flatMap(([_, log]) => searchObjects(log, needle)))
  }
  return []
}

// Search for objects containing specific log content
function searchLogs(data, needle) {
  if(typeof data === "object") {
      const entries = Object.entries(data)
      if(entries.length)
          return entries.filter(([name, log]) => log?.logs && log.logs.some(line => line.includes(needle))).concat(entries.flatMap(([_, log]) => searchLogs(log, needle)))
  }
  return []
}

// Add error notations to nested data structure
function addErrorNotations(obj) {
  for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
          if (typeof obj[key] === 'object' && obj[key] !== null) {
              if(addErrorNotations(obj[key])) {
                  obj[key].hasError = true
                  obj.hasError = true
              }
          } else if (typeof obj[key] === 'string' && errorIndicators.some(indicator => obj[key].includes(indicator))) {
              obj[key].hasError = true
              obj.hasError = true
          }
      }
  }
  return obj.hasError
}

// Extract meaningful test display name from test data
function extractTestDisplayName(testKey, testData) {
  // Try to get test name from openEyes command
  const openEyesLogs = searchLogs(testData, 'Command "openEyes" is called');
  if (openEyesLogs.length > 0) {
    try {
      const logLines = openEyesLogs[0][1]?.logs || [];
      for (const line of logLines) {
        if (line.includes('testName:')) {
          const testNameMatch = line.match(/testName:\s*['"](.*?)['"]/) || line.match(/testName:\s*'([^']*)'/) || line.match(/testName:\s*"([^"]*)"/);
          if (testNameMatch) {
            return `${testNameMatch[1]} (${testKey})`;
          }
        }
      }
    } catch (e) { /* ignore */ }
  }
  
  // Try to get name from check command
  const checkLogs = searchLogs(testData, 'Command "check" is called');
  if (checkLogs.length > 0) {
    try {
      const logLines = checkLogs[0][1]?.logs || [];
      for (const line of logLines) {
        if (line.includes('name:')) {
          const nameMatch = line.match(/name:\s*['"](.*?)['"]/) || line.match(/name:\s*'([^']*)'/) || line.match(/name:\s*"([^"]*)"/);
          if (nameMatch) {
            return `${nameMatch[1]} (${testKey})`;
          }
        }
      }
    } catch (e) { /* ignore */ }
  }
  
  // Fallback to just the key
  return testKey;
}