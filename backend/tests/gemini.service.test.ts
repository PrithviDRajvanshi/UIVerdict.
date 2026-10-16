import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { GeminiService } from '../src/services/gemini.service';
import { config } from '../src/config/env';
import { calculateOverallScore } from '../src/services/scoring.service';
import { resolveVerdictLabel } from '../src/validators/aiAnalysis.validator';

const screenshotDir = path.resolve(process.cwd(), 'temp', 'screenshots');
const screenshotPath = path.join(screenshotDir, 'gemini-mock.png');
const valid = {
  overallVerdict: { score: 84, label: 'GOOD' },
  qualitativeCritique: ['Clear hierarchy'],
  strengths: ['Readable layout'],
  areasForRefinement: ['Improve spacing'],
};
const input: any = {
  url: 'https://example.com',
  metrics: { performance: 80, accessibility: 80, bestPractices: 80, seo: 80,
    firstContentfulPaint: '1.0 s', largestContentfulPaint: '2.0 s', speedIndex: '1.2 s',
    totalBlockingTime: '100 ms', cumulativeLayoutShift: '0.01', timeToInteractive: '2.5 s' },
  screenshot: { url: 'https://example.com', filename: 'gemini-mock.png', path: 'temp/screenshots/gemini-mock.png' },
};

function makeService(respond: (request: any, call: number) => Promise<any> | any) {
  const service = new GeminiService();
  let calls = 0;
  (service as any).getClient = () => ({ models: { generateContent: async (request: any) => respond(request, ++calls) } });
  (service as any).sleep = async () => {};
  return { service, calls: () => calls };
}

async function run() {
  await fs.promises.mkdir(screenshotDir, { recursive: true });
  await fs.promises.writeFile(screenshotPath, Buffer.from('mock image bytes'));
  const old = { primary: config.geminiModel, fallback: config.geminiFallbackModel, last: config.geminiLastFallbackModel,
    timeout: config.geminiTimeoutMs, deadline: config.geminiDeadlineMs, attempts: config.geminiMaxAttempts };
  config.geminiModel = 'gemini-3.8-flash';
  config.geminiFallbackModel = 'gemini-3.6-flash';
  config.geminiLastFallbackModel = 'gemini-3.5-flash-lite';
  config.geminiTimeoutMs = 80;
  config.geminiDeadlineMs = 500;
  config.geminiMaxAttempts = 2;
  try {
    let primaryRequest: any;
    const primary = makeService(async (req) => { primaryRequest = req; return { text: JSON.stringify(valid) }; });
    const primaryResult = await primary.service.generateAnalysis(input);
    const expectedScore = calculateOverallScore(valid.overallVerdict.score, input.metrics);
    assert.deepStrictEqual(primaryResult.overallVerdict, { score: expectedScore, label: resolveVerdictLabel(expectedScore) });
    assert.strictEqual(primary.calls(), 1, 'primary success should make one call');
    assert.strictEqual(primaryRequest.contents.length, 2, 'text prompt and screenshot remain multimodal input');
    assert.strictEqual(primaryRequest.contents[1].inlineData.mimeType, 'image/png');
    assert.ok(primaryRequest.config.responseSchema && primaryRequest.config.responseMimeType === 'application/json');
    assert.ok(primaryRequest.config.systemInstruction);
    assert.strictEqual(primaryRequest.config.temperature, 0, 'the qualitative model request uses deterministic sampling settings');

    const inconsistentModelLabel = makeService(async () => ({ text: JSON.stringify({
      ...valid, overallVerdict: { score: 95, label: 'POOR' },
    }) }));
    const normalizedResult = await inconsistentModelLabel.service.generateAnalysis(input);
    const normalizedScore = calculateOverallScore(95, input.metrics);
    assert.strictEqual(normalizedResult.overallVerdict.score, normalizedScore);
    assert.strictEqual(normalizedResult.overallVerdict.label, resolveVerdictLabel(normalizedScore),
      'a model-proposed label that conflicts with the final score is replaced');

    const fallbackModels: string[] = [];
    const fallback = makeService(async (req) => {
      fallbackModels.push(req.model);
      if (req.model === config.geminiModel) throw Object.assign(new Error('UNAVAILABLE'), { status: 503 });
      return { text: JSON.stringify(valid) };
    });
    await fallback.service.generateAnalysis(input);
    assert.deepStrictEqual(fallbackModels, [config.geminiModel, config.geminiFallbackModel]);

    const exhausted = makeService(async () => { throw Object.assign(new Error('busy'), { status: 429 }); });
    await assert.rejects(() => exhausted.service.generateAnalysis(input), /AI feedback is unavailable/);
    assert.strictEqual(exhausted.calls(), 6, 'retries are bounded at two per configured model');

    const invalidKey = makeService(async () => { throw Object.assign(new Error('API key invalid'), { status: 401 }); });
    await assert.rejects(() => invalidKey.service.generateAnalysis(input), /authentication or permission/);
    assert.strictEqual(invalidKey.calls(), 1, 'invalid key must not retry or fail over');

    const malformed = makeService(async () => ({ text: '{bad json' }));
    await assert.rejects(() => malformed.service.generateAnalysis(input), /malformed JSON/);
    assert.strictEqual(malformed.calls(), 1, 'malformed output must not be accepted or retried');

    const timeout = makeService(async () => new Promise(() => {}));
    const before = Date.now();
    await assert.rejects(() => timeout.service.generateAnalysis(input), /AI feedback is unavailable/);
    assert.ok(Date.now() - before < 700, 'per-request timeout and overall deadline stay bounded');
    console.log('Gemini mocked tests passed (primary, fallback, exhausted retries, invalid key, malformed JSON, timeout).');
  } finally {
    config.geminiTimeoutMs = old.timeout;
    config.geminiDeadlineMs = old.deadline;
    config.geminiMaxAttempts = old.attempts;
    config.geminiModel = old.primary;
    config.geminiFallbackModel = old.fallback;
    config.geminiLastFallbackModel = old.last;
    await fs.promises.rm(screenshotPath, { force: true });
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
