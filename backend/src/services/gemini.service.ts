import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config/env';
import { ApiError } from '../errors/ApiError';
import { LighthouseMetrics } from './lighthouse.service';
import { ScreenshotResult } from './playwright.service';
import { UI_VERDICT_SYSTEM_PROMPT, generateUserPrompt } from '../prompts/uiVerdict.prompt';
import { aiAnalysisSchema, AiAnalysis } from '../validators/aiAnalysis.validator';

export interface GeminiInputData {
  url: string;
  metrics: LighthouseMetrics;
  screenshot: ScreenshotResult;
  globalScore: number;
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    overallVerdict: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.NUMBER, description: 'Numeric global score between 0 and 100' },
        label: {
          type: Type.STRING,
          enum: ['EXCELLENT', 'GOOD', 'SATISFACTORY', 'NEEDS IMPROVEMENT', 'POOR'],
          description: 'Verdict label based on global score and evidence',
        },
      },
      required: ['score', 'label'],
    },
    qualitativeCritique: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Structured paragraphs of qualitative UI/UX critique',
    },
    strengths: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'List of specific UI/UX strengths identified',
    },
    areasForRefinement: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'List of actionable UI/UX areas for refinement',
    },
  },
  required: ['overallVerdict', 'qualitativeCritique', 'strengths', 'areasForRefinement'],
};

export class GeminiService {
  private ai: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    if (!config.geminiApiKey) {
      throw new ApiError(500, 'Gemini API key is not configured');
    }
    if (!this.ai) {
      this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
    return this.ai;
  }

  public async generateAnalysis(input: GeminiInputData): Promise<AiAnalysis> {
    console.log(`[Gemini] Starting AI analysis for URL: ${input.url}`);

    const client = this.getClient();
    const userPrompt = generateUserPrompt(input);

    try {
      const response = await client.models.generateContent({
        model: config.geminiModel,
        contents: userPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: responseSchema,
          systemInstruction: UI_VERDICT_SYSTEM_PROMPT,
        },
      });

      const responseText = response.text;
      if (!responseText) {
        console.error('[Gemini] AI analysis failed: Empty response from Gemini API');
        throw new ApiError(500, 'AI analysis produced an empty response');
      }

      let parsedData: unknown;
      try {
        parsedData = JSON.parse(responseText);
      } catch (parseErr) {
        console.error('[Gemini] AI analysis failed: Response was not valid JSON');
        throw new ApiError(500, 'AI analysis produced malformed JSON');
      }

      // Validate schema with Zod
      const validationResult = aiAnalysisSchema.safeParse(parsedData);
      if (!validationResult.success) {
        console.error('[Gemini] AI analysis failed: Zod validation error', validationResult.error);
        throw new ApiError(500, 'AI analysis response failed validation schema');
      }

      const aiResult = validationResult.data;

      // Enforce backend global score as source of truth for overallVerdict.score
      aiResult.overallVerdict.score = input.globalScore;

      console.log(`[Gemini] AI analysis completed successfully for URL: ${input.url}`);
      return aiResult;
    } catch (error: any) {
      if (error instanceof ApiError) {
        throw error;
      }

      const errorMessage = error?.message || 'Unknown error';
      console.error(`[Gemini] AI analysis failed: ${errorMessage}`);

      // Handle specific error types cleanly without leaking sensitive details or stack traces
      if (
        errorMessage.includes('API key') ||
        errorMessage.includes('API_KEY') ||
        errorMessage.includes('401') ||
        errorMessage.includes('403')
      ) {
        throw new ApiError(500, 'Gemini API authentication failure');
      }
      if (
        errorMessage.includes('429') ||
        errorMessage.includes('quota') ||
        errorMessage.includes('Rate limit')
      ) {
        throw new ApiError(429, 'Gemini API rate limit exceeded');
      }
      if (
        errorMessage.includes('timeout') ||
        errorMessage.includes('503') ||
        errorMessage.includes('UNAVAILABLE')
      ) {
        throw new ApiError(503, 'Gemini AI service is currently unavailable');
      }

      throw new ApiError(500, 'Failed to generate AI analysis');
    }
  }
}

export const geminiService = new GeminiService();
