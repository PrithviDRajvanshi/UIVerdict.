import assert from 'assert';
import http from 'http';
import { appendBounded, classifyLighthouseFailure, classifyLighthouseResult, createLighthouseSessionDiagnostics, extractLighthouseNavigationResponses, MAX_DIAGNOSTIC_EVENTS, MAX_DIAGNOSTIC_MESSAGE_LENGTH, sanitizeDiagnosticMessage, sanitizeDiagnosticUrl, sanitizeLighthouseDiagnostics } from '../src/services/browser-diagnostics';
import { PlaywrightService } from '../src/services/playwright.service';

async function run() {
  assert.strictEqual(sanitizeDiagnosticUrl('https://user:pass@example.com/path?a=secret#fragment'), 'https://example.com/path');
  assert.strictEqual(sanitizeDiagnosticUrl('data:text/html,secret'), '[non-http-url]');
  assert.deepStrictEqual(createLighthouseSessionDiagnostics(
    'https://example.com/start?token=private',
    'https://example.com/final?session=private',
    '2026-10-13T09:00:00.000Z',
    1234,
  ), {
    requestedUrl: 'https://example.com/start',
    finalUrl: 'https://example.com/final',
    fetchTime: '2026-10-13T09:00:00.000Z',
    auditDurationMs: 1234,
  });
  assert.strictEqual(sanitizeLighthouseDiagnostics({
    requestedUrl: 'https://example.com/', outcome: 'NAVIGATION_FAILED', navigationResponseStatus: 503,
    navigationResponses: [{ url: 'https://example.com/?secret=1', status: 503 }], attempt: 1, maxAttempts: 2,
  }).outcome, 'NAVIGATION_FAILED');
  assert.strictEqual(classifyLighthouseFailure({ code: 'ERRORED_DOCUMENT_REQUEST' }, 503), 'NAVIGATION_FAILED');
  assert.strictEqual(classifyLighthouseFailure(new Error('audit computation failed'), 200), 'AUDIT_FAILED');
  assert.strictEqual(classifyLighthouseResult(null), 'AUDIT_COMPLETED', 'a completed Lighthouse result stays completed regardless of its category scores');
  assert.strictEqual(classifyLighthouseResult(null, 503), 'NAVIGATION_FAILED', 'an HTTP error response is a navigation failure even without a runtimeError');
  assert.deepStrictEqual(extractLighthouseNavigationResponses({
    'network-requests': { details: { items: [
      { url: 'https://example.com/final?token=private', statusCode: 200, resourceType: 'Document', experimentalFromMainFrame: true },
      { url: 'https://frame.example/inner', statusCode: 500, resourceType: 'Document', experimentalFromMainFrame: false },
    ] } },
  }, [], 'https://example.com/start', 'https://example.com/final'), [{ url: 'https://example.com/final', status: 200 }]);
  assert.deepStrictEqual(extractLighthouseNavigationResponses({}, [
    { method: 'Page.frameNavigated', params: { frame: { id: 'main' } } },
    { method: 'Network.requestWillBeSent', params: { type: 'Document', frameId: 'main', redirectResponse: { url: 'https://example.com/start?auth=secret', status: 302 } } },
    { method: 'Network.responseReceived', params: { type: 'Document', frameId: 'main', response: { url: 'https://example.com/final?token=secret', status: 200 } } },
  ], 'https://example.com/start', 'https://example.com/final'), [
    { url: 'https://example.com/start', status: 302 },
    { url: 'https://example.com/final', status: 200 },
  ]);
  const safeMessage = sanitizeDiagnosticMessage('Authorization: Bearer secret-value token=secret https://example.com/path?q=secret');
  assert.ok(!safeMessage.includes('secret-value'));
  assert.ok(!safeMessage.includes('secret'));
  assert.ok(!safeMessage.includes('?q='));
  assert.ok(!sanitizeDiagnosticMessage('key=AIza123456789012345678901234').includes('AIza'));
  assert.strictEqual(sanitizeDiagnosticMessage('x'.repeat(400)).length, MAX_DIAGNOSTIC_MESSAGE_LENGTH);
  const bounded: number[] = [];
  for (let i = 0; i < MAX_DIAGNOSTIC_EVENTS + 5; i++) appendBounded(bounded, i);
  assert.strictEqual(bounded.length, MAX_DIAGNOSTIC_EVENTS);

  const server = http.createServer((request, response) => {
    if (request.url === '/broken-image.png') {
      response.destroy();
      return;
    }
    if (request.url === '/app.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' }).end("document.querySelector('main').textContent = 'Loaded external application script';");
      return;
    }
    if (request.url === '/app.css') {
      response.writeHead(200, { 'Content-Type': 'text/css' }).end('main { display: block; }');
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/html' }).end(`<!doctype html><title>Diagnostic test</title><link rel="stylesheet" href="/app.css"><body><main></main><img src="/broken-image.png"><button>Go</button><script src="/app.js"></script><script>console.error('token=do-not-log'); setTimeout(() => { throw new Error('page failure'); }, 0);</script></body>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const logs: Array<{ label: string; data: any }> = [];
  const originalLog = console.log;
  const oldRetention = process.env.UIVERDICT_DEV_SCREENSHOT_RETENTION_HOURS;
  process.env.UIVERDICT_DEV_SCREENSHOT_RETENTION_HOURS = '0';
  console.log = ((label: string, data: any) => { logs.push({ label, data }); }) as typeof console.log;
  const service = new PlaywrightService();
  let screenshot: Awaited<ReturnType<PlaywrightService['captureScreenshot']>> | null = null;
  try {
    const response = await service.captureScreenshot(`http://127.0.0.1:${address.port}/test?auth=secret`, 'diagnostics-test');
    screenshot = response;
    assert.ok(response.filename.startsWith('uiverdict-diagnostics-test-'));
    assert.match(response.sha256, /^[a-f0-9]{64}$/);
    const diagnostic = logs.find((entry) => entry.label === '[Playwright] Capture diagnostics:')?.data;
    assert.ok(diagnostic, 'capture diagnostics are logged before screenshot');
    assert.strictEqual(diagnostic.requestedUrl, `http://127.0.0.1:${address.port}/test`);
    assert.strictEqual(diagnostic.finalUrl, diagnostic.requestedUrl);
    assert.strictEqual(diagnostic.title, 'Diagnostic test');
    assert.strictEqual(diagnostic.readyState, 'complete');
    assert.ok(diagnostic.bodyTextLength > 0);
    assert.ok(!diagnostic.browserEvents.failedRequests.some((event: any) => /\/app\.(js|css)$/.test(event.url)), 'Chromium must load local application assets with native fetch metadata');
    assert.ok(diagnostic.visibleElementCount >= 3);
    assert.strictEqual(diagnostic.imageCount, 1);
    assert.strictEqual(diagnostic.buttonCount, 1);
    assert.strictEqual(typeof diagnostic.navigationDurationMs, 'number');
    assert.strictEqual(diagnostic.navigationTimedOut, false);
    assert.strictEqual(diagnostic.settlingDelayMs, 2000);
    assert.ok(diagnostic.screenshotStartedAt);
    assert.ok(diagnostic.browserEvents.consoleErrors.length > 0);
    assert.ok(diagnostic.browserEvents.pageErrors.length > 0);
    assert.ok(diagnostic.browserEvents.failedRequests.some((event: any) => event.url.endsWith('/broken-image.png')));
    assert.ok(diagnostic.browserEvents.httpErrorResponses.some((event: any) => event.status === 404));
    assert.ok(diagnostic.browserEvents.navigationResponses.some((event: any) => event.status === 404));
    assert.ok(diagnostic.browserEvents.mainFrameNavigations.includes(diagnostic.finalUrl));
    assert.ok(!JSON.stringify(diagnostic).includes('secret'));
    assert.ok(logs.some((entry) => entry.label === '[Playwright] Screenshot timing:'));
  } finally {
    console.log = originalLog;
    if (oldRetention === undefined) delete process.env.UIVERDICT_DEV_SCREENSHOT_RETENTION_HOURS; else process.env.UIVERDICT_DEV_SCREENSHOT_RETENTION_HOURS = oldRetention;
    if (screenshot) await service.removeScreenshot(screenshot);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  console.log('Browser diagnostics tests passed.');
}

run().catch((error) => {
  console.error('Browser diagnostics tests failed:', error);
  process.exitCode = 1;
});
