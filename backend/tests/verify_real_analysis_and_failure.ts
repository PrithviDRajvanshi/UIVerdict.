import { analysisService } from '../src/services/analysis.service';
import { geminiService } from '../src/services/gemini.service';
import { connectPostgres, prisma, disconnectPostgres } from '../src/config/postgres';
import { postgresRepository } from '../src/repositories/postgres/postgres.repository';
import { AnalysisStatus } from '@prisma/client';
import assert from 'assert';

async function verifyRealAnalysisAndFailure() {
  console.log('=== VERIFYING REAL ANALYSIS & FORCED FAILURE WORKFLOWS ===\n');
  await connectPostgres();

  const testUser = await prisma.user.upsert({
    where: { email: 'real_verify@uiverdict.com' },
    update: {},
    create: {
      name: 'Real Verifier',
      email: 'real_verify@uiverdict.com',
      passwordHash: 'dummy_hash',
    },
  });

  // ----------------------------------------------------
  // Test 1: Real Local Analysis
  // ----------------------------------------------------
  const targetUrl = 'https://example.com';
  console.log(`[TEST 1] Running real analysis pipeline for: ${targetUrl}`);
  const startTime = Date.now();

  const response = await analysisService.analyzeUrl(targetUrl, testUser.id);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`✓ Real analysis completed in ${elapsed}s`);
  console.log(`- API Status: ${response.status}`);
  console.log(`- Message: ${response.message}`);
  console.log(`- Overall Score: ${response.data.aiAnalysis.overallVerdict.score} (${response.data.aiAnalysis.overallVerdict.label})`);
  console.log(`- Performance Score: ${response.data.metrics.performance}`);
  console.log(`- Accessibility Score: ${response.data.metrics.accessibility}`);

  assert.strictEqual(response.status, 'success');
  assert.ok(response.data.aiAnalysis.overallVerdict.score >= 0);
  assert.ok(response.data.metrics.performance >= 0);
  assert.ok(response.data.id.length > 0);

  // Verify PostgreSQL record state
  const pgRecord = await prisma.analysis.findFirst({
    where: { userId: testUser.id, url: targetUrl },
    orderBy: { createdAt: 'desc' },
  });

  assert.ok(pgRecord, 'PostgreSQL record must exist');
  assert.strictEqual(pgRecord?.status, AnalysisStatus.COMPLETED);
  assert.strictEqual(pgRecord?.overallScore, response.data.aiAnalysis.overallVerdict.score);
  assert.strictEqual(pgRecord?.verdictLabel, response.data.aiAnalysis.overallVerdict.label);
  assert.strictEqual(pgRecord?.performanceScore, response.data.metrics.performance);
  assert.ok(Array.isArray(pgRecord?.qualitativeCritique));
  assert.ok(Array.isArray(pgRecord?.strengths));
  assert.ok(Array.isArray(pgRecord?.areasForRefinement));

  console.log(`✓ Verified in PostgreSQL: Record ${pgRecord?.id} is COMPLETED with all metrics and AI analysis saved.`);

  // Verify snapshot format retrieved via repository
  const snapshot = await postgresRepository.getSnapshotByAnalysisId(pgRecord!.id);
  assert.ok(snapshot);
  assert.strictEqual(snapshot?.aiAnalysis.overallVerdict.score, pgRecord?.overallScore);
  console.log(`✓ Verified report retrieval from PostgreSQL without MongoDB: ${snapshot?.id}`);

  // ----------------------------------------------------
  // Test 2: Forced Failure Handling (Forced Gemini Error)
  // ----------------------------------------------------
  console.log(`\n[TEST 2] Testing forced Gemini failure...`);
  const failureUrl = 'https://example.com/test-forced-failure';

  // Temporarily stub generateAnalysis to throw an error
  const originalGenerateAnalysis = geminiService.generateAnalysis.bind(geminiService);
  geminiService.generateAnalysis = async () => {
    throw new Error('Forced Gemini AI generation failure for test verification');
  };

  let caughtError: any = null;
  try {
    await analysisService.analyzeUrl(failureUrl, testUser.id);
  } catch (err: any) {
    caughtError = err;
  } finally {
    // Restore original method
    geminiService.generateAnalysis = originalGenerateAnalysis;
  }

  assert.ok(caughtError, 'Expected analysisService to throw on Gemini failure');
  console.log(`✓ Caught expected error: ${caughtError.message}`);

  // Verify PostgreSQL record was marked FAILED
  const failedRecord = await prisma.analysis.findFirst({
    where: { userId: testUser.id, url: failureUrl },
    orderBy: { createdAt: 'desc' },
  });

  assert.ok(failedRecord, 'Failed analysis record must exist in PostgreSQL');
  assert.strictEqual(failedRecord?.status, AnalysisStatus.FAILED);
  console.log(`✓ Verified in PostgreSQL: Record ${failedRecord?.id} status is FAILED.`);

  await disconnectPostgres();
  console.log('\n=== REAL ANALYSIS & FORCED FAILURE VERIFICATION PASSED ===');
}

verifyRealAnalysisAndFailure().catch(async (err) => {
  console.error('❌ Verification failed:', err);
  await disconnectPostgres().catch(() => {});
  process.exit(1);
});
