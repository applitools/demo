import DemoServer from './server.js';

/**
 * Simple test script for the DemoServer
 */
async function testServer(): Promise<void> {
  console.log('Testing DemoServer...\n');

  try {
    // Test 1: Start server on default port
    console.log('Test 1: Starting server on port 3000...');
    const serverInfo = await DemoServer.serveDemo(3000);
    console.log('✓ Server started successfully');
    console.log(`  URL: ${serverInfo.url}`);
    console.log(`  Port: ${serverInfo.port}\n`);

    // Keep the server running for manual testing
    console.log('Server is running. Press Ctrl+C to stop.\n');
    console.log('Try visiting:');
    console.log(`  - ${serverInfo.url}`);
    console.log(`  - ${serverInfo.url}/AutonomousTestPages/`);
    console.log(`  - ${serverInfo.url}/DomSnapshot/`);
    console.log(`  - ${serverInfo.url}/TestPages/`);
    console.log(`  - ${serverInfo.url}/logs.html`);
    console.log(`  - ${serverInfo.url}/changelog.html\n`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('✗ Test failed:', errorMessage);
    process.exit(1);
  }
}

// Run tests
testServer();
