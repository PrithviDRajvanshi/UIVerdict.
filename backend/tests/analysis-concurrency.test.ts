import assert from 'assert';
import { AnalysisStatus } from '@prisma/client';
import { ApiError } from '../src/errors/ApiError';
import { AnalysisConcurrencyQueue, markBrowserCleanupFailure } from '../src/services/analysis-concurrency';
import { AnalysisService } from '../src/services/analysis.service';
import { postgresRepository } from '../src/repositories/postgres/postgres.repository';
import { playwrightService } from '../src/services/playwright.service';
import { lighthouseService } from '../src/services/lighthouse.service';
import { geminiService } from '../src/services/gemini.service';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function testQueuePrimitives(): Promise<void> {
  const queue = new AnalysisConcurrencyQueue(2, 500);
  let active = 0;
  let peak = 0;
  const held = deferred();
  const firstStarted = deferred();
  const run = async (wait = false) => {
    active += 1;
    peak = Math.max(peak, active);
    if (wait) {
      firstStarted.resolve();
      await held.promise;
    }
    active -= 1;
  };
  const firstQueueJob = queue.run(() => run(true), { analysisId: 'queue-1', url: 'https://example.com/?token=hidden' });
  await firstStarted.promise;
  let secondStarted = false;
  const second = queue.run(async () => { secondStarted = true; await run(); }, { analysisId: 'queue-2', url: 'https://example.com/' });
  assert.strictEqual(secondStarted, false, 'the second job remains queued while the first is active');
  held.resolve();
  await Promise.all([firstQueueJob, second]);
  assert.strictEqual(peak, 1, 'queued work never overlaps the active job');

  const failureQueue = new AnalysisConcurrencyQueue(2, 500);
  const hold = deferred();
  const started = deferred();
  const first = failureQueue.run(async () => {
    started.resolve();
    await hold.promise;
    throw new Error('expected failure');
  }, { analysisId: 'failed', url: 'https://example.com/fail' });
  await started.promise;
  const next = failureQueue.run(async () => 'next completed', { analysisId: 'next', url: 'https://example.com/next' });
  hold.resolve();
  await assert.rejects(first, /expected failure/);
  assert.strictEqual(await next, 'next completed', 'a failed job releases its queue slot');

  const limitQueue = new AnalysisConcurrencyQueue(1, 500);
  const limitHold = deferred();
  const limitStarted = deferred();
  const activeJob = limitQueue.run(async () => {
    limitStarted.resolve();
    await limitHold.promise;
  }, { analysisId: 'limit-active', url: 'https://example.com/' });
  await limitStarted.promise;
  const queuedJob = limitQueue.run(async () => 'queued', { analysisId: 'limit-queued', url: 'https://example.com/' });
  await assert.rejects(
    limitQueue.run(async () => 'overflow', { analysisId: 'overflow', url: 'https://example.com/' }),
    (error: any) => error instanceof ApiError && error.statusCode === 503,
    'the configured queue limit returns a compatible 503',
  );
  limitHold.resolve();
  await Promise.all([activeJob, queuedJob]);

  const timeoutQueue = new AnalysisConcurrencyQueue(1, 20);
  const timeoutHold = deferred();
  const timeoutStarted = deferred();
  const longJob = timeoutQueue.run(async () => {
    timeoutStarted.resolve();
    await timeoutHold.promise;
  }, { analysisId: 'timeout-active', url: 'https://example.com/' });
  await timeoutStarted.promise;
  await assert.rejects(
    timeoutQueue.run(async () => 'must not run', { analysisId: 'timeout-queued', url: 'https://example.com/' }),
    (error: any) => error instanceof ApiError && error.statusCode === 503 && /timed out/.test(error.message),
    'queue wait expires within the configured request wait bound',
  );
  timeoutHold.resolve();
  await longJob;

  const cancelQueue = new AnalysisConcurrencyQueue(1, 500);
  const cancelHold = deferred();
  const cancelStarted = deferred();
  const activeCancelable = cancelQueue.run(async () => {
    cancelStarted.resolve();
    await cancelHold.promise;
  }, { analysisId: 'cancel-active', url: 'https://example.com/' });
  await cancelStarted.promise;
  const abortController = new AbortController();
  let abandonedStarted = false;
  const abandoned = cancelQueue.run(async () => { abandonedStarted = true; },
    { analysisId: 'cancel-queued', url: 'https://example.com/' }, abortController.signal);
  abortController.abort();
  await assert.rejects(abandoned, (error: any) => error instanceof ApiError && error.statusCode === 503);
  cancelHold.resolve();
  await activeCancelable;
  assert.strictEqual(abandonedStarted, false, 'a disconnected queued request is never started');

  const cleanupQueue = new AnalysisConcurrencyQueue(2, 500);
  const cleanupHold = deferred();
  const cleanupStarted = deferred();
  const cleanupError = new Error('browser cleanup was not confirmed');
  markBrowserCleanupFailure(cleanupError);
  const cleanupFailedJob = cleanupQueue.run(async () => {
    cleanupStarted.resolve();
    await cleanupHold.promise;
    throw cleanupError;
  }, { analysisId: 'cleanup-failed', url: 'https://example.com/' });
  await cleanupStarted.promise;
  let unsafeJobStarted = false;
  const unsafeQueuedJob = cleanupQueue.run(async () => { unsafeJobStarted = true; },
    { analysisId: 'must-not-start', url: 'https://example.com/' });
  cleanupHold.resolve();
  await assert.rejects(cleanupFailedJob, (error) => error === cleanupError);
  await assert.rejects(unsafeQueuedJob, (error: any) => error instanceof ApiError && error.statusCode === 503);
  await assert.rejects(
    cleanupQueue.run(async () => {}, { analysisId: 'future', url: 'https://example.com/' }),
    (error: any) => error instanceof ApiError && error.statusCode === 503,
    'unconfirmed browser cleanup fails closed without leaving the active slot occupied',
  );
  assert.strictEqual(unsafeJobStarted, false, 'no queued browser work starts after cleanup becomes uncertain');
}

