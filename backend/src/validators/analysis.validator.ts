import { z } from 'zod';

export const analyzeSchema = z.object({
  body: z.object({
    url: z.string({ required_error: 'URL is required' }).url('Must be a valid URL'),
  }),
});
