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
    overallVerdict: { score: 84, label: 'GOOD' as const },
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
