import assert from 'assert';
import { EventEmitter } from 'events';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { LighthouseDiagnosticMetadata } from '../src/services/browser-diagnostics';
import { LighthouseService, stopChromeAndWait, waitForChromeDevTools, waitForLinuxProcessGroupExit } from '../src/services/lighthouse.service';
import { AnalysisConcurrencyQueue, isBrowserCleanupFailure } from '../src/services/analysis-concurrency';
import { ApiError } from '../src/errors/ApiError';

async function testProcessGroupWait() {
  const procRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'uiverdict-proc-fixture-'));
  const groupId = 456;
  const writeProcess = async (pid: number, state: string, processGroup = groupId) => {
    const processDir = path.join(procRoot, String(pid));
    await fs.promises.mkdir(processDir);
    await fs.promises.writeFile(path.join(processDir, 'stat'), `${pid} (chrome (fixture)) ${state} 1 ${processGroup} ${processGroup} 0 0 0`);
    await fs.promises.writeFile(path.join(processDir, 'cmdline'), ['chrome', '--type=renderer', '--token=private'].join(String.fromCharCode(0)));
  };

  try {
    await writeProcess(101, 'Z');
    await waitForLinuxProcessGroupExit(groupId, 50, procRoot, () => true);

    await fs.promises.rm(path.join(procRoot, '101'), { recursive: true, force: true });
    await writeProcess(202, 'S');
    const originalError = console.error;
    const timeoutLogs: unknown[][] = [];
    console.error = ((...args: unknown[]) => { timeoutLogs.push(args); }) as typeof console.error;
    try {
      await assert.rejects(
        waitForLinuxProcessGroupExit(groupId, 30, procRoot, () => true),
        /Timed out waiting for live Chrome process group members to exit: 202/,
      );
    } finally {
      console.error = originalError;
    }
    const timeoutLog = JSON.stringify(timeoutLogs);
    assert.ok(timeoutLog.includes('202') && timeoutLog.includes('S') && timeoutLog.includes('chrome'),
      'timeout logs include the surviving PID, state, and sanitized cmdline');
    assert.ok(!timeoutLog.includes('private'), 'timeout cmdlines redact secret-like arguments');
  } finally {
    await fs.promises.rm(procRoot, { recursive: true, force: true });
  }
}

async function testCleanupFailurePropagation() {
  const diagnosticError = new Error('diagnostics persistence failed');
  const fakeChrome = {
    process: { pid: 987, exitCode: null, signalCode: null },
    port: 12345,
    kill() {},
  } as any;
  const service = new LighthouseService({
    launchChrome: async () => fakeChrome,
    waitForChromeReady: async () => {},
    runLighthouse: async () => ({
      lhr: {
        categories: {},
        audits: {},
        finalDisplayedUrl: 'https://example.test/',
        runtimeError: null,
      },
      artifacts: {},
    }),
    stopChrome: async () => { throw new Error('process tree exit not confirmed'); },
  });
  const queue = new AnalysisConcurrencyQueue(1, 500);
  let nextStarted = false;
  const failedAudit = queue.run(
    () => service.runAudit('https://example.test/', async () => { throw diagnosticError; }),
    { analysisId: 'diagnostics-cleanup-failure', url: 'https://example.test/' },
  );
  const queuedAudit = queue.run(async () => { nextStarted = true; },
    { analysisId: 'must-stay-queued', url: 'https://example.test/next' });

  await assert.rejects(failedAudit, (error) => error === diagnosticError,
    'the original diagnostics/audit error propagates even when cleanup fails');
  await assert.rejects(queuedAudit, (error: any) => error instanceof ApiError && error.statusCode === 503,
    'cleanup failure marks the propagated error and fails the queue closed');
  assert.strictEqual(nextStarted, false);
}

