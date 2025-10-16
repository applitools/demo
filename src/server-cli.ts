import DemoServer from './server.js';

/**
 * Example: Using DemoServer.serveDemo() as a module with CLI arguments
 *
 * Usage:
 *   node dist/server-cli.js
 *   node dist/server-cli.js 8080
 *   node dist/server-cli.js 8080 /path/to/project
 *   node dist/server-cli.js --port 8080 --root /path/to/project
 */

// Parse command line arguments
function parseArgs(): { port: number; projectRoot?: string } {
  const args = process.argv.slice(2);
  let port = 3000;
  let projectRoot: string | undefined;
  let hasNamedArgs = false;

  // Check for help first
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node dist/server-cli.js [options] [port] [projectRoot]

Options:
  --port, -p <number>     Port number to serve on (default: 3000)
  --root, -r <path>       Project root directory to serve
  --help, -h              Show this help message

Positional Arguments:
  port                    Port number (default: 3000)
  projectRoot             Project root directory to serve

Examples:
  node dist/server-cli.js
  node dist/server-cli.js 8080
  node dist/server-cli.js 8080 /path/to/project
  node dist/server-cli.js --port 8080 --root /path/to/project
    `);
    process.exit(0);
  }

  // Handle named arguments (--port, --root)
  const usedIndices = new Set<number>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' || args[i] === '-p') {
      port = parseInt(args[i + 1], 10) || 3000;
      hasNamedArgs = true;
      usedIndices.add(i);
      usedIndices.add(i + 1);
      i++;
    } else if (args[i] === '--root' || args[i] === '-r') {
      projectRoot = args[i + 1];
      hasNamedArgs = true;
      usedIndices.add(i);
      usedIndices.add(i + 1);
      i++;
    }
  }

  // Handle positional arguments only if no named arguments were used
  if (!hasNamedArgs) {
    if (args.length > 0 && !args[0].startsWith('-')) {
      const portArg = parseInt(args[0], 10);
      if (!isNaN(portArg)) {
        port = portArg;
      }
    }

    if (args.length > 1 && !args[1].startsWith('-')) {
      projectRoot = args[1];
    }
  }

  return { port, projectRoot };
}

const { port, projectRoot } = parseArgs();

console.log('Starting demo server...');
if (projectRoot) {
  console.log(`  Port: ${port}`);
  console.log(`  Project Root: ${projectRoot}\n`);
} else {
  console.log(`  Port: ${port}`);
  console.log(`  Project Root: auto-detected\n`);
}

DemoServer.serveDemo(port, projectRoot)
  .then((info) => {
    console.log('✓ Server started successfully!');
    console.log(`  Port: ${info.port}`);
    console.log(`  URL: ${info.url}`);
    console.log(`  Project Root: ${info.projectRoot}\n`);
    console.log('Available pages:');
    console.log(`  - Main page: ${info.url}/`);
    console.log(`  - Autonomous Tests: ${info.url}/AutonomousTestPages/`);
    console.log(`  - DOM Snapshot: ${info.url}/DomSnapshot/`);
    console.log(`  - Test Pages: ${info.url}/TestPages/`);
    console.log(`  - Logs Viewer: ${info.url}/logs.html`);
    console.log(`  - Changelog: ${info.url}/changelog.html\n`);
    console.log('Press Ctrl+C to stop the server.');
  })
  .catch((error: Error) => {
    console.error('✗ Failed to start server:', error.message);
    process.exit(1);
  });
