import assert from 'assert';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { LighthouseDiagnosticMetadata } from '../src/services/browser-diagnostics';
import { LighthouseService, stopChromeAndWait, waitForLinuxProcessGroupExit } from '../src/services/lighthouse.service';
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
  assert.ok(launchOptions.chromeFlags.includes('--disable-extensions'));
  assert.ok(launchOptions.chromeFlags.includes('--disable-background-networking'));
  assert.ok(launchOptions.chromeFlags.includes('--disable-component-update'));
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
  const service = new LighthouseService({
    launchChrome: async () => chrome,
    runLighthouse: async () => {
      resolveAuditStarted();
      return new Promise(() => {});
    },
    killChromeProcessTree: async () => { killTreeCalls++; throw new Error('could not confirm process exit'); },
    stopChrome: async () => {},
  });
  const controller = new AbortController();
  const audit = service.runAudit('https://example.test/', undefined, controller.signal);
  await auditStarted;
  controller.abort('memory limit');
  await assert.rejects(audit, (error: unknown) => isBrowserCleanupFailure(error) && /memory limit/.test((error as Error).message),
    'cleanup failure while aborting Lighthouse marks the original abort error for fail-closed handling');
  assert.strictEqual(killTreeCalls, 1);
}

async function run() {
  await testProcessGroupWait();
  await testCleanupFailurePropagation();
  await testLauncherKillFailureAfterExit();
  await testAuditTimeoutKillsChromeAndUsesResourceSettings();
  await testAbortCleanupFailureIsMarked();
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