async function testLauncherKillFailureAfterExit() {
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = ((...args: unknown[]) => { warnings.push(args); }) as typeof console.warn;
  const chrome = {
    process: { pid: 321, exitCode: 0, signalCode: null },
    port: 12345,
    kill() { throw new Error('profile cleanup failed'); },
  } as any;
  try {
    const queue = new AnalysisConcurrencyQueue(1, 500);
    await queue.run(() => stopChromeAndWait(chrome, async () => {}),
      { analysisId: 'launcher-kill-warning', url: 'https://example.test/' });
    let nextStarted = false;
    await queue.run(async () => { nextStarted = true; },
      { analysisId: 'after-launcher-kill-warning', url: 'https://example.test/next' });
    assert.strictEqual(nextStarted, true, 'launcher cleanup failure after confirmed process exit does not poison the queue');
    assert.ok(warnings.some((args) => String(args[0]).includes('process tree exited')),
      'launcher bookkeeping failure is logged as a warning');
  } finally {
    console.warn = originalWarn;
  }
}

async function testAuditTimeoutKillsChromeAndUsesResourceSettings() {
  const chrome = {
    process: { pid: 654, exitCode: null, signalCode: null },
    port: 23456,
    kill() {},
  } as any;
  let launchOptions: any;
  let lighthouseFlags: any;
  let lighthouseConfig: any;
  let killTreeCalls = 0;
  let lighthouseCalls = 0;
  const service = new LighthouseService({
    launchChrome: async (options: any) => { launchOptions = options; return chrome; },
    waitForChromeReady: async () => {},
    runLighthouse: async (_url, flags, config) => {
      lighthouseCalls++;
      lighthouseFlags = flags;
      lighthouseConfig = config;
      return new Promise(() => {});
    },
    killChromeProcessTree: async () => { killTreeCalls++; },
    stopChrome: async () => {},
    auditTimeoutMs: 10,
  });

  await assert.rejects(
    service.runAudit('https://example.test/'),
    (error: any) => error instanceof ApiError && error.statusCode === 504 && /timeout/.test(error.message),
    'audit timeout should fail with the compatible gateway timeout error',
  );
  assert.strictEqual(lighthouseCalls, 1, 'a timeout should fail fast without retrying the audit');
  assert.strictEqual(killTreeCalls, 1, 'the Chrome process tree is terminated before timeout propagation');
  assert.ok(launchOptions.chromeFlags.includes('--renderer-process-limit=1'));
  assert.ok(launchOptions.chromeFlags.includes('--headless=new'));
  assert.ok(launchOptions.chromeFlags.includes('--disable-gpu'));
  assert.ok(launchOptions.chromeFlags.includes('--disable-software-rasterizer'));
  assert.ok(launchOptions.chromeFlags.includes('--disable-dev-shm-usage'));
  assert.ok(launchOptions.chromeFlags.includes('--mute-audio'));
  assert.ok(launchOptions.chromeFlags.includes('--disable-extensions'));
  assert.ok(launchOptions.chromeFlags.includes('--disable-background-networking'));
  assert.ok(launchOptions.chromeFlags.includes('--disable-component-update'));
  assert.ok(launchOptions.chromeFlags.includes('--js-flags=--max-old-space-size=192'));
  assert.strictEqual(launchOptions.chromeFlags.includes('--disable-features=site-per-process'), false,
    'site isolation remains enabled');
  assert.strictEqual(lighthouseConfig.settings.disableFullPageScreenshot, true);
  assert.deepStrictEqual(lighthouseConfig.settings.skipAudits, ['screenshot-thumbnails']);
  assert.deepStrictEqual(lighthouseFlags.onlyCategories, ['performance', 'accessibility', 'best-practices', 'seo']);
}

