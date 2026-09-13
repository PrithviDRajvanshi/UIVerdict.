import { z } from 'zod';

export const verdictLabelSchema = z.enum([
  'EXCELLENT',
  'GOOD',
  'SATISFACTORY',
  'NEEDS IMPROVEMENT',
  'POOR',
]);

export const aiAnalysisSchema = z.object({
  overallVerdict: z.object({
    score: z.number().min(0).max(100),
    label: verdictLabelSchema,
  }),
  qualitativeCritique: z.array(z.string().min(1)).min(1),
  strengths: z.array(z.string().min(1)).min(1),
  areasForRefinement: z.array(z.string().min(1)).min(1),
});

export type AiAnalysis = z.infer<typeof aiAnalysisSchema>;
export type VerdictLabel = z.infer<typeof verdictLabelSchema>;

/**
 * Resolves and normalizes the verdict label based on the 0-100 UIVerdict score:
 * 90-100 → EXCELLENT
 * 80-89.9 → GOOD
 * 70-79.9 → SATISFACTORY
 * 60-69.9 → NEEDS IMPROVEMENT
 * 0-59.9 → POOR
 */
export function resolveVerdictLabel(score: number, proposedLabel?: string): VerdictLabel {
  let expectedLabel: VerdictLabel;
  if (score >= 90) {
    expectedLabel = 'EXCELLENT';
  } else if (score >= 80) {
    expectedLabel = 'GOOD';
  } else if (score >= 70) {
    expectedLabel = 'SATISFACTORY';
  } else if (score >= 60) {
    expectedLabel = 'NEEDS IMPROVEMENT';
  } else {
    expectedLabel = 'POOR';
  }

  // If proposed label matches expected, keep it; otherwise return normalized label
  return expectedLabel;
}
