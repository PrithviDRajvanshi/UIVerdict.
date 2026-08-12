import assert from 'assert';
import { analysisService } from '../src/services/analysis.service';
import { aiAnalysisSchema, verdictLabelSchema } from '../src/validators/aiAnalysis.validator';
import { LighthouseMetrics } from '../src/services/lighthouse.service';
import { config } from '../src/config/env';
import { GeminiService } from '../src/services/gemini.service';

async function runTests() {
  console.log('--- STARTING GEMINI INTEGRATION & ANALYSIS TESTS ---');

  // Test 1: Deterministic Global Score Calculation
  console.log('\n[Test 1] Deterministic Global Score Calculation');
  const sampleMetrics: LighthouseMetrics = {
    performance: 80,
    accessibility: 90,
    bestPractices: 100,
    seo: 85,
    firstContentfulPaint: '1.2 s',
    largestContentfulPaint: '2.5 s',
    speedIndex: '1.8 s',
    totalBlockingTime: '150 ms',
    cumulativeLayoutShift: '0.05',
    timeToInteractive: '2.8 s',
  };

  // Expected: 80 * 0.30 (24) + 90 * 0.25 (22.5) + 100 * 0.20 (20) + 85 * 0.25 (21.25) = 87.75 -> rounded to 87.8
  const calculatedScore = analysisService.calculateGlobalScore(sampleMetrics);
  assert.strictEqual(calculatedScore, 87.8, `Expected score 87.8, got ${calculatedScore}`);
  console.log('✓ Passed: Global score formula weighted accurately (87.8)');

  // Test 2: Zod Schema Validation for Valid Output
  console.log('\n[Test 2] Zod Schema Validation for Valid Output');
  const validPayload = {
    overallVerdict: {
      score: 87.8,
      label: 'GOOD',
    },
    qualitativeCritique: [
      'The website demonstrates strong best practices and accessibility compliance.',
      'Performance visual metrics indicate fast rendering of above-the-fold content.',
    ],
    strengths: [
      'High accessibility rating ensures broad usability.',
      'Excellent best practices score across standard web audits.',
    ],
    areasForRefinement: [
      'Optimize Total Blocking Time by reducing main thread JavaScript execution.',
    ],
  };

  const parsedValid = aiAnalysisSchema.safeParse(validPayload);
  assert.strictEqual(parsedValid.success, true, 'Valid payload should pass Zod validation');
  console.log('✓ Passed: Valid payload successfully passed Zod validation');

  // Test 3: Zod Schema Validation Rejection for Invalid Payload
  console.log('\n[Test 3] Zod Schema Rejection for Invalid Data');
  const invalidPayloads = [
    { ...validPayload, overallVerdict: { score: 105, label: 'GOOD' } }, // score > 100
    { ...validPayload, overallVerdict: { score: 80, label: 'SUPERB' } }, // invalid label
    { ...validPayload, qualitativeCritique: [] }, // empty array
  ];

  for (let i = 0; i < invalidPayloads.length; i++) {
    const parsedInvalid = aiAnalysisSchema.safeParse(invalidPayloads[i]);
    assert.strictEqual(parsedInvalid.success, false, `Invalid payload ${i + 1} should be rejected`);
  }
  console.log('✓ Passed: Malformed payloads correctly rejected by Zod schema');

  // Test 4: Missing GEMINI_API_KEY Handling
  console.log('\n[Test 4] Handling Missing GEMINI_API_KEY');
  const originalKey = config.geminiApiKey;
  config.geminiApiKey = undefined;

  const testGeminiService = new GeminiService();
  try {
    await testGeminiService.generateAnalysis({
      url: 'https://example.com',
      metrics: sampleMetrics,
      screenshot: { url: 'https://example.com', filename: 'test.png', path: 'temp/screenshots/test.png' },
      globalScore: calculatedScore,
    });
    assert.fail('Should have thrown an ApiError for missing API key');
  } catch (err: any) {
    assert.strictEqual(err.statusCode, 500);
    assert.strictEqual(err.message, 'Gemini API key is not configured');
    console.log('✓ Passed: Missing GEMINI_API_KEY correctly threw 500 ApiError');
  } finally {
    config.geminiApiKey = originalKey;
  }

  // Test 5: Mocked Gemini Client Output Validation & Score Enforcement
  console.log('\n[Test 5] Mocked Gemini Output Validation & Score Enforcement');
  const mockGeminiService = new GeminiService();
  const mockClient: any = {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          overallVerdict: {
            score: 50.0, // Mock returns a different score
            label: 'GOOD',
          },
          qualitativeCritique: ['Clear hierarchy and visual structure.'],
          strengths: ['Fast FCP'],
          areasForRefinement: ['Improve TBT'],
        }),
      }),
    },
  };
  (mockGeminiService as any).getClient = () => mockClient;

  const mockResult = await mockGeminiService.generateAnalysis({
    url: 'https://example.com',
    metrics: sampleMetrics,
    screenshot: { url: 'https://example.com', filename: 'test.png', path: 'temp/screenshots/test.png' },
    globalScore: 87.8,
  });

  // Verify overallVerdict.score was forced to match backend global score (87.8), not mock score (50.0)
  assert.strictEqual(mockResult.overallVerdict.score, 87.8, 'Overall verdict score must match global score');
  assert.strictEqual(mockResult.overallVerdict.label, 'GOOD');
  assert.deepStrictEqual(mockResult.qualitativeCritique, ['Clear hierarchy and visual structure.']);
  console.log('✓ Passed: Mocked Gemini output validated and score deterministically enforced to 87.8');

  console.log('\n==================================================');
  console.log('ALL GEMINI INTEGRATION TESTS COMPLETED SUCCESSFULLY');
  console.log('==================================================\n');
}

runTests().catch((error) => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