async function testAbortCleanupFailureIsMarked() {
  const chrome = {
    process: { pid: 655, exitCode: null, signalCode: null },
    port: 23457,
    kill() {},
  } as any;
  let resolveAuditStarted!: () => void;
  const auditStarted = new Promise<void>((resolve) => { resolveAuditStarted = resolve; });
  let killTreeCalls = 0;
  let monitorStops = 0;
  const service = new LighthouseService({
    launchChrome: async () => chrome,
    waitForChromeReady: async () => {},
    runLighthouse: async () => {
      resolveAuditStarted();
      return new Promise(() => {});
    },
    killChromeProcessTree: async () => { killTreeCalls++; throw new Error('could not confirm process exit'); },
    stopChrome: async () => {},
  });
  const controller = new AbortController();
  const audit = service.runAudit('https://example.test/', undefined, controller.signal, undefined, undefined, {
    readAnonBytes: async () => 0,
    thresholdBytes: 850,
    pollIntervalMs: 1000,
    onStop: () => { monitorStops++; },
  });
  await auditStarted;
  controller.abort('memory limit');
  await assert.rejects(audit, (error: unknown) => isBrowserCleanupFailure(error) && /memory limit/.test((error as Error).message),
    'cleanup failure while aborting Lighthouse marks the original abort error for fail-closed handling');
  assert.strictEqual(killTreeCalls, 1);
  assert.strictEqual(monitorStops, 1, 'poller stops in finally even when cleanup fails');
}

async function testChildProcessIsKilledOnAbort() {
  const chrome = {
    process: { pid: 656, exitCode: null, signalCode: null },
    port: 23458,
    kill() {},
  } as any;
  class FakeWorker extends EventEmitter {
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    killed = false;
    send(_message: unknown, callback?: (error: Error | null) => void) {
      callback?.(null);
      resolveStarted();
      return true;
    }
    kill() {
      this.killed = true;
      this.signalCode = 'SIGKILL';
      queueMicrotask(() => this.emit('exit', null, 'SIGKILL'));
      return true;
    }
  }
  let resolveStarted!: () => void;
  const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
  const worker = new FakeWorker();
  let chromeTreeKills = 0;
  let workerExecArgv: string[] = [];
  const service = new LighthouseService({
    launchChrome: async () => chrome,
    waitForChromeReady: async () => {},
    forkWorker: ((_modulePath: string, _args: string[], options: any) => {
      workerExecArgv = options.execArgv;
      return worker as any;
    }) as any,
    killChromeProcessTree: async () => { chromeTreeKills++; },
    stopChrome: async () => {},
  });
  const controller = new AbortController();
  const audit = service.runAudit('https://example.test/', undefined, controller.signal, undefined,
    ['accessibility', 'best-practices', 'seo']);
  await started;
  controller.abort('memory limit');
  await assert.rejects(audit, (error: any) => error?.lighthouseAbort === true && /memory limit/.test(error.message));
  assert.strictEqual(worker.killed, true, 'the Lighthouse child receives a hard termination on abort');
  assert.ok(workerExecArgv.includes('--max-old-space-size=256'), 'Lighthouse child is launched with a 256 MB heap limit');
  assert.ok(chromeTreeKills >= 1, 'the Chrome process tree is also terminated on abort');
}

async function testMemoryAbortRetriesWithoutPerformance() {
  const chrome = () => ({
    process: { pid: 700, exitCode: null, signalCode: null },
    port: 24000,
    kill() {},
  } as any);
  let launches = 0;
  const categoryRequests: string[][] = [];
  let resolveFirstAudit!: () => void;
  const firstAuditStarted = new Promise<void>((resolve) => { resolveFirstAudit = resolve; });
  const service = new LighthouseService({
    launchChrome: async () => { launches++; return chrome(); },
    waitForChromeReady: async () => {},
    runLighthouse: async (_url, flags) => {
      categoryRequests.push([...(flags.onlyCategories as string[])]);
      if (categoryRequests.length === 1) {
        resolveFirstAudit();
        return new Promise(() => {});
      }
      return {
        lhr: {
          categories: {
            accessibility: { score: 0.91 },
            'best-practices': { score: 0.82 },
            seo: { score: 0.73 },
          },
          audits: {},
          finalDisplayedUrl: 'https://example.test/',
          runtimeError: null,
        },
        artifacts: {},
      };
    },
    killChromeProcessTree: async () => {},
    stopChrome: async () => {},
    auditTimeoutMs: 1000,
  });
  const memoryAbort = new AbortController();
  const audit = service.runAudit('https://example.test/', undefined, memoryAbort.signal);
  await firstAuditStarted;
  memoryAbort.abort('memory limit');
  const metrics = await audit;

  assert.strictEqual(launches, 2, 'the reduced audit starts only after the aborted Chrome is cleaned up');
  assert.deepStrictEqual(categoryRequests, [
    ['performance', 'accessibility', 'best-practices', 'seo'],
    ['accessibility', 'best-practices', 'seo'],
  ]);
  assert.strictEqual(metrics.performance, null);
  assert.strictEqual(metrics.accessibility, 91);
  assert.strictEqual(metrics.bestPractices, 82);
  assert.strictEqual(metrics.seo, 73);
}

