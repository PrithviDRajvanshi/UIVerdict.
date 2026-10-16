import { z } from 'zod';

export const verdictLabelSchema = z.enum([
  'EXCELLENT',
  'GOOD',
  'SATISFACTORY',
  'NEEDS IMPROVEMENT',
  'POOR',
]);

export const aiAnalysisSchema = z.object({
  visualDesignScore: z.number().min(0).max(100),
  qualitativeCritique: z.array(z.string().min(1)).min(1),
  strengths: z.array(z.string().min(1)).min(1),
  areasForRefinement: z.array(z.string().min(1)).min(1),
});

export type VerdictLabel = z.infer<typeof verdictLabelSchema>;
export type AiAnalysis = z.infer<typeof aiAnalysisSchema> & {
  /** Legacy report compatibility; new records derive this server-side. */
  overallVerdict?: { score: number; label: VerdictLabel } | null;
};

export const VERDICT_THRESHOLDS = {
  POOR: 0,
  EXCELLENT: 90,
  GOOD: 80,
  SATISFACTORY: 60,
  NEEDS_IMPROVEMENT: 40,
} as const;

/**
 * Resolves and normalizes the verdict label based on the 0-100 UIVerdict score:
 * 90-100 → EXCELLENT
 * 80-89.9 → GOOD
 * 60-79.9 → SATISFACTORY
 * 40-59.9 → NEEDS IMPROVEMENT
 * 0-39.9 → POOR
 */
export function resolveVerdictLabel(score: number, proposedLabel?: string): VerdictLabel {
  let expectedLabel: VerdictLabel;
  if (score >= VERDICT_THRESHOLDS.EXCELLENT) {
    expectedLabel = 'EXCELLENT';
  } else if (score >= VERDICT_THRESHOLDS.GOOD) {
    expectedLabel = 'GOOD';
  } else if (score >= VERDICT_THRESHOLDS.SATISFACTORY) {
    expectedLabel = 'SATISFACTORY';
  } else if (score >= VERDICT_THRESHOLDS.NEEDS_IMPROVEMENT) {
    expectedLabel = 'NEEDS IMPROVEMENT';
  } else if (score >= VERDICT_THRESHOLDS.POOR) {
    expectedLabel = 'POOR';
  } else {
    throw new Error('Verdict score must be between 0 and 100');
  }

  // If proposed label matches expected, keep it; otherwise return normalized label
  return expectedLabel;
}
