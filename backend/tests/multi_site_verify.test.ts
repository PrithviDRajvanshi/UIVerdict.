import { analysisService } from '../src/services/analysis.service';
import { connectPostgres, prisma, disconnectPostgres } from '../src/config/postgres';
import { connectMongoDB, disconnectMongoDB } from '../src/config/mongodb';
import { mongoRepository } from '../src/repositories/mongo/mongo.repository';
import { AnalysisStatus } from '@prisma/client';

async function runMultiSiteVerification() {
  console.log('=== STARTING MULTI-SITE ANALYSIS PIPELINE VERIFICATION ===\n');
  await connectPostgres();
  await connectMongoDB();

  const user = await prisma.user.upsert({
    where: { email: 'multisite_tester@uiverdict.com' },
    update: {},
    create: {
      name: 'MultiSite Tester',
      email: 'multisite_tester@uiverdict.com',
      passwordHash: '$2a$10$w85ZgJ7L9B1M7H6F3.X92.8Yw2rZ1Qx.X8X1.Z1X1.Z1X1.Z1X1.Z',
    },
  });

  const validUrls = [
    'https://www.google.com/',
    'https://www.github.com/',
    'https://www.ecell.in/eureka/',
  ];

  for (const url of validUrls) {
    console.log(`\n--------------------------------------------------`);
    console.log(`[TEST VALID URL] Processing ${url}...`);
    const startTime = Date.now();
    try {
      const res = await analysisService.analyzeUrl(url, user.id);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✓ [SUCCESS] ${url} analyzed in ${duration}s`);
      console.log(`  - Overall Score: ${res.data.aiAnalysis.overallVerdict.score} (${res.data.aiAnalysis.overallVerdict.label})`);
      console.log(`  - Performance: ${res.data.metrics.performance}, Accessibility: ${res.data.metrics.accessibility}`);
      console.log(`  - Screenshot: ${res.data.screenshot.path}`);

      const pgRecord = await prisma.analysis.findFirst({
        where: { userId: user.id, url },
        orderBy: { createdAt: 'desc' },
      });

      console.log(`  - PostgreSQL record ID: ${pgRecord?.id}, Status: ${pgRecord?.status}`);
      console.log(`  - PostgreSQL mongoDocumentId: ${pgRecord?.mongoDocumentId}`);

      if (pgRecord?.id) {
        const mongoDoc = await mongoRepository.getSnapshotByAnalysisId(pgRecord.id);
        console.log(`  - MongoDB Snapshot document exists: ${!!mongoDoc}`);
      }
    } catch (err: any) {
      console.error(`❌ [FAILURE] Valid URL ${url} failed:`, err?.message || err);
    }
  }

  // Test invalid URL
  const invalidUrl = 'https://invalid-non-existent-domain-999.com/';
  console.log(`\n--------------------------------------------------`);
  console.log(`[TEST INVALID URL] Processing ${invalidUrl}...`);
  try {
    await analysisService.analyzeUrl(invalidUrl, user.id);
    console.error(`❌ [FAILURE] Invalid URL unexpectedly succeeded!`);
  } catch (err: any) {
    console.log(`✓ [EXPECTED FAILURE] Invalid URL cleanly caught error: ${err?.message || err}`);
    const pgRecord = await prisma.analysis.findFirst({
      where: { userId: user.id, url: invalidUrl },
      orderBy: { createdAt: 'desc' },
    });
    console.log(`  - PostgreSQL record ID: ${pgRecord?.id}, Status: ${pgRecord?.status}`);
    console.log(`  - PostgreSQL Status is FAILED: ${pgRecord?.status === AnalysisStatus.FAILED}`);
    console.log(`  - PostgreSQL mongoDocumentId is null: ${pgRecord?.mongoDocumentId === null}`);
  }

  await disconnectPostgres();
  await disconnectMongoDB();
  console.log('\n=== MULTI-SITE VERIFICATION COMPLETED ===');
}

runMultiSiteVerification().catch(async (err) => {
  console.error('Fatal verification error:', err);
  await disconnectPostgres().catch(() => {});
  await disconnectMongoDB().catch(() => {});
  process.exit(1);
});