async function testMemorySafeAuditDoesNotRepeatTheSameCategories() {
  const chrome = () => ({
    process: { pid: 701, exitCode: null, signalCode: null },
    port: 24001,
    kill() {},
  } as any);
  let launches = 0;
  let resolveAuditStarted!: () => void;
  const auditStarted = new Promise<void>((resolve) => { resolveAuditStarted = resolve; });
  const categoryRequests: string[][] = [];
  const service = new LighthouseService({
    launchChrome: async () => { launches++; return chrome(); },
    waitForChromeReady: async () => {},
    runLighthouse: async (_url, flags) => {
      categoryRequests.push([...(flags.onlyCategories as string[])]);
      resolveAuditStarted();
      return new Promise(() => {});
    },
    killChromeProcessTree: async () => {},
    stopChrome: async () => {},
  });
  const memoryAbort = new AbortController();
  const audit = service.runAudit('https://example.test/', undefined, memoryAbort.signal, undefined,
    ['accessibility', 'best-practices', 'seo']);
  await auditStarted;
  memoryAbort.abort('memory limit');
  await assert.rejects(audit, /Lighthouse audit aborted: memory limit/);
  assert.strictEqual(launches, 1, 'an already reduced audit must not launch a duplicate retry with identical categories');
  assert.deepStrictEqual(categoryRequests, [['accessibility', 'best-practices', 'seo']]);
}

async function testMemoryAbortWinsChromeConnectionClosedRace() {
  const chrome = {
    process: { pid: 702, exitCode: null, signalCode: null },
    port: 24002,
    kill() {},
  } as any;
  const controller = new AbortController();
  let rejectAudit!: (error: Error) => void;
  let resolveAuditStarted!: () => void;
  const auditStarted = new Promise<void>((resolve) => { resolveAuditStarted = resolve; });
  let launches = 0;
  let cleanupCompleted = false;
  controller.signal.addEventListener('abort', () => rejectAudit(new Error('Connection closed.')), { once: true });
  const service = new LighthouseService({
    launchChrome: async () => { launches++; return chrome; },
    waitForChromeReady: async () => {},
    runLighthouse: async () => new Promise((_resolve, reject) => {
      rejectAudit = reject;
      resolveAuditStarted();
    }),
    killChromeProcessTree: async () => { cleanupCompleted = true; },
    stopChrome: async () => {},
  });
  const audit = service.runAudit('https://example.test/', undefined, controller.signal, undefined,
    ['accessibility', 'best-practices', 'seo']);
  await auditStarted;
  controller.abort('memory limit');
  await assert.rejects(audit, (error: any) => error?.lighthouseAbort === true && /memory limit/.test(error.message),
    'memory abort must be retained when Chrome closure rejects Lighthouse first');
  assert.strictEqual(cleanupCompleted, true, 'abort is not propagated before Chrome cleanup finishes');
  assert.strictEqual(launches, 1, 'the masked connection error must not trigger another Chrome launch');
}

