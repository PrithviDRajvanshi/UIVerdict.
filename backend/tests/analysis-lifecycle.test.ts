import assert from 'assert';
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
    playwrightService.captureScreenshot = async () => screenshot;
    playwrightService.removeScreenshot = async () => { cleaned += 1; };
    lighthouseService.runAudit = async () => metrics;
    geminiService.generateAnalysis = async () => aiAnalysis;

    const service = new AnalysisService();
    const success = await service.analyzeUrl('https://example.com');
    assert.strictEqual(success.data.id, 'analysis-test-id');
    assert.deepStrictEqual(statuses, [AnalysisStatus.COMPLETED]);
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
