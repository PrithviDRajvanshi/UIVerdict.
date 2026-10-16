import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/config/postgres';
import { postgresRepository } from '../src/repositories/postgres/postgres.repository';
import { AnalysisStatus } from '@prisma/client';

async function run() {
  const schema = fs.readFileSync(path.resolve(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
  const migration = fs.readFileSync(path.resolve(process.cwd(), 'prisma', 'migrations', '20261013140000_add_analysis_diagnostics', 'migration.sql'), 'utf8');
  for (const column of ['playwrightDiagnostics', 'lighthouseDiagnostics', 'screenshotArtifactName', 'screenshotSha256']) {
    assert.ok(schema.includes(`${column} `), `Prisma schema includes ${column}`);
    assert.ok(migration.includes(`ADD COLUMN "${column}"`), `additive migration includes ${column}`);
  }
  assert.ok(!/DROP\s+COLUMN/i.test(migration), 'diagnostic migration must not remove existing columns');

  const originalUpdate = prisma.analysis.update;
  const calls: any[] = [];
  (prisma.analysis as any).update = async (args: any) => {
    calls.push(args);
    return { id: args.where.id, ...args.data };
  };
  const analysisId = 'diagnostic-test-analysis-id';
  const metrics = {
    performance: 2, accessibility: 77, bestPractices: 35, seo: 83,
    firstContentfulPaint: '4 s', largestContentfulPaint: '6.5 s', speedIndex: '5 s',
    totalBlockingTime: '4800 ms', cumulativeLayoutShift: '0', timeToInteractive: 'N/A',
  };
  const aiAnalysis = {
    overallVerdict: { score: 38.5, label: 'POOR' as const },
    qualitativeCritique: ['Critique associated with this run'],
    strengths: ['Strength'],
    areasForRefinement: ['Refinement'],
  };

  try {
    await postgresRepository.updatePlaywrightDiagnostics(analysisId, {
      requestedUrl: 'https://user:pass@example.com/path?session=private',
      outcome: 'CAPTURED',
      page: {
        finalUrl: 'https://example.com/final?token=private',
        title: 'Sensitive title text is not stored',
        readyState: 'complete', bodyTextLength: 99, visibleElementCount: 12, imageCount: 2, buttonCount: 3,
        bodyText: 'private page contents', cookies: 'private-cookie', authorization: 'Bearer private', apiKey: 'private-key',
      },
      browserEvents: {
        consoleErrors: ['Authorization: Bearer secret-value'],
        pageErrors: ['token=private-token'],
        failedRequests: [{ url: 'https://example.com/api?key=private', reason: 'net::ERR_FAILED' }],
      },
      navigationDurationMs: 250,
    });
    await postgresRepository.updateLighthouseDiagnostics(analysisId, {
      requestedUrl: 'https://example.com/start?auth=private',
      finalUrl: 'https://example.com/final?session=private',
      outcome: 'AUDIT_COMPLETED',
      navigationResponseStatus: 200,
      navigationStatusObserved: true,
      navigationResponses: [{ url: 'https://example.com/final?token=private', status: 200 }],
      fetchTime: '2026-10-13T00:00:00.000Z', auditDurationMs: 5000, attempt: 1, maxAttempts: 2,
    });
    await postgresRepository.updateScreenshotIdentity(analysisId, 'uiverdict-diagnostic-test.png', 'b'.repeat(64));
    await postgresRepository.saveAnalysisResult(analysisId, {
      metrics, aiAnalysis, status: AnalysisStatus.COMPLETED,
      screenshotArtifactName: 'uiverdict-diagnostic-test.png', screenshotSha256: 'a'.repeat(64),
    });

    assert.strictEqual(calls.length, 4);
    assert.ok(calls.every((call) => call.where.id === analysisId), 'all evidence must use the same analysis ID');
    const playwright = calls[0].data.playwrightDiagnostics;
    assert.strictEqual(playwright.version, 1);
    assert.strictEqual(playwright.requestedUrl, 'https://example.com/path');
    assert.strictEqual(playwright.finalUrl, 'https://example.com/final');
    assert.strictEqual(playwright.titleLength, 'Sensitive title text is not stored'.length);
    assert.ok(!JSON.stringify(playwright).includes('private'));
    assert.strictEqual(playwright.bodyTextLength, 99);

    const lighthouse = calls[1].data.lighthouseDiagnostics;
    assert.strictEqual(lighthouse.outcome, 'AUDIT_COMPLETED');
    assert.strictEqual(lighthouse.navigationResponseStatus, 200);
    assert.ok(!JSON.stringify(lighthouse).includes('private'));

    assert.strictEqual(calls[2].data.screenshotArtifactName, 'uiverdict-diagnostic-test.png');
    assert.strictEqual(calls[2].data.screenshotSha256, 'b'.repeat(64));
    const result = calls[3].data;
    assert.strictEqual(result.performanceScore, metrics.performance);
    assert.strictEqual(result.overallScore, aiAnalysis.overallVerdict.score);
    assert.deepStrictEqual(result.qualitativeCritique, aiAnalysis.qualitativeCritique);
    assert.strictEqual(result.screenshotArtifactName, 'uiverdict-diagnostic-test.png');
    assert.strictEqual(result.screenshotSha256, 'a'.repeat(64));
    console.log('Diagnostic persistence and schema mapping tests passed.');
  } finally {
    (prisma.analysis as any).update = originalUpdate;
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error('Diagnostic persistence tests failed:', error);
  process.exitCode = 1;
});
