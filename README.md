# Demo Static Server

A TypeScript-based Express static server for serving demo pages with full type safety.

## Installation

```bash
npm install
```

## Development

### Build TypeScript

```bash
npm run build        # Compile TypeScript to JavaScript
npm run build:watch  # Watch mode for development
```

### Bundle

```bash
npm run bundle       # Build and bundle with Rollup
```

### Type Checking & Linting

```bash
npm run type-check   # Type check without emitting files
npm run lint         # Lint TypeScript files
```

### Clean Build Artifacts

```bash
npm run clean        # Remove dist/ directory
```

## Usage

### As a Module

Import and use the `DemoServer` class in your TypeScript/JavaScript code:

```typescript
import DemoServer from './dist/server.js';

// Start the server on port 3000
DemoServer.serveDemo(3000)
  .then((info) => {
    console.log(`Server running at ${info.url}`);
  })
  .catch((error) => {
    console.error('Failed to start server:', error.message);
  });
```

### From Command Line

#### Start with default port (3000)

```bash
npm start            # Build and start
npm run start:dev    # Start with tsx (no build needed)
```

#### Start compiled server directly

```bash
node dist/server.js           # Port 3000
node dist/server.js 8080      # Custom port
```

### Testing

Run the test script:

```bash
npm test
```

This will start the server and display available URLs for testing.

## API

### `DemoServer.serveDemo(port?, projectRoot?)`

Static method that creates and starts a new server instance.

**Parameters:**
- `port` (number, optional) - Port number to serve on. Default: 3000
- `projectRoot` (string, optional) - Custom project root directory to serve. If not provided, auto-detects based on the compiled file location.

**Returns:**
- `Promise<ServerInfo>` - Resolves with server information:
  ```typescript
  interface ServerInfo {
    port: number;
    url: string;
    message: string;
    server: http.Server;
    projectRoot: string;
  }
  ```

**Examples:**

```typescript
import DemoServer from './dist/server.js';

// Example 1: Start server with defaults (auto-detect project root)
const serverInfo = await DemoServer.serveDemo();
console.log(serverInfo.message);
// Output: Demo server is running at http://localhost:3000

// Example 2: Start server on custom port
const serverInfo2 = await DemoServer.serveDemo(8080);

// Example 3: Start server with custom port and project root
const serverInfo3 = await DemoServer.serveDemo(8080, '/path/to/project');
console.log(serverInfo3.projectRoot);
// Output: /path/to/project

// Access the HTTP server instance if needed
const httpServer = serverInfo.server;
```

### CLI Usage with server-cli.js

The server-cli script supports multiple ways to specify port and project root:

```bash
# Default (port 3000, auto-detect root)
node dist/server-cli.js

# Custom port
node dist/server-cli.js 8080

# Custom port and project root (positional)
node dist/server-cli.js 8080 /path/to/project

# Named arguments
node dist/server-cli.js --port 8080 --root /path/to/project

# Short flags
node dist/server-cli.js -p 8080 -r /path/to/project

# Help
node dist/server-cli.js --help
```

## TypeScript Support

This project is written in TypeScript and includes full type definitions. When importing the module, you'll get:

- Full IntelliSense support
- Type checking for all API methods
- Exported interfaces and types
- Source maps for debugging

The compiled JavaScript files are in the `dist/` directory, with corresponding `.d.ts` type definition files.

### Exported Types

```typescript
// Server information returned by serveDemo()
interface ServerInfo {
  port: number;
  url: string;
  message: string;
  server: http.Server;
  projectRoot: string;
}

// Options for configuring the server (reserved for future use)
interface ServerOptions {
  port?: number;
  projectRoot?: string;
}
```

### Usage in TypeScript

```typescript
import DemoServer, { ServerInfo } from './dist/server.js';

const info: ServerInfo = await DemoServer.serveDemo(3000, './public');
console.log(`Server started at ${info.url}`);
console.log(`Serving files from ${info.projectRoot}`);
```

## Project Structure

```
demo2/
├── src/                    # TypeScript source files
│   ├── server.ts          # Main server implementation
│   ├── test-server.ts     # Test script
│   └── server-cli.ts   # Usage examples
├── dist/                   # Compiled JavaScript (gitignored)
│   ├── server.js
│   ├── server.d.ts        # Type definitions
│   ├── bundle.js          # Rollup bundle
│   └── ...
├── AutonomousTestPages/   # Test pages
├── DomSnapshot/           # DOM snapshot test pages
├── TestPages/             # Various test pages
├── MobileEmulation/       # Mobile emulation pages
├── css/                   # Stylesheets
├── images/                # Image assets
├── scripts/               # JavaScript files
├── tsconfig.json          # TypeScript configuration
├── rollup.config.js       # Rollup bundler configuration
├── .eslintrc.json         # ESLint configuration
└── package.json           # Project dependencies and scripts
```

The server serves all static files from the project root directory:

- `/` - Main index.html
- `/AutonomousTestPages/` - Autonomous test pages
- `/DomSnapshot/` - DOM snapshot test pages
- `/TestPages/` - Various test pages
- `/MobileEmulation/` - Mobile emulation pages
- `/css/` - Stylesheets
- `/images/` - Image assets
- `/scripts/` - JavaScript files

## Features

- Serves all HTML, CSS, JavaScript, and image files
- Automatic HTML extension resolution
- Custom 404 error page
- Error handling middleware
- Support for nested directories
- Directory index files (index.html)

## External Dependencies

Some pages reference external resources (CDNs, fonts, etc.). See [EXTERNAL_DEPENDENCIES.md](EXTERNAL_DEPENDENCIES.md) for a complete list.

These external resources will still be fetched from the internet when pages are loaded in a browser. The server only serves the static files from this project.

## Build Output

- **TypeScript compilation**: Generates `.js`, `.d.ts`, and `.js.map` files in `dist/`
- **Rollup bundling**: Creates a single `dist/bundle.js` file with Express as external dependency
- **Source maps**: Included for debugging compiled code

## Notes

- The project uses TypeScript with strict mode enabled
- ES6 modules are used (`type: "module"` in package.json)
- All paths are served relative to the project root
- The server will error if the specified port is already in use
- TypeScript definitions are automatically generated during build

## License

See [LICENSE](LICENSE) file for details.
