import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { analysisService } from '../src/services/analysis.service';
import { aiAnalysisSchema, verdictLabelSchema, resolveVerdictLabel } from '../src/validators/aiAnalysis.validator';
import { LighthouseMetrics } from '../src/services/lighthouse.service';
import { config } from '../src/config/env';
import { GeminiService } from '../src/services/gemini.service';

async function runTests() {
  console.log('--- STARTING GEMINI INTEGRATION & MULTIMODAL VISION TESTS ---');

  // Setup sample test screenshot file
  const testDir = path.resolve(process.cwd(), 'temp', 'screenshots');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  const testScreenshotPath = path.resolve(testDir, 'test-multimodal-spec.png');
  const dummyPngData = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C63000100000500010D0A2DB40000000049454E44AE426082', 'hex');
  fs.writeFileSync(testScreenshotPath, dummyPngData);

  const sampleMetrics: LighthouseMetrics = {
    performance: 55,
    accessibility: 92,
    bestPractices: 100,
    seo: 92,
    firstContentfulPaint: '1.2 s',
    largestContentfulPaint: '2.5 s',
    speedIndex: '1.8 s',
    totalBlockingTime: '150 ms',
    cumulativeLayoutShift: '0.05',
    timeToInteractive: '2.8 s',
  };

  const sampleScreenshot = {
    url: 'https://example.com',
    filename: 'test-multimodal-spec.png',
    path: path.join('temp', 'screenshots', 'test-multimodal-spec.png'),
  };

  // Test 1: Verify absence of backend weighted Lighthouse formula
  console.log('\n[Test 1] Verification that backend does NOT calculate a weighted Lighthouse Global Score');
  assert.strictEqual(
    (analysisService as any).calculateGlobalScore,
    undefined,
    'analysisService.calculateGlobalScore must NOT exist'
  );
  console.log('✓ Passed: Backend weighted calculation formula is completely removed');

  // Test 2: Zod Schema Validation for Valid Output
  console.log('\n[Test 2] Zod Schema Validation for Valid Output');
  const validPayload = {
    overallVerdict: {
      score: 84.0,
      label: 'GOOD',
    },
    qualitativeCritique: [
      'The visual hierarchy in the screenshot shows clear typographic emphasis on the hero section.',
      'Performance metrics reflect moderate loading times due to rich visual media.',
    ],
    strengths: [
      'Clean typography and intuitive layout structure.',
      'Strong accessibility baseline with high contrast.',
    ],
    areasForRefinement: [
      'Optimize image assets to reduce Largest Contentful Paint.',
    ],
  };

  const parsedValid = aiAnalysisSchema.safeParse(validPayload);
  assert.strictEqual(parsedValid.success, true, 'Valid payload should pass Zod validation');
  console.log('✓ Passed: Valid payload successfully passed Zod validation');

  // Test 3: Zod Schema Validation Rejection for Invalid Data
  console.log('\n[Test 3] Zod Schema Rejection for Invalid Data');
  const invalidPayloads = [
    { ...validPayload, overallVerdict: { score: 105, label: 'GOOD' } }, // score > 100
    { ...validPayload, overallVerdict: { score: -5, label: 'POOR' } }, // score < 0
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
      screenshot: sampleScreenshot,
    });
    assert.fail('Should have thrown an ApiError for missing API key');
  } catch (err: any) {
    assert.strictEqual(err.statusCode, 500);
    assert.strictEqual(err.message, 'Gemini API key is not configured');
    console.log('✓ Passed: Missing GEMINI_API_KEY correctly threw 500 ApiError');
  } finally {
    config.geminiApiKey = originalKey;
  }

  // Test 5: Missing Screenshot File Error Handling
  console.log('\n[Test 5] Handling Missing Screenshot Evidence File');
  const geminiMissingFileTest = new GeminiService();
  try {
    await geminiMissingFileTest.generateAnalysis({
      url: 'https://example.com',
      metrics: sampleMetrics,
      screenshot: {
        url: 'https://example.com',
        filename: 'non-existent-screenshot-file-xyz.png',
        path: 'temp/screenshots/non-existent-screenshot-file-xyz.png',
      },
    });
    assert.fail('Should have thrown ApiError for missing screenshot file');
  } catch (err: any) {
    assert.strictEqual(err.statusCode, 500);
    assert.ok(err.message.includes('Screenshot evidence file not found'));
    console.log('✓ Passed: Missing screenshot file cleanly caught without making ungrounded API calls');
  }

  // Test 6: Multimodal Payload Structure & Real Screenshot Reading Verification
  console.log('\n[Test 6] Verification of Multimodal Payload (Text Prompt + Attached Image Bytes)');
  let capturedRequest: any = null;
  const mockMultimodalService = new GeminiService();
  (mockMultimodalService as any).getClient = () => ({
    models: {
      generateContent: async (request: any) => {
        capturedRequest = request;
        return {
          text: JSON.stringify({
            overallVerdict: { score: 88.0, label: 'GOOD' },
            qualitativeCritique: ['Visually compelling layout with distinct focal points.'],
            strengths: ['Effective visual contrast'],
            areasForRefinement: ['Minor margin adjustment'],
          }),
        };
      },
    },
  });

  await mockMultimodalService.generateAnalysis({
    url: 'https://example.com',
    metrics: sampleMetrics,
    screenshot: sampleScreenshot,
  });

  assert.ok(capturedRequest, 'A request must have been passed to client.models.generateContent');
  assert.ok(Array.isArray(capturedRequest.contents), 'contents must be an array (multimodal)');
  assert.strictEqual(capturedRequest.contents.length, 2, 'contents must contain 2 parts: text prompt and image');

  // Part 1: Text Prompt
  const textPart = capturedRequest.contents[0];
  assert.ok(typeof textPart.text === 'string', 'Part 0 must contain text prompt');
  assert.ok(textPart.text.includes('https://example.com'), 'Text prompt must contain target URL');
  assert.ok(textPart.text.includes('=== OBJECTIVE TECHNICAL AUDIT (LIGHTHOUSE EVIDENCE) ==='), 'Text prompt must contain Lighthouse evidence');
  assert.ok(textPart.text.includes('attached screenshot'), 'Text prompt must instruct Gemini to inspect the attached screenshot');

  // Part 2: Image Part
  const imagePart = capturedRequest.contents[1];
  assert.ok(imagePart.inlineData, 'Part 1 must be an inlineData object');
  assert.strictEqual(imagePart.inlineData.mimeType, 'image/png', 'inlineData.mimeType must be image/png');
  assert.ok(typeof imagePart.inlineData.data === 'string', 'inlineData.data must be a string');
  assert.strictEqual(
    imagePart.inlineData.data,
    dummyPngData.toString('base64'),
    'inlineData.data must contain the exact base64-encoded screenshot bytes, not a file path'
  );

  // Safe Request Verification Logging (no secrets or raw base64)
  console.log('✓ Verified Multimodal Request Structure:');
  console.log(`   - Model: ${capturedRequest.model}`);
  console.log(`   - Part 0: [Text Prompt, ${textPart.text.length} chars]`);
  console.log(`   - Part 1: [Image Part, mimeType: "${imagePart.inlineData.mimeType}", byteLength: ${imagePart.inlineData.data.length} base64 chars]`);
  console.log('✓ Passed: Screenshot is verified to be read from disk and attached as raw binary image data');

  // Test 7: Mocked Gemini score of 84 results in UIVerdict score = 84 (NOT a calculated Lighthouse composite)
  console.log('\n[Test 7] Mocked Gemini score of 84 yields UIVerdict score = 84');
  const mockGemini84 = new GeminiService();
  (mockGemini84 as any).getClient = () => ({
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          overallVerdict: { score: 84.0, label: 'GOOD' },
          qualitativeCritique: ['Exceptional design with thoughtful information architecture.'],
          strengths: ['Harmonious color palette', 'Clear typography'],
          areasForRefinement: ['Improve initial bundle size'],
        }),
      }),
    },
  });

  const res84 = await mockGemini84.generateAnalysis({
    url: 'https://example.com',
    metrics: sampleMetrics, // Even with Perf=55, score MUST be 84
    screenshot: sampleScreenshot,
  });

  assert.strictEqual(res84.overallVerdict.score, 84.0, 'UIVerdict score must be 84.0 from Gemini');
  assert.strictEqual(res84.overallVerdict.label, 'GOOD');
  console.log('✓ Passed: Mocked Gemini score 84 preserved directly without formula overwrite');

  // Test 8: Mocked Gemini score of 52 results in UIVerdict score = 52
  console.log('\n[Test 8] Mocked Gemini score of 52 yields UIVerdict score = 52');
  const mockGemini52 = new GeminiService();
  (mockGemini52 as any).getClient = () => ({
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          overallVerdict: { score: 52.0, label: 'POOR' },
          qualitativeCritique: ['Confusing layout with broken component hierarchy visible in screenshot.'],
          strengths: ['Valid meta tags'],
          areasForRefinement: ['Redesign navigation', 'Fix contrast'],
        }),
      }),
    },
  });

  const res52 = await mockGemini52.generateAnalysis({
    url: 'https://example.com',
    metrics: sampleMetrics,
    screenshot: sampleScreenshot,
  });

  assert.strictEqual(res52.overallVerdict.score, 52.0, 'UIVerdict score must be 52.0 from Gemini');
  assert.strictEqual(res52.overallVerdict.label, 'POOR');
  console.log('✓ Passed: Mocked Gemini score 52 preserved directly without formula overwrite');

  // Test 9: Mocked Gemini score of 96 results in UIVerdict score = 96
  console.log('\n[Test 9] Mocked Gemini score of 96 yields UIVerdict score = 96');
  const mockGemini96 = new GeminiService();
  (mockGemini96 as any).getClient = () => ({
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          overallVerdict: { score: 96.0, label: 'EXCELLENT' },
          qualitativeCritique: ['Flawless UI execution with effortless navigation and instant response.'],
          strengths: ['World-class typography', 'Impeccable spacing'],
          areasForRefinement: ['Minor contrast tweak on dark mode footer'],
        }),
      }),
    },
  });

  const res96 = await mockGemini96.generateAnalysis({
    url: 'https://example.com',
    metrics: sampleMetrics,
    screenshot: sampleScreenshot,
  });

  assert.strictEqual(res96.overallVerdict.score, 96.0, 'UIVerdict score must be 96.0 from Gemini');
  assert.strictEqual(res96.overallVerdict.label, 'EXCELLENT');
  console.log('✓ Passed: Mocked Gemini score 96 preserved directly without formula overwrite');

  // Test 10: Label Normalization for Inconsistent Gemini Output
  console.log('\n[Test 10] Server-side Verdict Label Normalization');
  assert.strictEqual(resolveVerdictLabel(95, 'POOR'), 'EXCELLENT', 'Score 95 must normalize to EXCELLENT');
  assert.strictEqual(resolveVerdictLabel(85, 'POOR'), 'GOOD', 'Score 85 must normalize to GOOD');
  assert.strictEqual(resolveVerdictLabel(75, 'POOR'), 'SATISFACTORY', 'Score 75 must normalize to SATISFACTORY');
  assert.strictEqual(resolveVerdictLabel(65, 'EXCELLENT'), 'NEEDS IMPROVEMENT', 'Score 65 must normalize to NEEDS IMPROVEMENT');
  assert.strictEqual(resolveVerdictLabel(40, 'EXCELLENT'), 'POOR', 'Score 40 must normalize to POOR');
  console.log('✓ Passed: Inconsistent labels correctly normalized according to documented rubric');

  // Test 11: Lighthouse Technical Scores Remain Separately Available & Untouched
  console.log('\n[Test 11] Lighthouse Technical Metrics Separation & Integrity');
  assert.strictEqual(sampleMetrics.performance, 55);
  assert.strictEqual(sampleMetrics.accessibility, 92);
  assert.strictEqual(sampleMetrics.bestPractices, 100);
  assert.strictEqual(sampleMetrics.seo, 92);
  assert.strictEqual(sampleMetrics.largestContentfulPaint, '2.5 s');
  console.log('✓ Passed: Lighthouse technical metrics remain distinct, unmodified evidence');

  // Cleanup test screenshot
  try {
    if (fs.existsSync(testScreenshotPath)) {
      fs.unlinkSync(testScreenshotPath);
    }
  } catch {}

  console.log('\n==================================================');
  console.log('ALL GEMINI MULTIMODAL INTEGRATION TESTS PASSED');
  console.log('==================================================\n');
}

runTests().catch((error) => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