async function testPerAttemptMemoryMonitorStopsBeforeRetry() {
  const makeChrome = (pid: number, port: number) => ({
    process: { pid, exitCode: null as number | null, signalCode: null as string | null, killed: false },
    port,
    kill() {},
  } as any);
  let launches = 0;
  let monitorStops = 0;
  let reads = 0;
  let readsAtAbort = 0;
  let firstRunnerStarted = false;
  let rejectFirstAudit!: (error: Error) => void;
  let resolveFirstAuditStarted!: () => void;
  const firstAuditStarted = new Promise<void>((resolve) => { resolveFirstAuditStarted = resolve; });
  const categoryRequests: string[][] = [];
  const service = new LighthouseService({
    launchChrome: async () => {
      launches++;
      if (launches === 2) assert.strictEqual(monitorStops, 1, 'the previous monitor is fully stopped before retry launch');
      return makeChrome(800 + launches, 25000 + launches);
    },
    waitForChromeReady: async () => {},
    runLighthouse: async (_url, flags) => {
      categoryRequests.push([...(flags.onlyCategories as string[])]);
      if (categoryRequests.length === 1) {
        firstRunnerStarted = true;
        resolveFirstAuditStarted();
        return new Promise((_resolve, reject) => { rejectFirstAudit = reject; });
      }
      return {
        lhr: {
          categories: { accessibility: { score: 0.9 }, 'best-practices': { score: 0.8 }, seo: { score: 0.7 } },
          audits: {}, finalDisplayedUrl: 'https://example.test/', runtimeError: null,
        },
        artifacts: {},
      };
    },
    killChromeProcessTree: async () => {
      rejectFirstAudit(new Error('Connection closed.'));
    },
    stopChrome: async (chrome) => { (chrome.process as any).exitCode = 0; },
  });

  const result = service.runAudit('https://example.test/', undefined, undefined, undefined, undefined, {
    readAnonBytes: async () => {
      if (!firstRunnerStarted) return 0;
      const samples = [900, 900, 0, 900, 900, 900, 0];
      return samples[reads++] ?? 0;
    },
    thresholdBytes: 850,
    pollIntervalMs: 1,
    onAbort: () => { readsAtAbort = reads; },
    onStop: () => { monitorStops++; },
  });
  await firstAuditStarted;
  const metrics = await result;
  assert.strictEqual(launches, 2);
  assert.strictEqual(monitorStops, 2, 'each attempt stops its own memory monitor');
  assert.strictEqual(readsAtAbort, 6, 'an intervening below-threshold sample resets the consecutive-sample count');
  assert.deepStrictEqual(categoryRequests, [
    ['performance', 'accessibility', 'best-practices', 'seo'],
    ['accessibility', 'best-practices', 'seo'],
  ]);
  assert.strictEqual(metrics.accessibility, 90);
}

