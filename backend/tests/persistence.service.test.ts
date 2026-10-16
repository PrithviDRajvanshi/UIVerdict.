import assert from 'assert';
import { postgresRepository } from '../src/repositories/postgres/postgres.repository';
import { prisma } from '../src/config/postgres';
import { AnalysisStatus } from '@prisma/client';
import { LighthouseMetrics } from '../src/services/lighthouse.service';
import { AiAnalysis } from '../src/validators/aiAnalysis.validator';
import { calculateOverallScore } from '../src/services/scoring.service';
import { resolveVerdictLabel } from '../src/validators/aiAnalysis.validator';

async function runPersistenceTests() {
  console.log('--- STARTING POSTGRESQL SINGLE SOURCE OF TRUTH PERSISTENCE TESTS ---');

  const testUrl = `https://example.com/test-${Date.now()}`;
  const sampleMetrics: LighthouseMetrics = {
    performance: 85,
    accessibility: 90,
    bestPractices: 95,
    seo: 90,
    firstContentfulPaint: '1.2 s',
    largestContentfulPaint: '2.5 s',
    speedIndex: '1.8 s',
    totalBlockingTime: '150 ms',
    cumulativeLayoutShift: '0.05',
    timeToInteractive: '2.8 s',
  };
  const sampleAiAnalysis: AiAnalysis = {
    visualDesignScore: 89.2,
    qualitativeCritique: ['Great accessibility', 'Good SEO structure'],
    strengths: ['Fast FCP', 'Accessible components'],
    areasForRefinement: ['Reduce JavaScript bundle size'],
  };

  // Test 1: PostgreSQL Project & Analysis Creation inside Transaction (with User relation)
  console.log('\n[Test 1] PostgreSQL Project & Analysis Creation via Prisma Transaction');
  let analysisId = '';
  let testUserId: string | undefined;

  try {
    const testUser = await prisma.user.upsert({
      where: { email: 'persist_test@uiverdict.com' },
      update: {},
      create: {
        name: 'Persistence Tester',
        email: 'persist_test@uiverdict.com',
        passwordHash: 'dummy-hash',
      },
    });
    testUserId = testUser.id;

    const { project, analysis } = await postgresRepository.createAnalysisTransaction(
      testUrl,
      'Test Single Source Project',
      testUserId
    );
    assert.ok(project.id, 'Project ID should be generated');
    assert.strictEqual(project.name, 'Test Single Source Project');
    assert.ok(analysis.id, 'Analysis ID should be generated');
    assert.strictEqual(analysis.projectId, project.id);
    assert.strictEqual(analysis.userId, testUserId);
    assert.strictEqual(analysis.status, AnalysisStatus.PROCESSING);

    analysisId = analysis.id;
    console.log(`✓ Passed: PostgreSQL transaction created Project (${project.id}) and Analysis (${analysis.id}) linked to User (${testUserId})`);
  } catch (err: any) {
    console.error('❌ Test 1 failed:', err);
    throw err;
  }

  // Test 2: Persist Complete Analysis Result (Lighthouse metrics and AI analysis)
  console.log('\n[Test 2] PostgreSQL Complete Analysis Persistence (Relational Columns & JSON)');
  try {
    const saved = await postgresRepository.saveAnalysisResult(analysisId, {
      metrics: sampleMetrics,
      aiAnalysis: sampleAiAnalysis,
      status: AnalysisStatus.COMPLETED,
    });

    assert.strictEqual(saved.id, analysisId);
    assert.strictEqual(saved.status, AnalysisStatus.COMPLETED);
    // Scalar fields
    const expectedOverall = calculateOverallScore(sampleAiAnalysis.visualDesignScore, sampleMetrics)!;
    assert.strictEqual(saved.visualDesignScore, 89.2);
    assert.strictEqual(saved.overallScore, expectedOverall);
    assert.strictEqual(saved.verdictLabel, resolveVerdictLabel(expectedOverall));
    assert.strictEqual(saved.performanceScore, 85);
    assert.strictEqual(saved.accessibilityScore, 90);
    assert.strictEqual(saved.bestPracticesScore, 95);
    assert.strictEqual(saved.seoScore, 90);
    assert.strictEqual(saved.firstContentfulPaint, '1.2 s');
    assert.strictEqual(saved.largestContentfulPaint, '2.5 s');
    assert.strictEqual(saved.speedIndex, '1.8 s');
    assert.strictEqual(saved.totalBlockingTime, '150 ms');
    assert.strictEqual(saved.cumulativeLayoutShift, '0.05');
    assert.strictEqual(saved.timeToInteractive, '2.8 s');

    // JSON fields
    assert.deepStrictEqual(saved.qualitativeCritique, sampleAiAnalysis.qualitativeCritique);
    assert.deepStrictEqual(saved.strengths, sampleAiAnalysis.strengths);
    assert.deepStrictEqual(saved.areasForRefinement, sampleAiAnalysis.areasForRefinement);

    console.log('✓ Passed: Analysis scalar metrics, Web Vitals, and structured AI analysis persisted accurately in PostgreSQL');
  } catch (err: any) {
    console.error('❌ Test 2 failed:', err);
    throw err;
  }

  // Test 3: Snapshot Retrieval by ID
  console.log('\n[Test 3] Snapshot Retrieval by Analysis ID');
  try {
    const snapshot = await postgresRepository.getSnapshotByAnalysisId(analysisId);
    assert.ok(snapshot, 'Snapshot should be returned');
    assert.strictEqual(snapshot?.id, analysisId);
    assert.strictEqual(snapshot?.url, testUrl);
    assert.strictEqual(snapshot?.metrics.performance, 85);
    assert.strictEqual(snapshot?.visualDesignScore, 89.2);
    assert.strictEqual(snapshot?.aiAnalysis?.overallVerdict?.score, expectedOverall);
    assert.strictEqual(snapshot?.aiAnalysis?.overallVerdict?.label, resolveVerdictLabel(expectedOverall));
    console.log('✓ Passed: Snapshot formatted and retrieved accurately from PostgreSQL');
  } catch (err: any) {
    console.error('❌ Test 3 failed:', err);
    throw err;
  }

  // Test 4: History / Archive Filtering by URL
  console.log('\n[Test 4] History / Archive Filtering by URL');
  try {
    const history = await postgresRepository.getSnapshotsByUrl(testUrl);
    assert.ok(Array.isArray(history), 'History should be an array');
    assert.ok(history.length >= 1, 'Should find at least 1 historical snapshot');
    assert.strictEqual(history[0].id, analysisId);
    console.log(`✓ Passed: Retrieved ${history.length} snapshot(s) for URL ordered by createdAt desc`);
  } catch (err: any) {
    console.error('❌ Test 4 failed:', err);
    throw err;
  }

  // Test 5: PostgreSQL Aggregate Analysis Stats by URL
  console.log('\n[Test 5] PostgreSQL URL Analysis Statistics Aggregation');
  try {
    const stats = await postgresRepository.getAnalysisStatsByUrl(testUrl);
    assert.ok(Array.isArray(stats), 'Stats result must be an array');
    assert.strictEqual(stats.length, 1);
    assert.strictEqual(stats[0].url, testUrl);
    assert.strictEqual(stats[0].totalAnalyses, 1);
    assert.strictEqual(stats[0].avgPerformance, 85);
    assert.strictEqual(stats[0].avgOverallScore, calculateOverallScore(sampleAiAnalysis.visualDesignScore, sampleMetrics));
    console.log('✓ Passed: PostgreSQL aggregation computed stats accurately:');
    console.log('   ', JSON.stringify(stats[0]));
  } catch (err: any) {
    console.error('❌ Test 5 failed:', err);
    throw err;
  }

  // Test 6: Status Update to FAILED on Pipeline Failure
  console.log('\n[Test 6] Pipeline Failure Status Handling');
  try {
    const failedAnalysis = await postgresRepository.createAnalysisTransaction(
      'https://example.com/fail-test',
      'Test Single Source Project'
    );
    const updated = await postgresRepository.updateAnalysisStatus(
      failedAnalysis.analysis.id,
      AnalysisStatus.FAILED
    );
    assert.strictEqual(updated.status, AnalysisStatus.FAILED);
    console.log('✓ Passed: Status updated to FAILED cleanly in PostgreSQL without secondary store dependencies');
  } catch (err: any) {
    console.error('❌ Test 6 failed:', err);
    throw err;
  }

  // Test 7: Partial Lighthouse report persists without fabricated AI data
  console.log('\n[Test 7] Partial report persistence when AI feedback is unavailable');
  try {
    const partialCreated = await postgresRepository.createAnalysisTransaction(
      `https://example.com/partial-${Date.now()}`,
      'Partial Report Test Project'
    );
    const partialSaved = await postgresRepository.saveAnalysisResult(partialCreated.analysis.id, {
      metrics: sampleMetrics,
      status: AnalysisStatus.COMPLETED,
    });
    const partialReport = await postgresRepository.getCompletedReport(partialCreated.analysis.id, { guest: true });
    assert.strictEqual(partialSaved.status, AnalysisStatus.COMPLETED);
    assert.strictEqual(partialSaved.overallScore, null);
    assert.strictEqual(partialSaved.qualitativeCritique, null);
    assert.strictEqual(partialReport?.aiStatus, 'UNAVAILABLE');
    assert.strictEqual(partialReport?.aiAnalysis, null);
    assert.strictEqual(partialReport?.metrics.performance, sampleMetrics.performance);
    console.log('✓ Passed: Lighthouse metrics persisted while AI score and critique remain absent');
  } catch (err: any) {
    console.error('❌ Test 7 failed:', err);
    throw err;
  }

  // Test 8: Authentication Relationships
  console.log('\n[Test 8] Authentication & User-Project-Analysis Relationship');
  try {
    if (testUserId) {
      const userAnalyses = await prisma.analysis.findMany({
        where: { userId: testUserId },
        include: { user: true, project: true },
      });
      assert.ok(userAnalyses.length >= 1);
      assert.strictEqual(userAnalyses[0].user?.id, testUserId);
      assert.ok(userAnalyses[0].project);
      console.log('✓ Passed: User-Project-Analysis relational integrity verified');
    }
  } catch (err: any) {
    console.error('❌ Test 7 failed:', err);
    throw err;
  }

  console.log('\n=============================================================');
  console.log('ALL POSTGRESQL SINGLE SOURCE OF TRUTH TESTS PASSED SUCCESSFULLY');
  console.log('=============================================================\n');
}

runPersistenceTests()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Persistence test execution failed:', error);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
