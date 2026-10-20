import assert from 'assert';
import { Analysis, AnalysisStatus } from '@prisma/client';
import { analyzeSchema } from '../src/validators/analysis.validator';
import { AnalysisService } from '../src/services/analysis.service';
import { postgresRepository } from '../src/repositories/postgres/postgres.repository';
import { playwrightService } from '../src/services/playwright.service';
import { lighthouseService, LighthouseMetrics } from '../src/services/lighthouse.service';
import { geminiService } from '../src/services/gemini.service';

async function run() {
  const validUrl = 'https://example.test/';
  assert.strictEqual(analyzeSchema.safeParse({ body: { url: validUrl } }).success, true, 'omitted mode defaults to visual');
  for (const mode of ['overall', 'full', 'bogus']) {
    assert.strictEqual(analyzeSchema.safeParse({ body: { url: validUrl, mode } }).success, false, `${mode} is rejected`);
  }
  assert.strictEqual(analyzeSchema.safeParse({ body: { url: validUrl, mode: 'tech' } }).success, true);

  const baseRecord = {
    id: 'snapshot-mode-test', url: validUrl, status: AnalysisStatus.COMPLETED,
    overallScore: null, verdictLabel: null, visualDesignScore: null,
    performanceScore: null, accessibilityScore: null, bestPracticesScore: null, seoScore: null,
    firstContentfulPaint: null, largestContentfulPaint: null, speedIndex: null, totalBlockingTime: null,
    cumulativeLayoutShift: null, timeToInteractive: null, playwrightDiagnostics: null,
    qualitativeCritique: null, strengths: null, areasForRefinement: null,
    createdAt: new Date(), updatedAt: new Date(),
  } as unknown as Analysis;
  const visualSnapshot = postgresRepository.formatAnalysisToSnapshot({ ...baseRecord, visualDesignScore: 88 });
  assert.strictEqual(visualSnapshot?.mode, 'visual', 'visual-only snapshots survive without an overall or Lighthouse score');
  const technicalSnapshot = postgresRepository.formatAnalysisToSnapshot({ ...baseRecord, accessibilityScore: 90 });
  assert.strictEqual(technicalSnapshot?.mode, 'tech');
  assert.strictEqual(technicalSnapshot?.aiStatus, 'NOT_REQUESTED', 'technical mode does not infer AI state from scores');
  assert.strictEqual(technicalSnapshot?.aiAnalysis, null);
  assert.strictEqual(postgresRepository.formatAnalysisToSnapshot(baseRecord), null, 'scoreless records remain excluded from score snapshots');

  const original = {
    create: postgresRepository.createAnalysisTransaction,
    save: postgresRepository.saveAnalysisResult,
    status: postgresRepository.updateAnalysisStatus,
    updateIdentity: postgresRepository.updateScreenshotIdentity,
    capture: playwrightService.captureScreenshot,
    remove: playwrightService.removeScreenshot,
    audit: lighthouseService.runAudit,
    gemini: geminiService.generateAnalysis,
  };
  const events: string[] = [];
  const saved: any[] = [];
  let nextId = 0;
  const screenshot = { url: validUrl, filename: 'uiverdict-test.png', path: 'temp/screenshots/uiverdict-test.png', sha256: 'a'.repeat(64) };
  const technicalMetrics: LighthouseMetrics = {
    performance: 80, accessibility: 90, bestPractices: 85, seo: 95,
    firstContentfulPaint: '1 s', largestContentfulPaint: '2 s', speedIndex: '1 s',
    totalBlockingTime: '10 ms', cumulativeLayoutShift: '0.01', timeToInteractive: '2 s',
  };
  const visualResult = {
    visualDesignScore: 88,
    qualitativeCritique: ['Clear visual hierarchy'],
    strengths: ['Good typography'],
    areasForRefinement: ['Improve spacing'],
  };

  try {
    postgresRepository.createAnalysisTransaction = async () => ({
      project: {} as any,
      analysis: { id: `mode-test-${++nextId}`, status: AnalysisStatus.PROCESSING } as any,
    });
    postgresRepository.updateAnalysisStatus = async () => ({} as any);
    postgresRepository.updateScreenshotIdentity = async () => ({} as any);
    postgresRepository.saveAnalysisResult = async (_id, input) => { saved.push(input); events.push('persist'); return {} as any; };
    playwrightService.captureScreenshot = async () => { events.push('playwright'); return screenshot; };
    playwrightService.removeScreenshot = async () => { events.push('screenshot_cleanup'); };
    geminiService.generateAnalysis = async () => { events.push('gemini'); return visualResult; };
    lighthouseService.runAudit = async (_url, _diagnostics, _signal, _retrySignal, categories) => {
      events.push('lighthouse');
      assert.deepStrictEqual(categories, ['accessibility', 'best-practices', 'seo'], 'technical mode skips Performance to reduce Lighthouse memory');
      return { ...technicalMetrics, performance: null, firstContentfulPaint: null, largestContentfulPaint: null,
        speedIndex: null, totalBlockingTime: null, cumulativeLayoutShift: null, timeToInteractive: null };
    };

    const service = new AnalysisService({ pollIntervalMs: 60_000, readAnonBytes: async () => null });
    const visual = await service.analyzeUrl(validUrl, undefined, undefined, 'visual');
    assert.deepStrictEqual(events, ['playwright', 'gemini', 'screenshot_cleanup', 'persist']);
    assert.strictEqual(visual.data.mode, 'visual');
    assert.strictEqual(visual.data.visualDesignScore, 88);
    assert.strictEqual(visual.data.metrics.performance, null);
    assert.strictEqual(visual.data.overallScore, null);
    assert.strictEqual(saved[0].overallScore, null);
    assert.strictEqual(saved[0].metrics.performance, null);

    events.length = 0;
    const tech = await service.analyzeUrl(validUrl, undefined, undefined, 'tech');
    assert.deepStrictEqual(events, ['lighthouse', 'persist']);
    assert.strictEqual(tech.data.mode, 'tech');
    assert.strictEqual(tech.data.aiStatus, 'NOT_REQUESTED');
    assert.strictEqual(tech.data.aiAnalysis, null);
    assert.strictEqual(tech.data.visualDesignScore, null);
    assert.strictEqual(tech.data.metrics.performance, null);
    assert.strictEqual(tech.data.partial, false, 'a complete result for the requested memory-safe categories is not partial');
    assert.strictEqual(tech.data.overallScore, null);
    assert.strictEqual(saved[1].overallScore, null);
    assert.strictEqual(Object.hasOwn(saved[1], 'aiAnalysis'), false);

    console.log('Analysis mode pipeline and validation tests passed.');
  } finally {
    postgresRepository.createAnalysisTransaction = original.create;
    postgresRepository.saveAnalysisResult = original.save;
    postgresRepository.updateAnalysisStatus = original.status;
    postgresRepository.updateScreenshotIdentity = original.updateIdentity;
    playwrightService.captureScreenshot = original.capture;
    playwrightService.removeScreenshot = original.remove;
    lighthouseService.runAudit = original.audit;
    geminiService.generateAnalysis = original.gemini;
  }
}

run().catch((error) => {
  console.error('Analysis mode tests failed:', error);
  process.exitCode = 1;
});
