import express, { Express, Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server as HttpServer } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Options for starting the server
 */
export interface ServerOptions {
  port?: number;
  projectRoot?: string;
}

/**
 * Interface for server information returned by serveDemo
 */
export interface ServerInfo {
  port: number;
  url: string;
  message: string;
  server: HttpServer;
  projectRoot: string;
}

/**
 * Error with code property for error handling
 */
interface ErrorWithCode extends Error {
  code?: string;
}

/**
 * Server class to serve demo static pages
 */
class DemoServer {
  private app: Express | null = null;
  private server: HttpServer | null = null;

  /**
   * Serves the demo static pages on the specified port
   * @param port - The port number to serve on (default: 3000)
   * @param projectRoot - Optional custom project root directory
   * @returns Promise resolving to server information
   */
  static serveDemo(port = 3000, projectRoot?: string): Promise<ServerInfo> {
    const instance = new DemoServer();
    return instance.start(port, projectRoot);
  }

  /**
   * Start the server
   * @param port - The port number to serve on
   * @param customProjectRoot - Optional custom project root directory
   * @returns Promise resolving to server information
   */
  start(port = 3000, customProjectRoot?: string): Promise<ServerInfo> {
    return new Promise((resolve, reject) => {
      try {
        this.app = express();

        // Get the project root directory
        let projectRoot: string;

        if (customProjectRoot) {
          // Use custom project root if provided (resolve to absolute path)
          projectRoot = path.resolve(customProjectRoot);
        } else {
          // Auto-detect: When running from dist/, go up one level; otherwise use current directory
          projectRoot = __dirname.endsWith('dist')
            ? path.resolve(__dirname, '..')
            : path.resolve(__dirname, '..', '..');
        }

        console.log(`Serving static files from: ${projectRoot}`);

        // Serve static files from the project root directory
        this.app.use(express.static(projectRoot, {
          extensions: ['html', 'htm'],
          index: 'index.html'
        }));

        // Handle 404 errors
        this.app.use((_req: Request, res: Response) => {
          res.status(404).send(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>404 - Page Not Found</title>
                <style>
                  body {
                    font-family: Arial, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background-color: #f5f5f5;
                  }
                  .error-container {
                    text-align: center;
                    padding: 2rem;
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                  }
                  h1 { color: #333; }
                  p { color: #666; }
                  a { color: #007bff; text-decoration: none; }
                  a:hover { text-decoration: underline; }
                </style>
              </head>
              <body>
                <div class="error-container">
                  <h1>404 - Page Not Found</h1>
                  <p>The requested page could not be found.</p>
                  <p><a href="/">Return to Home</a></p>
                </div>
              </body>
            </html>
          `);
        });

        // Error handling middleware
        this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
          console.error('Server error:', err);
          res.status(500).send(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>500 - Server Error</title>
                <style>
                  body {
                    font-family: Arial, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background-color: #f5f5f5;
                  }
                  .error-container {
                    text-align: center;
                    padding: 2rem;
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                  }
                  h1 { color: #d9534f; }
                  p { color: #666; }
                </style>
              </head>
              <body>
                <div class="error-container">
                  <h1>500 - Internal Server Error</h1>
                  <p>An error occurred while processing your request.</p>
                </div>
              </body>
            </html>
          `);
        });

        // Start the server
        this.server = this.app.listen(port, () => {
          if (!this.server) {
            reject(new Error('Server failed to start'));
            return;
          }

          const info: ServerInfo = {
            port,
            url: `http://localhost:${port}`,
            message: `Demo server is running at http://localhost:${port}`,
            server: this.server,
            projectRoot
          };
          console.log(info.message);
          resolve(info);
        });

        this.server.on('error', (error: ErrorWithCode) => {
          if (error.code === 'EADDRINUSE') {
            reject(new Error(`Port ${port} is already in use`));
          } else {
            reject(error);
          }
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the server
   * @returns Promise that resolves when server is stopped
   */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) {
            reject(err);
          } else {
            console.log('Server stopped');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

// Export the server class
export default DemoServer;

// If this file is run directly, start the server
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.argv[2] ? parseInt(process.argv[2], 10) : 3000;
  const projectRoot = process.argv[3] ? process.argv[3] : undefined;

  DemoServer.serveDemo(port, projectRoot)
    .then((info) => {
      console.log('Server started successfully!');
      console.log(`Visit ${info.url} to view the demo pages`);
    })
    .catch((error: Error) => {
      console.error('Failed to start server:', error.message);
      process.exit(1);
    });
}
