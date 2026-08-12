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
