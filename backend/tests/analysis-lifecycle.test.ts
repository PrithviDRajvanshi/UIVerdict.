import assert from 'assert';
import '../src/middleware/auth.middleware';
import { AnalysisService } from '../src/services/analysis.service';
import { postgresRepository } from '../src/repositories/postgres/postgres.repository';
import { playwrightService } from '../src/services/playwright.service';
import { lighthouseService } from '../src/services/lighthouse.service';
import { geminiService } from '../src/services/gemini.service';
import { AnalysisStatus } from '@prisma/client';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TargetPageValidationError } from '../src/services/target-page-validation';
import { markBrowserCleanupFailure } from '../src/services/analysis-concurrency';
import { analysisService } from '../src/services/analysis.service';
import { analyze } from '../src/controllers/analysis.controller';

async function runAnalysisLifecycleTests() {
  const original = {
    createAnalysisTransaction: postgresRepository.createAnalysisTransaction,
    saveAnalysisResult: postgresRepository.saveAnalysisResult,
    updateAnalysisStatus: postgresRepository.updateAnalysisStatus,
    updatePlaywrightDiagnostics: postgresRepository.updatePlaywrightDiagnostics,
    updateLighthouseDiagnostics: postgresRepository.updateLighthouseDiagnostics,
    updateScreenshotIdentity: postgresRepository.updateScreenshotIdentity,
    captureScreenshot: playwrightService.captureScreenshot,
    removeScreenshot: playwrightService.removeScreenshot,
    runAudit: lighthouseService.runAudit,
    generateAnalysis: geminiService.generateAnalysis,
  };

  const statuses: AnalysisStatus[] = [];
  let cleaned = 0;
  const stageEvents: string[] = [];
  const screenshot = {
    url: 'https://example.com',
    filename: 'temporary.png',
    path: 'temp/screenshots/temporary.png',
    sha256: 'a'.repeat(64),
  };
  const metrics = {
    performance: 80,
    accessibility: 81,
    bestPractices: 82,
    seo: 83,
    firstContentfulPaint: '1 s',
    largestContentfulPaint: '2 s',
    speedIndex: '1 s',
    totalBlockingTime: '10 ms',
    cumulativeLayoutShift: '0.01',
    timeToInteractive: '2 s',
  };
  const aiAnalysis = {
    visualDesignScore: 84,
    qualitativeCritique: ['Clear hierarchy'],
    strengths: ['Readable layout'],
    areasForRefinement: ['Improve spacing'],
  };

  try {
    postgresRepository.createAnalysisTransaction = async () => ({
      project: {} as any,
      analysis: { id: 'analysis-test-id', status: AnalysisStatus.PROCESSING } as any,
    });
    postgresRepository.saveAnalysisResult = async (_id, input) => {
      stageEvents.push('persist');
      statuses.push(AnalysisStatus.COMPLETED);
      return {} as any;
    };
    postgresRepository.updateAnalysisStatus = async (_id, status) => {
      statuses.push(status);
      return {} as any;
    };
    postgresRepository.updatePlaywrightDiagnostics = async () => ({} as any);
    postgresRepository.updateLighthouseDiagnostics = async () => ({} as any);
    postgresRepository.updateScreenshotIdentity = async () => ({} as any);
    playwrightService.captureScreenshot = async () => {
      stageEvents.push('playwright');
      await fs.promises.mkdir(path.dirname(path.resolve(screenshot.path)), { recursive: true });
      await fs.promises.writeFile(path.resolve(screenshot.path), 'screenshot fixture');
      return screenshot;
    };
    playwrightService.removeScreenshot = async () => {
      cleaned += 1;
      await fs.promises.rm(path.resolve(screenshot.path), { force: true });
    };
    lighthouseService.runAudit = async () => {
      stageEvents.push('lighthouse');
      assert.strictEqual(fs.existsSync(path.resolve(screenshot.path)), false, 'screenshot is removed after Gemini finishes and before Lighthouse starts');
      return metrics;
    };
    geminiService.generateAnalysis = async (input) => {
      stageEvents.push('gemini');
      assert.strictEqual('metrics' in input, false, 'Gemini receives no Lighthouse input');
      assert.strictEqual(fs.existsSync(path.resolve(screenshot.path)), true, 'screenshot remains available while Gemini consumes it');
      return aiAnalysis;
    };

    const service = new AnalysisService();
    const success = await service.analyzeUrl('https://example.com');
    assert.strictEqual(success.data.id, 'analysis-test-id');
    assert.deepStrictEqual(statuses, [AnalysisStatus.COMPLETED]);
    assert.deepStrictEqual(stageEvents, ['playwright', 'gemini', 'lighthouse', 'persist']);
    assert.strictEqual(cleaned, 1, 'temporary screenshot is cleaned after success');

    statuses.length = 0;
    cleaned = 0;
    geminiService.generateAnalysis = async () => { throw new Error('forced unit-test failure'); };
    let persistedPartial = false;
    postgresRepository.saveAnalysisResult = async (_id, input) => {
      persistedPartial = !input.aiAnalysis && input.metrics === metrics;
      statuses.push(AnalysisStatus.COMPLETED);
      return {} as any;
    };
    const partial = await service.analyzeUrl('https://example.com/failure');
    assert.strictEqual(partial.data.aiStatus, 'UNAVAILABLE');
    assert.strictEqual(partial.data.aiAnalysis, null, 'partial response must not fabricate AI output');
    assert.deepStrictEqual(statuses, [AnalysisStatus.COMPLETED]);
    assert.strictEqual(persistedPartial, true, 'real Lighthouse metrics are persisted without AI data');
    assert.strictEqual(cleaned, 1, 'temporary screenshot is cleaned after partial report');

    statuses.length = 0;
    cleaned = 0;
    stageEvents.length = 0;
    let persistedMetrics: any;
    geminiService.generateAnalysis = async (input) => {
      stageEvents.push('gemini');
      assert.strictEqual('metrics' in input, false);
      assert.strictEqual(fs.existsSync(path.resolve(screenshot.path)), true);
      return aiAnalysis;
    };
    postgresRepository.saveAnalysisResult = async (_id, input) => {
      persistedMetrics = input.metrics;
      stageEvents.push('persist');
      statuses.push(AnalysisStatus.COMPLETED);
      return {} as any;
    };
    lighthouseService.runAudit = async () => {
      stageEvents.push('lighthouse');
      throw new Error('Lighthouse navigation failed');
    };
    const lighthousePartial = await service.analyzeUrl('https://example.com/lighthouse-failure');
    assert.strictEqual(lighthousePartial.status, 'success', 'Lighthouse failure returns a successful partial report');
    assert.strictEqual(lighthousePartial.data.partial, true);
    assert.strictEqual(lighthousePartial.data.technicalUnavailable, true);
    assert.strictEqual(lighthousePartial.data.technicalUnavailableReason, 'Lighthouse navigation failed');
    assert.strictEqual(lighthousePartial.data.overallScore, aiAnalysis.visualDesignScore, 'visual score is used alone for Lighthouse-unavailable reports');
    assert.strictEqual(lighthousePartial.data.metrics.performance, null);
    assert.strictEqual(persistedMetrics.performance, null);
    assert.deepStrictEqual(stageEvents, ['playwright', 'gemini', 'lighthouse', 'persist']);
    assert.strictEqual(cleaned, 1, 'screenshot is deleted exactly once when Lighthouse fails');
    const originalAnalyzeUrl = analysisService.analyzeUrl;
    analysisService.analyzeUrl = async () => lighthousePartial;
    let httpStatus = 0;
    let httpBody: any;
    const request: any = {
      body: { url: 'https://example.com/lighthouse-failure' },
      user: { id: 'test-user' },
      once() { return this; },
      removeListener() { return this; },
    };
    const response: any = {
      destroyed: false,
      writableEnded: false,
      once() { return this; },
      removeListener() { return this; },
      status(code: number) { httpStatus = code; return this; },
      json(body: unknown) { httpBody = body; return this; },
    };
    try {
      await analyze(request, response, (error) => { throw error; });
    } finally {
      analysisService.analyzeUrl = originalAnalyzeUrl;
    }
    assert.strictEqual(httpStatus, 200, 'controller preserves HTTP 200 for a completed partial report');
    assert.strictEqual(httpBody.data.partial, true);
    assert.strictEqual(httpBody.data.technicalUnavailable, true);

    statuses.length = 0;
    cleaned = 0;
    stageEvents.length = 0;
    const previousMemoryLimit = process.env.LIGHTHOUSE_MEMORY_ABORT_BYTES;
    process.env.LIGHTHOUSE_MEMORY_ABORT_BYTES = '0';
    let abortAuditCalls = 0;
    let pollerStopped = 0;
    const memoryGuardedService = new AnalysisService({
      readAnonBytes: async () => 1,
      pollIntervalMs: 1,
      onStop: () => { pollerStopped += 1; },
    });
    lighthouseService.runAudit = async (_url, _diagnostics, auditSignal) => {
      abortAuditCalls += 1;
      stageEvents.push('lighthouse');
      return new Promise((_resolve, reject) => {
        auditSignal?.addEventListener('abort', () => reject(new Error('Lighthouse audit aborted: memory limit')), { once: true });
      });
    };
    try {
      const memoryPartial = await memoryGuardedService.analyzeUrl('https://example.com/memory-limit');
      assert.strictEqual(memoryPartial.status, 'success');
      assert.strictEqual(memoryPartial.data.partial, true);
      assert.strictEqual(memoryPartial.data.technicalUnavailableReason, 'memory limit');
      assert.strictEqual(memoryPartial.data.overallScore, aiAnalysis.visualDesignScore);
      assert.strictEqual(abortAuditCalls, 1, 'memory limit abort does not retry Lighthouse');
      assert.strictEqual(pollerStopped, 1, 'memory poller stops in finally');
      assert.strictEqual(cleaned, 1, 'screenshot is removed before the memory-aborted Lighthouse stage');
    } finally {
      if (previousMemoryLimit === undefined) delete process.env.LIGHTHOUSE_MEMORY_ABORT_BYTES;
      else process.env.LIGHTHOUSE_MEMORY_ABORT_BYTES = previousMemoryLimit;
    }

    statuses.length = 0;
    let auditCalls = 0;
    let geminiCalls = 0;
    lighthouseService.runAudit = async () => { auditCalls += 1; return metrics; };
    geminiService.generateAnalysis = async () => { geminiCalls += 1; return aiAnalysis; };
    playwrightService.captureScreenshot = async (_url, _id, onDiagnostics) => {
      await onDiagnostics?.({ version: 1, outcome: 'BLOCKED', requestedUrl: 'https://example.com/blocked', finalUrl: 'https://example.com/blocked', titleLength: 12, readyState: 'complete', bodyTextLength: 22, visibleElementCount: 2, imageCount: 0, buttonCount: 0, navigationDurationMs: 10, navigationTimedOut: false, navigationError: null, settlingDelayMs: 0, screenshotStartedAt: null, screenshotDurationMs: null, screenshotCompletedAt: null, screenshotError: null, validationReasonCode: 'CDN_ACCESS_DENIED', validationReason: 'The edge service denied access.', mainFrameNavigations: [], navigationResponses: [{ url: 'https://example.com/blocked', status: 403 }], httpErrorResponses: [], consoleErrors: [], pageErrors: [], failedRequests: [] });
      throw new TargetPageValidationError({ status: 'BLOCKED', reasonCode: 'CDN_ACCESS_DENIED', reason: 'The edge service denied access.' });
    };
    const blocked = await service.analyzeUrl('https://example.com/blocked');
    assert.strictEqual(blocked.data.targetValidationStatus, 'BLOCKED');
    assert.strictEqual(blocked.data.overallScore, null);
    assert.deepStrictEqual(statuses, [AnalysisStatus.BLOCKED]);
    assert.strictEqual(auditCalls, 0, 'blocked target never reaches Lighthouse');
    assert.strictEqual(geminiCalls, 0, 'blocked target never reaches Gemini');
    playwrightService.captureScreenshot = async () => {
      throw new TargetPageValidationError({ status: 'INCONCLUSIVE', reasonCode: 'HTTP_ERROR_STATUS', reason: 'HTTP 404 did not confirm the intended page.' });
    };
    const inconclusive = await service.analyzeUrl('https://example.com/missing');
    assert.strictEqual(inconclusive.data.targetValidationStatus, 'INCONCLUSIVE');
    assert.strictEqual(inconclusive.data.aiAnalysis, null);
    assert.deepStrictEqual(statuses, [AnalysisStatus.BLOCKED, AnalysisStatus.INCONCLUSIVE]);
    assert.strictEqual(auditCalls, 0, 'inconclusive target never reaches Lighthouse');
    assert.strictEqual(geminiCalls, 0, 'inconclusive target never reaches Gemini');

    const cleanupFailure = new Error('Chrome process tree cleanup failed');
    markBrowserCleanupFailure(cleanupFailure);
    cleaned = 0;
    playwrightService.captureScreenshot = async () => {
      await fs.promises.mkdir(path.dirname(path.resolve(screenshot.path)), { recursive: true });
      await fs.promises.writeFile(path.resolve(screenshot.path), 'screenshot fixture');
      return screenshot;
    };
    const previousCleanupMemoryLimit = process.env.LIGHTHOUSE_MEMORY_ABORT_BYTES;
    process.env.LIGHTHOUSE_MEMORY_ABORT_BYTES = '0';
    lighthouseService.runAudit = async (_url, _diagnostics, auditSignal) => new Promise((_resolve, reject) => {
      auditSignal?.addEventListener('abort', () => {
        markBrowserCleanupFailure(cleanupFailure);
        reject(cleanupFailure);
      }, { once: true });
    });
    try {
      await assert.rejects(() => memoryGuardedService.analyzeUrl('https://example.com/abort-cleanup-failure'), (error) => error === cleanupFailure,
        'browser cleanup failure during memory abort remains fail-closed and is rethrown');
      assert.strictEqual(pollerStopped, 2, 'memory poller stops even when abort cleanup fails');
    } finally {
      if (previousCleanupMemoryLimit === undefined) delete process.env.LIGHTHOUSE_MEMORY_ABORT_BYTES;
      else process.env.LIGHTHOUSE_MEMORY_ABORT_BYTES = previousCleanupMemoryLimit;
    }
    assert.strictEqual(cleaned, 1, 'screenshot is deleted before a browser cleanup failure propagates');
  } finally {
    postgresRepository.createAnalysisTransaction = original.createAnalysisTransaction;
    postgresRepository.saveAnalysisResult = original.saveAnalysisResult;
    postgresRepository.updateAnalysisStatus = original.updateAnalysisStatus;
    postgresRepository.updatePlaywrightDiagnostics = original.updatePlaywrightDiagnostics;
    postgresRepository.updateLighthouseDiagnostics = original.updateLighthouseDiagnostics;
    postgresRepository.updateScreenshotIdentity = original.updateScreenshotIdentity;
    playwrightService.captureScreenshot = original.captureScreenshot;
    playwrightService.removeScreenshot = original.removeScreenshot;
    lighthouseService.runAudit = original.runAudit;
    geminiService.generateAnalysis = original.generateAnalysis;
  }
}

async function verifyScreenshotCleanupOnDisk() {
  const previousCwd = process.cwd();
  const testRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'uiverdict-screenshot-cleanup-'));
  try {
    process.chdir(testRoot);
    const service = new (await import('../src/services/playwright.service')).PlaywrightService();
    const filename = 'temporary-cleanup-test.png';
    const screenshotDir = path.join(testRoot, 'temp', 'screenshots');
    await fs.promises.mkdir(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, filename);
    await fs.promises.writeFile(screenshotPath, 'temporary test image');

    await service.removeScreenshot({
      url: 'https://example.com',
      filename,
      path: `temp/screenshots/${filename}`,
      sha256: 'a'.repeat(64),
    });
    assert.strictEqual(fs.existsSync(screenshotPath), false);
  } finally {
    process.chdir(previousCwd);
    await fs.promises.rm(testRoot, { recursive: true, force: true });
  }
}

runAnalysisLifecycleTests()
  .then(verifyScreenshotCleanupOnDisk)
  .then(() => console.log('Analysis lifecycle unit tests passed.'))
  .catch((error) => {
    console.error('Analysis lifecycle unit tests failed:', error);
    process.exitCode = 1;
  });
