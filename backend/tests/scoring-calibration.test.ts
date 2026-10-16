import assert from 'assert';
import { calculateOverallScore, normalizeLighthouseCategoryScore } from '../src/services/scoring.service';
import { resolveVerdictLabel } from '../src/validators/aiAnalysis.validator';

const complete = (v: number, p = v, a = v, b = v, s = v) => ({ performance: p, accessibility: a, bestPractices: b, seo: s });
const fixtures = [
  ['polished ecommerce', 92, complete(88), 88.8, 'GOOD', 'A strong visual score with slightly lower but complete technical results.'],
  ['SaaS landing page', 88, complete(90), 89.6, 'GOOD', 'Consistent strong evidence across all five dimensions.'],
  ['portfolio', 84, complete(86, 92, 95, 88, 62), 83.3, 'GOOD', 'Strong design and technical results with SEO weakness.'],
  ['news interface', 78, complete(80, 54, 82, 80, 94), 76.4, 'SATISFACTORY', 'Content UX and SEO strengths coexist with low performance.'],
  ['poor interface', 30, complete(40, 45, 38, 42, 35), 37.6, 'POOR', 'Weak visual and technical evidence remains low.'],
] as const;

function run() {
  assert.strictEqual(normalizeLighthouseCategoryScore(0.774), 77);
  assert.strictEqual(normalizeLighthouseCategoryScore(0), 0);
  assert.strictEqual(normalizeLighthouseCategoryScore(null), null);
  assert.strictEqual(normalizeLighthouseCategoryScore(Number.NaN), null);
  assert.strictEqual(normalizeLighthouseCategoryScore(1.01), null);
  assert.strictEqual(calculateOverallScore(89.94, complete(89.94)), 89.9);
  assert.strictEqual(calculateOverallScore(80, { ...complete(80), seo: null }), null, 'overall requires every dimension');
  assert.strictEqual(calculateOverallScore(null, complete(90)), null, 'missing visual score is not replaced');
  assert.strictEqual(calculateOverallScore(0, complete(100)), 0, 'measured zero is valid');
  assert.throws(() => calculateOverallScore(101, complete(80)), /finite numbers/);
  assert.throws(() => calculateOverallScore(Number.NaN, complete(80)), /finite numbers/);
  assert.throws(() => calculateOverallScore(Infinity, complete(80)), /finite numbers/);

  const boundaries: Array<[number, string]> = [
    [0, 'POOR'], [39.9, 'POOR'], [39.99, 'POOR'], [40, 'NEEDS IMPROVEMENT'], [40.01, 'NEEDS IMPROVEMENT'],
    [59.9, 'NEEDS IMPROVEMENT'], [60, 'SATISFACTORY'], [60.01, 'SATISFACTORY'], [79.9, 'SATISFACTORY'],
    [80, 'GOOD'], [80.01, 'GOOD'], [89.9, 'GOOD'], [90, 'EXCELLENT'], [90.01, 'EXCELLENT'], [100, 'EXCELLENT'],
  ];
  for (const [score, label] of boundaries) assert.strictEqual(resolveVerdictLabel(score), label, `label boundary ${score}`);

  const scores = fixtures.map(([, visual, metrics]) => calculateOverallScore(visual, metrics));
  assert.deepStrictEqual(scores, fixtures.map(([, visual, metrics]) => calculateOverallScore(visual, metrics)), 'identical inputs are deterministic');
  fixtures.forEach(([name, visual, metrics, expected, expectedLabel, rationale], i) => {
    assert.strictEqual(scores[i], expected, `${name} independently expected overall score`);
    assert.strictEqual(resolveVerdictLabel(scores[i]!), expectedLabel, `${name} independently expected label`);
    console.log(`Synthetic fixture ${name}: visual=${visual}, overall=${scores[i]}, ${resolveVerdictLabel(scores[i]!)}; ${rationale}`);
  });

  const weakVisual = calculateOverallScore(25, complete(98, 99, 97, 98));
  assert.ok(weakVisual! < 60, 'strong Lighthouse scores cannot conceal weak visual design');
  const weakPerformance = calculateOverallScore(95, complete(95, 95, 95, 25));
  assert.strictEqual(weakPerformance, 59.9, 'below-40 dimension cap is retained to expose a critical weakness');
  const mixed = calculateOverallScore(82, { performance: 88, accessibility: 77, bestPractices: 54, seo: 90 });
  assert.ok(mixed! > 54 && mixed! < 82);
  assert.strictEqual(resolveVerdictLabel(mixed!), resolveVerdictLabel(calculateOverallScore(82, { performance: 88, accessibility: 77, bestPractices: 54, seo: 90 })!));
  console.log('Scoring tests passed. Synthetic fixtures are illustrative and do not establish real-world calibration.');
}
run();
