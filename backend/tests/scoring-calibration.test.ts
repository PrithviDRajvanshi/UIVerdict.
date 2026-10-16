import assert from 'assert';
import { calculateOverallScore, normalizeLighthouseCategoryScore } from '../src/services/scoring.service';
import { resolveVerdictLabel } from '../src/validators/aiAnalysis.validator';

type Fixture = {
  name: string;
  qualitative: number;
  metrics: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null };
  rationale: string;
};

// Synthetic logic-only fixtures. These are not claimed as actual website audits.
const fixtures: Fixture[] = [
  { name: 'polished e-commerce', qualitative: 90, metrics: { performance: 88, accessibility: 77, bestPractices: 92, seo: 85 }, rationale: 'Strong visual UX with one moderate accessibility dimension.' },
  { name: 'modern SaaS landing page', qualitative: 88, metrics: { performance: 83, accessibility: 91, bestPractices: 90, seo: 96 }, rationale: 'Consistently strong qualitative and technical dimensions.' },
  { name: 'simple personal portfolio', qualitative: 84, metrics: { performance: 92, accessibility: 96, bestPractices: 88, seo: 62 }, rationale: 'Good UX and technical results; weaker SEO remains visible without assuming e-commerce features.' },
  { name: 'content-heavy news website', qualitative: 79, metrics: { performance: 54, accessibility: 82, bestPractices: 80, seo: 94 }, rationale: 'Good content UX and SEO with a notable performance weakness.' },
  { name: 'deliberately poor test website', qualitative: 30, metrics: { performance: 45, accessibility: 38, bestPractices: 42, seo: 35 }, rationale: 'Weak qualitative UX and weak technical dimensions agree.' },
];

function run() {
  assert.strictEqual(normalizeLighthouseCategoryScore(0.774), 77, 'Lighthouse 0-1 scores round onto the 0-100 scale');
  assert.strictEqual(normalizeLighthouseCategoryScore(0), 0, 'measured zero remains zero');
  assert.strictEqual(normalizeLighthouseCategoryScore(null), null, 'missing category stays unavailable');
  assert.strictEqual(normalizeLighthouseCategoryScore(undefined), null, 'missing category stays unavailable');
  assert.strictEqual(normalizeLighthouseCategoryScore(Number.NaN), null, 'invalid category stays unavailable');
  assert.strictEqual(normalizeLighthouseCategoryScore(1.01), null, 'out-of-range category stays unavailable');
  assert.strictEqual(calculateOverallScore(89.94, { performance: 89.94, accessibility: 89.94, bestPractices: 89.94, seo: 89.94 }), 89.9,
    'combined score rounds consistently to one decimal place');

  const verdictBoundaries: Array<[number, string]> = [
    [0, 'POOR'], [39.9, 'POOR'], [40, 'NEEDS IMPROVEMENT'], [59.9, 'NEEDS IMPROVEMENT'],
    [60, 'SATISFACTORY'], [79.9, 'SATISFACTORY'], [80, 'GOOD'], [89.9, 'GOOD'], [90, 'EXCELLENT'], [100, 'EXCELLENT'],
  ];
  for (const [score, label] of verdictBoundaries) assert.strictEqual(resolveVerdictLabel(score), label, `verdict at ${score}`);

  const results = fixtures.map((fixture) => {
    const score = calculateOverallScore(fixture.qualitative, fixture.metrics);
    const legacyLabel = fixture.qualitative >= 90 ? 'EXCELLENT' : fixture.qualitative >= 80 ? 'GOOD'
      : fixture.qualitative >= 70 ? 'SATISFACTORY' : fixture.qualitative >= 60 ? 'NEEDS IMPROVEMENT' : 'POOR';
    return { ...fixture, legacyLabel, score, verdict: resolveVerdictLabel(score) };
  });
  assert.deepStrictEqual(results.map((row) => row.score), results.map((row) =>
    calculateOverallScore(fixtures.find((fixture) => fixture.name === row.name)!.qualitative, fixtures.find((fixture) => fixture.name === row.name)!.metrics)),
  'identical scoring inputs produce identical outputs');
  assert.strictEqual(calculateOverallScore(80, { performance: 80, accessibility: null, bestPractices: null, seo: null }), 80,
    'missing dimensions are excluded rather than scored as zero');
  assert.throws(() => calculateOverallScore(80, { performance: 101, accessibility: null, bestPractices: null, seo: null }), /finite numbers/,
    'invalid 0-100 inputs are rejected');
  assert.throws(() => calculateOverallScore(Number.NaN, { performance: null, accessibility: null, bestPractices: null, seo: null }), /finite numbers/,
    'invalid qualitative input is rejected');

  const mixedScore = calculateOverallScore(82, { performance: 88, accessibility: 77, bestPractices: 54, seo: 90 });
  assert.ok(mixedScore < 82 && mixedScore > 54, 'a weak technical dimension has visible impact without overriding the whole assessment');
  assert.strictEqual(resolveVerdictLabel(mixedScore), 'SATISFACTORY');
  const weakUxScore = calculateOverallScore(25, { performance: 98, accessibility: 99, bestPractices: 97, seo: 98 });
  assert.ok(weakUxScore < 60, 'strong technical metrics cannot conceal very weak qualitative UX');
  assert.strictEqual(resolveVerdictLabel(weakUxScore), 'NEEDS IMPROVEMENT',
    'strong technical metrics cannot conceal very weak qualitative UX');
  assert.strictEqual(calculateOverallScore(95, { performance: 25, accessibility: 95, bestPractices: 95, seo: 95 }) < 70, true,
    'strong qualitative UX cannot conceal a severe technical weakness');

  console.log('Synthetic scoring fixtures (logic-only):');
  for (const result of results) console.log(
    `- ${result.name}: synthetic Lighthouse=${JSON.stringify(result.metrics)}, qualitative=${result.qualitative}; legacy=${result.qualitative} ${result.legacyLabel}; calibrated=${result.score} ${result.verdict}; ${result.rationale}`,
  );
  console.log('Scoring calibration tests passed.');
}

run();
