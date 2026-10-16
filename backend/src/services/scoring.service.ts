import type { LighthouseMetrics } from './lighthouse.service';

/** Convert Lighthouse's 0-1 category score to its displayed 0-100 scale. */
export function normalizeLighthouseCategoryScore(score: number | null | undefined): number | null {
  if (score === null || score === undefined || !Number.isFinite(score) || score < 0 || score > 1) return null;
  return Math.round(score * 100);
}

/**
 * Combines Gemini's screenshot-only UX score with available Lighthouse scores.
 * Every observed dimension has equal weight via a geometric mean. If any
 * observed dimension is below 40, the final score is capped at 59.9 so strong
 * results elsewhere cannot hide a critical weakness. Missing Lighthouse
 * categories are excluded; they are never treated as zero.
 */
export function calculateOverallScore(qualitativeScore: number, metrics: Pick<LighthouseMetrics,
  'performance' | 'accessibility' | 'bestPractices' | 'seo'>): number {
  const values = [qualitativeScore, metrics.performance, metrics.accessibility, metrics.bestPractices, metrics.seo]
    .filter((value): value is number => value !== null);

  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    throw new Error('Scoring inputs must be finite numbers between 0 and 100, or null for unavailable measurements');
  }

  const geometricMean = values.some((value) => value === 0)
    ? 0
    : Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
  // A severe dimension must remain visible in the final label even if other
  // dimensions are excellent. The ceiling aligns with NEEDS IMPROVEMENT's cap.
  const score = values.some((value) => value < 40) ? Math.min(geometricMean, 59.9) : geometricMean;
  return Math.round(score * 10) / 10;
}