async function testChromeReadinessRetriesAndFailureCleansUp() {
  let readinessRequests = 0;
  const server = http.createServer((_request, response) => {
    readinessRequests++;
    if (readinessRequests === 1) response.writeHead(503).end('starting');
    else response.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${(server.address() as any).port}/devtools/browser/test` }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port as number;
  try {
    await waitForChromeDevTools(port);
    assert.strictEqual(readinessRequests, 2, 'Chrome readiness retries a short initial unavailable response');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  const chrome = {
    process: { pid: 902, exitCode: null as number | null, signalCode: null as string | null, killed: false },
    port: 25902,
    kill() {},
  } as any;
  let auditCalls = 0;
  let cleanupCalls = 0;
  const logs: unknown[][] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = ((...args: unknown[]) => { logs.push(args); }) as typeof console.log;
  console.error = ((...args: unknown[]) => { logs.push(args); }) as typeof console.error;
  try {
    const service = new LighthouseService({
      launchChrome: async () => chrome,
      waitForChromeReady: async () => { throw new Error('Chrome DevTools readiness failed: endpoint unavailable'); },
      runLighthouse: async () => { auditCalls++; throw new Error('must not reach Lighthouse'); },
      stopChrome: async (launchedChrome) => {
        cleanupCalls++;
        (launchedChrome.process as any).exitCode = 0;
      },
    });
    await assert.rejects(() => service.runAudit('https://example.test/'), /Chrome DevTools readiness failed/);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  assert.strictEqual(auditCalls, 0, 'Lighthouse does not start until the DevTools endpoint is ready');
  assert.strictEqual(cleanupCalls, 2, 'each Chrome launch is cleaned up after readiness failure and existing retry policy');
  assert.ok(logs.some((args) => JSON.stringify(args).includes('exitCode') && JSON.stringify(args).includes('0')),
    'readiness failure logs Chrome exit state after cleanup');
}

async function run() {
  await testProcessGroupWait();
  await testCleanupFailurePropagation();
  await testLauncherKillFailureAfterExit();
  await testAuditTimeoutKillsChromeAndUsesResourceSettings();
  await testAbortCleanupFailureIsMarked();
  await testChildProcessIsKilledOnAbort();
  await testMemoryAbortRetriesWithoutPerformance();
  await testMemorySafeAuditDoesNotRepeatTheSameCategories();
  await testMemoryAbortWinsChromeConnectionClosedRace();
  await testPerAttemptMemoryMonitorStopsBeforeRetry();
  await testChromeReadinessRetriesAndFailureCleansUp();
  const profileRoot = os.tmpdir();
  const profilesBefore = new Set((await fs.promises.readdir(profileRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('lighthouse.'))
    .map((entry) => entry.name));
  const server = http.createServer((request, response) => {
    if (request.url === '/unavailable') {
      response.writeHead(503, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Unavailable</title><main>Temporarily unavailable</main>');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Local audit</title><main><h1>Local Lighthouse diagnostic fixture</h1></main>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const service = new LighthouseService();
  const completedDiagnostics: LighthouseDiagnosticMetadata[] = [];
  const errorPageDiagnostics: LighthouseDiagnosticMetadata[] = [];
  const cleanupWarnings: string[] = [];
  const cleanupCompletions: string[] = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = ((...args: unknown[]) => {
    if (String(args[0]).includes('Warning closing Chrome')) cleanupWarnings.push(args.map(String).join(' '));
    originalError(...args);
  }) as typeof console.error;
  console.log = ((...args: unknown[]) => {
    if (String(args[0]).includes('Chrome process exited and cleanup completed')) cleanupCompletions.push(String(args[0]));
    originalLog(...args);
  }) as typeof console.log;
  try {
    const metrics = await service.runAudit(`http://127.0.0.1:${address.port}/`, async (diagnostics) => {
      completedDiagnostics.push(diagnostics);
    });
    assert.strictEqual(typeof metrics.performance, 'number');
    assert.strictEqual(completedDiagnostics.at(-1)?.outcome, 'AUDIT_COMPLETED');
    assert.strictEqual(completedDiagnostics.at(-1)?.navigationResponseStatus, 200);
    assert.strictEqual(completedDiagnostics.at(-1)?.navigationStatusObserved, true);
    assert.strictEqual(cleanupCompletions.length, 1, 'runAudit resolves only after its Chrome process exits and cleanup completes');

    await assert.rejects(() => service.runAudit(`http://127.0.0.1:${address.port}/unavailable`, async (diagnostics) => {
      errorPageDiagnostics.push(diagnostics);
    }));
    assert.strictEqual(errorPageDiagnostics.at(-1)?.outcome, 'NAVIGATION_FAILED', 'HTTP error navigation must not be confused with a poor completed audit');
    assert.strictEqual(errorPageDiagnostics.at(-1)?.navigationResponseStatus, 503, JSON.stringify(errorPageDiagnostics.at(-1)));
    assert.deepStrictEqual(cleanupWarnings, [], 'Chrome cleanup must not race temporary profile deletion');
  } finally {
    console.error = originalError;
    console.log = originalLog;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  const newProfiles = (await fs.promises.readdir(profileRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('lighthouse.') && !profilesBefore.has(entry.name))
    .map((entry) => path.join(profileRoot, entry.name));
  assert.deepStrictEqual(newProfiles, [], 'Lighthouse must remove every temporary profile it created');
  console.log('Lighthouse navigation diagnostics tests passed.');
}

run().catch((error) => {
  console.error('Lighthouse diagnostics tests failed:', error);
  process.exitCode = 1;
});
