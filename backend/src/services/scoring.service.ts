import type { LighthouseMetrics } from './lighthouse.service';

/** Convert Lighthouse's 0-1 category score to its displayed 0-100 scale. */
export function normalizeLighthouseCategoryScore(score: number | null | undefined): number | null {
  if (score === null || score === undefined || !Number.isFinite(score) || score < 0 || score > 1) return null;
  return Math.round(score * 100);
}

/**
 * Combines Gemini's screenshot-only visual score with all four Lighthouse categories.
 * Each required dimension has equal weight via a geometric mean. If any
 * dimension is below 40, the final score is capped at 59.9 so strong results
 * elsewhere cannot hide a critical weakness. If an input is unavailable, no
 * overall score is emitted; unavailable is never treated as zero.
 */
export function calculateOverallScore(visualDesignScore: number | null, metrics: Pick<LighthouseMetrics,
  'performance' | 'accessibility' | 'bestPractices' | 'seo'>): number | null {
  const values = [visualDesignScore, metrics.performance, metrics.accessibility, metrics.bestPractices, metrics.seo];

  if (values.some((value) => value !== null && (!Number.isFinite(value) || value < 0 || value > 100))) {
    throw new Error('Scoring inputs must be finite numbers between 0 and 100, or null for unavailable measurements');
  }

  if (values.some((value) => value === null)) return null;
  const availableValues = values as number[];

  const geometricMean = availableValues.some((value) => value === 0)
    ? 0
    : Math.exp(availableValues.reduce((sum, value) => sum + Math.log(value), 0) / availableValues.length);
  // A severe dimension must remain visible in the final label even if other
  // dimensions are excellent. The ceiling aligns with NEEDS IMPROVEMENT's cap.
  const score = availableValues.some((value) => value < 40) ? Math.min(geometricMean, 59.9) : geometricMean;
  return Math.round(score * 10) / 10;
}
