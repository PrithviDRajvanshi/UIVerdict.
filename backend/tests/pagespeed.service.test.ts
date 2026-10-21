import assert from 'assert';
import { PageSpeedService } from '../src/services/pagespeed.service';

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function successPayload() {
  return {
    lighthouseResult: {
      categories: {
        performance: { score: 0.987 },
        accessibility: { score: 0.91 },
        'best-practices': { score: 0.82 },
        seo: { score: 0.73 },
      },
      audits: {
        'first-contentful-paint': { displayValue: '1.2 s' },
        'largest-contentful-paint': { displayValue: '2.4 s' },
        'speed-index': { displayValue: '2.0 s' },
        'total-blocking-time': { displayValue: '120 ms' },
        'cumulative-layout-shift': { displayValue: '0.04' },
        interactive: { displayValue: '3.1 s' },
      },
    },
  };
}

async function testSuccessMappingAndRequestOptions() {
  let requestUrl = '';
  let requestCount = 0;
  const service = new PageSpeedService({
    apiKey: 'private-test-key',
    fetch: (async (input: RequestInfo | URL) => {
      requestCount++;
      requestUrl = String(input);
      return okResponse(successPayload());
    }) as typeof fetch,
  });

  const metrics = await service.runAudit('https://example.test/');
  assert.deepStrictEqual(metrics, {
    performance: 99,
    accessibility: 91,
    bestPractices: 82,
    seo: 73,
    firstContentfulPaint: '1.2 s',
    largestContentfulPaint: '2.4 s',
    speedIndex: '2.0 s',
    totalBlockingTime: '120 ms',
    cumulativeLayoutShift: '0.04',
    timeToInteractive: '3.1 s',
  });
  const parsed = new URL(requestUrl);
  assert.strictEqual(parsed.pathname, '/pagespeedonline/v5/runPagespeed');
  assert.strictEqual(parsed.searchParams.get('url'), 'https://example.test/');
  assert.strictEqual(parsed.searchParams.get('strategy'), 'desktop');
  assert.deepStrictEqual(parsed.searchParams.getAll('category'), ['performance', 'accessibility', 'best-practices', 'seo']);
  assert.strictEqual(parsed.searchParams.get('key'), 'private-test-key');
  assert.strictEqual(requestCount, 1);
}

async function testMissingMetricsAreNull() {
  const service = new PageSpeedService({
    apiKey: 'key',
    fetch: (async () => okResponse({ lighthouseResult: { categories: {}, audits: {} } })) as typeof fetch,
  });
  assert.deepStrictEqual(await service.runAudit('https://example.test/'), {
    performance: null,
    accessibility: null,
    bestPractices: null,
    seo: null,
    firstContentfulPaint: null,
    largestContentfulPaint: null,
    speedIndex: null,
    totalBlockingTime: null,
    cumulativeLayoutShift: null,
    timeToInteractive: null,
  });
}

async function test429RetriesOnce() {
  let requests = 0;
  const delays: number[] = [];
  const service = new PageSpeedService({
    apiKey: 'key',
    retryDelayMs: 17,
    sleep: async (ms) => { delays.push(ms); },
    fetch: (async () => ++requests === 1 ? okResponse({}, 429) : okResponse(successPayload())) as typeof fetch,
  });
  const result = await service.runAudit('https://example.test/');
  assert.strictEqual(result.performance, 99);
  assert.strictEqual(requests, 2);
  assert.deepStrictEqual(delays, [17]);
}

async function testServerErrorRetriesOnce() {
  let requests = 0;
  const service = new PageSpeedService({
    apiKey: 'key',
    sleep: async () => {},
    fetch: (async () => ++requests === 1 ? okResponse({}, 503) : okResponse(successPayload())) as typeof fetch,
  });
  await service.runAudit('https://example.test/');
  assert.strictEqual(requests, 2);
}

async function testClientErrorDoesNotRetry() {
  let requests = 0;
  const service = new PageSpeedService({
    apiKey: 'key',
    fetch: (async () => { requests++; return okResponse({}, 403); }) as typeof fetch,
  });
  await assert.rejects(() => service.runAudit('https://example.test/'), /HTTP 403/);
  assert.strictEqual(requests, 1);
}

async function testTimeoutAndNoKeyLogging() {
  const apiKey = 'secret-key-for-test';
  let requests = 0;
  const originalConsole = { log: console.log, warn: console.warn, error: console.error };
  const logs: string[] = [];
  console.log = ((...args: unknown[]) => logs.push(args.join(' '))) as typeof console.log;
  console.warn = ((...args: unknown[]) => logs.push(args.join(' '))) as typeof console.warn;
  console.error = ((...args: unknown[]) => logs.push(args.join(' '))) as typeof console.error;
  try {
    const service = new PageSpeedService({
      apiKey,
      timeoutMs: 5,
      fetch: ((_input: RequestInfo | URL, init?: RequestInit) => {
        requests++;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
        });
      }) as typeof fetch,
    });
    await assert.rejects(() => service.runAudit('https://example.test/'), /timed out/);
    assert.strictEqual(requests, 1, 'timeouts are not retried');
    assert.ok(!logs.join('\n').includes(apiKey), 'the API key never appears in logs');
  } finally {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }
}

async function run() {
  await testSuccessMappingAndRequestOptions();
  await testMissingMetricsAreNull();
  await test429RetriesOnce();
  await testServerErrorRetriesOnce();
  await testClientErrorDoesNotRetry();
  await testTimeoutAndNoKeyLogging();
  console.log('PageSpeed Insights service tests passed.');
}

run().catch((error) => {
  console.error('PageSpeed Insights service tests failed:', error);
  process.exitCode = 1;
});