async function testAnalysisPipelineSerialization(): Promise<void> {
  const original = {
    create: postgresRepository.createAnalysisTransaction,
    save: postgresRepository.saveAnalysisResult,
    updateStatus: postgresRepository.updateAnalysisStatus,
    updatePlaywright: postgresRepository.updatePlaywrightDiagnostics,
    updateLighthouse: postgresRepository.updateLighthouseDiagnostics,
    screenshotIdentity: postgresRepository.updateScreenshotIdentity,
    capture: playwrightService.captureScreenshot,
    remove: playwrightService.removeScreenshot,
    audit: lighthouseService.runAudit,
    gemini: geminiService.generateAnalysis,
  };

  let id = 0;
  let activePipelines = 0;
  let peakPipelines = 0;
  const started: string[] = [];
  const events: string[] = [];
  const firstCaptureStarted = deferred();
  const releaseFirstCapture = deferred();
  const disconnectedCaptureStarted = deferred();
  const releaseDisconnectedCapture = deferred();
  const secondQueued = deferred();
  const afterDisconnectQueued = deferred();
  const originalInfo = console.info;
  let screenshotCleanupFailure: Error | null = null;
  const lighthouseFailure = new ApiError(500, 'Lighthouse audit failed');
  let persistedInput: any = null;
  const geminiInputs: any[] = [];
  (console as any).info = (...args: any[]) => {
    originalInfo(...args);
    if (String(args[0]).includes('Analysis queued') && args[1]?.analysisId === 'concurrency-analysis-2') secondQueued.resolve();
    if (String(args[0]).includes('Analysis queued') && args[1]?.analysisId === 'concurrency-analysis-8') afterDisconnectQueued.resolve();
  };
  try {
    postgresRepository.createAnalysisTransaction = async () => ({
      project: {} as any,
      analysis: { id: `concurrency-analysis-${++id}`, status: AnalysisStatus.PROCESSING } as any,
    });
    postgresRepository.saveAnalysisResult = async (_id, input) => {
      events.push('persist');
      activePipelines -= 1;
      persistedInput = input;
      return {} as any;
    };
    postgresRepository.updateAnalysisStatus = async () => ({} as any);
    postgresRepository.updatePlaywrightDiagnostics = async () => ({} as any);
    postgresRepository.updateLighthouseDiagnostics = async () => ({} as any);
    postgresRepository.updateScreenshotIdentity = async () => ({} as any);
    playwrightService.captureScreenshot = async (url) => {
      started.push(url);
      events.push('playwright:start');
      activePipelines += 1;
      peakPipelines = Math.max(peakPipelines, activePipelines);
      if (url.endsWith('/first')) {
        firstCaptureStarted.resolve();
        await releaseFirstCapture.promise;
      }
      if (url.endsWith('/disconnect')) {
        disconnectedCaptureStarted.resolve();
        await releaseDisconnectedCapture.promise;
      }
      if (url.endsWith('/fail')) {
        events.push('playwright:browser-closed');
        activePipelines -= 1;
        throw new Error('forced screenshot failure');
      }
      events.push('playwright:browser-closed');
      return { url, filename: `test-${started.length}.png`, path: 'temp/test.png', sha256: 'a'.repeat(64) };
    };
    playwrightService.removeScreenshot = async (artifact) => {
      events.push('screenshot:removed');
      if (artifact.url.endsWith('/disconnect')) activePipelines -= 1;
      if (screenshotCleanupFailure) throw screenshotCleanupFailure;
    };
    lighthouseService.runAudit = async (url) => {
      events.push('lighthouse:start');
      events.push('lighthouse:chrome-closed');
      if (url.endsWith('/lighthouse-fail')) throw lighthouseFailure;
      return {
        performance: 80, accessibility: 80, bestPractices: 80, seo: 80,
        firstContentfulPaint: '1 s', largestContentfulPaint: '2 s', speedIndex: '1 s',
        totalBlockingTime: '10 ms', cumulativeLayoutShift: '0', timeToInteractive: '2 s',
      };
    };
    geminiService.generateAnalysis = async (input) => {
      events.push('gemini:start');
      geminiInputs.push(input);
      if (input.url.endsWith('/gemini-fail')) throw new Error('forced Gemini failure');
      return { visualDesignScore: 80, qualitativeCritique: [], strengths: [], areasForRefinement: [] };
    };

    const service = new AnalysisService();
    const first = service.analyzeUrl('https://example.com/first');
    await firstCaptureStarted.promise;
    const second = service.analyzeUrl('https://example.com/second');
    await secondQueued.promise;
    assert.deepStrictEqual(started, ['https://example.com/first'], 'the second analysis waits before starting Playwright');
    releaseFirstCapture.resolve();
    const [firstResponse] = await Promise.all([first, second]);
    assert.strictEqual(peakPipelines, 1, 'screenshot, Lighthouse, and Gemini analysis are serialized as one pipeline');
    assert.deepStrictEqual(events.slice(0, 14), [
      'playwright:start', 'playwright:browser-closed', 'gemini:start', 'screenshot:removed', 'persist',
      'playwright:start', 'playwright:browser-closed', 'gemini:start', 'screenshot:removed', 'persist',
    ], 'visual mode runs only Playwright and Gemini, then deletes its screenshot before persistence');
    assert.strictEqual(firstResponse.data.aiStatus, 'AVAILABLE');
    assert.deepStrictEqual(Object.keys(firstResponse.data).sort(), [
      'aiAnalysis', 'aiStatus', 'id', 'metrics', 'mode', 'overallScore', 'partial', 'targetValidationStatus', 'technicalUnavailable',
      'technicalUnavailableReason', 'url', 'verdictLabel', 'visualDesignScore',
    ], 'successful response fields remain unchanged');
    assert.strictEqual(persistedInput.screenshotArtifactName, 'test-2.png');
    assert.strictEqual(persistedInput.screenshotSha256, 'a'.repeat(64));
    assert.strictEqual(geminiInputs[0].screenshot.filename, 'test-1.png');
    assert.strictEqual('metrics' in geminiInputs[0], false, 'Gemini receives no Lighthouse metrics');

    const failed = service.analyzeUrl('https://example.com/fail');
    await assert.rejects(failed, /forced screenshot failure/);
    const following = await service.analyzeUrl('https://example.com/following');
    assert.strictEqual(following.status, 'success', 'a failed analysis does not block its successor');

    const lighthouseEventsStart = events.length;
    screenshotCleanupFailure = new Error('forced screenshot cleanup failure');
    await assert.rejects(
      service.analyzeUrl('https://example.com/lighthouse-fail', undefined, undefined, 'tech'),
      (error: any) => error.statusCode === 503,
      'technical mode fails when its Lighthouse section is unavailable',
    );
    screenshotCleanupFailure = null;
    assert.deepStrictEqual(events.slice(lighthouseEventsStart), ['lighthouse:start', 'lighthouse:chrome-closed'],
      'technical mode runs Lighthouse only and does not persist an unavailable section');

    screenshotCleanupFailure = new Error('forced screenshot cleanup failure after Gemini');
    await assert.rejects(service.analyzeUrl('https://example.com/gemini-fail'), (error: any) => error.statusCode === 503,
      'visual mode fails when its Gemini section is unavailable');
    screenshotCleanupFailure = null;
    assert.deepStrictEqual(events.slice(-3), ['playwright:browser-closed', 'gemini:start', 'screenshot:removed'],
      'Gemini failure still removes the screenshot and does not start Lighthouse');

    const client = new AbortController();
    const disconnected = service.analyzeUrl('https://example.com/disconnect', undefined, client.signal);
    await disconnectedCaptureStarted.promise;
    const afterDisconnect = service.analyzeUrl('https://example.com/after-disconnect');
    await afterDisconnectQueued.promise;
    client.abort();
    releaseDisconnectedCapture.resolve();
    await assert.rejects(disconnected, /cancelled/);
    assert.strictEqual((await afterDisconnect).status, 'success', 'client disconnect unwinds the active pipeline and releases its slot');
  } finally {
    console.info = originalInfo;
    postgresRepository.createAnalysisTransaction = original.create;
    postgresRepository.saveAnalysisResult = original.save;
    postgresRepository.updateAnalysisStatus = original.updateStatus;
    postgresRepository.updatePlaywrightDiagnostics = original.updatePlaywright;
    postgresRepository.updateLighthouseDiagnostics = original.updateLighthouse;
    postgresRepository.updateScreenshotIdentity = original.screenshotIdentity;
    playwrightService.captureScreenshot = original.capture;
    playwrightService.removeScreenshot = original.remove;
    lighthouseService.runAudit = original.audit;
    geminiService.generateAnalysis = original.gemini;
  }
}

testQueuePrimitives()
  .then(testAnalysisPipelineSerialization)
  .then(() => console.log('Analysis concurrency tests passed.'))
  .catch((error) => {
    console.error('Analysis concurrency tests failed:', error);
    process.exitCode = 1;
  });
