import assert from 'assert';
import fs from 'fs';
import http from 'http';
import { PlaywrightService, DEFAULT_FULL_PAGE_SCREENSHOT_TIMEOUT_MS } from '../src/services/playwright.service';
import { PlaywrightDiagnosticMetadata } from '../src/services/browser-diagnostics';

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Expected TCP server address'));
      resolve(address.port);
    });
  });
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function run() {
  assert.strictEqual(DEFAULT_FULL_PAGE_SCREENSHOT_TIMEOUT_MS, 60_000);
  const assetRequests: string[] = [];
  let pageOrigin = '';
  const assetServer = http.createServer((request, response) => {
    assetRequests.push(`${request.method} ${request.url} ${request.headers['access-control-request-headers'] ?? ''}`);
    response.setHeader('Access-Control-Allow-Origin', pageOrigin);
    if (request.method === 'OPTIONS') return response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET' }).end();
    response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  });
  const assetPort = await listen(assetServer);

  const pageServer = http.createServer((request, response) => {
    if (request.url?.startsWith('/slow-font.woff2')) return; // Deliberately hold the font request open for the timeout regression.
    if (request.url?.startsWith('/slow-font.html')) {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><style>@font-face{font-family:Slow;src:url('/slow-font.woff2')}body{font-family:Slow}</style><main>Screenshot timeout regression</main>`);
      return;
    }
    if (request.url?.startsWith('/cors.html')) {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><main>Cross-origin header test</main><script>fetch('http://127.0.0.1:${assetPort}/resource').then(r=>r.text()).then(t=>document.body.dataset.result=t).catch(e=>console.error(e.message))</script>`);
      return;
    }
    response.writeHead(404).end();
  });
  const pagePort = await listen(pageServer);
  pageOrigin = `http://127.0.0.1:${pagePort}`;
  const originalLog = console.log;
  const originalError = console.error;
  const originalInfo = console.info;
  const logs: Array<{ level: string; args: unknown[] }> = [];
  console.log = ((...args: unknown[]) => { logs.push({ level: 'log', args }); }) as typeof console.log;
  console.error = ((...args: unknown[]) => { logs.push({ level: 'error', args }); }) as typeof console.error;
  console.info = ((...args: unknown[]) => { logs.push({ level: 'info', args }); }) as typeof console.info;

  try {
    const corsDiagnostics: PlaywrightDiagnosticMetadata[] = [];
    const corsService = new PlaywrightService(5000, 0);
    const corsScreenshot = await corsService.captureScreenshot(`${pageOrigin}/cors.html`, 'screenshot-cors-test', async (d) => { corsDiagnostics.push(d); });
    try {
      assert.ok(assetRequests.some((entry) => entry.startsWith('GET /resource')),
        'a same-site page can fetch a different origin without the injected Upgrade-Insecure-Requests preflight');
      assert.ok(!assetRequests.some((entry) => entry.startsWith('OPTIONS /resource')),
        'UIVerdict must not inject Upgrade-Insecure-Requests on cross-origin subresource requests');
      assert.ok(!corsDiagnostics.at(-1)?.consoleErrors.some((message) => /CORS/i.test(message)));
    } finally {
      await corsService.removeScreenshot(corsScreenshot);
    }

    const timeoutDiagnostics: PlaywrightDiagnosticMetadata[] = [];
    const timeoutService = new PlaywrightService(500, 0);
    const timeoutAnalysisId = `screenshot-timeout-${Date.now()}`;
    await assert.rejects(
      () => timeoutService.captureScreenshot(`${pageOrigin}/slow-font.html?secret=private`, timeoutAnalysisId, async (d) => { timeoutDiagnostics.push(d); }),
      /Failed to capture full page screenshot/,
    );
    const diagnostic = timeoutDiagnostics.at(-1);
    assert.strictEqual(diagnostic?.outcome, 'CAPTURE_FAILED');
    assert.match(diagnostic?.screenshotError ?? '', /Timeout 500ms exceeded/);
    assert.strictEqual(diagnostic?.navigationError, null, 'capture errors use screenshotError instead of navigationError');
    const captureFailureLog = logs.find((entry) => entry.level === 'error' && String(entry.args[0]).includes('Full-page screenshot failed'));
    assert.ok(captureFailureLog && JSON.stringify(captureFailureLog.args).includes('Timeout 500ms exceeded'),
    'the exact sanitized browser exception remains available in server logs');
    const captureFailure = captureFailureLog?.args[1] as Record<string, any>;
    assert.strictEqual(captureFailure.pageClosed, false, 'the page remains open while screenshot capture times out');
    assert.strictEqual(captureFailure.failureClass, 'TIMEOUT');
    assert.strictEqual(captureFailure.stage, 'browser_capture');
    assert.match(captureFailure.message, /Timeout 500ms exceeded/);
    assert.ok(captureFailure.errorName.length > 0, 'failure log includes the error name');
    assert.ok(captureFailure.errorCode.length > 0, 'failure log includes the error code');
    assert.ok(captureFailure.elapsedMs > 0, 'failure log includes elapsed capture time');
    assert.ok(!Object.hasOwn(captureFailure, 'stack'), 'failure log omits the raw exception stack');
    assert.ok(!JSON.stringify(captureFailure).includes('private'), 'failure log does not expose the URL query secret');
    assert.ok(logs.some((entry) => entry.level === 'info' && String(entry.args[0]).includes('Full-page screenshot capture started')));
    assert.ok((diagnostic?.screenshotDurationMs ?? 0) > 0, 'failed capture duration is retained in diagnostics');
    assert.ok(!JSON.stringify(diagnostic).includes('private'), 'diagnostics continue to redact query strings');
    const screenshotDir = require('path').resolve(process.cwd(), 'temp', 'screenshots');
    const leftover = (await fs.promises.readdir(screenshotDir)).filter((name) => name.startsWith(`uiverdict-${timeoutAnalysisId}-`));
    assert.deepStrictEqual(leftover, [], 'failed screenshot artifacts are removed');
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.info = originalInfo;
    await close(pageServer);
    await close(assetServer);
  }
  console.log('Screenshot capture regressions passed (cross-origin header and full-page timeout).');
}

run().catch((error) => {
  console.error('Screenshot capture regression tests failed:', error);
  process.exitCode = 1;
});
