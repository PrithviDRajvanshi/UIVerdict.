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

  private isTransientError(error: any): boolean {
    if (!error) return false;
    const msg = String(error?.message || error?.status || error).toLowerCase();
    const statusCode = error?.statusCode || error?.status;

    if (statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504) {
      return true;
    }

    if (
      msg.includes('429') ||
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504') ||
      msg.includes('unavailable') ||
      msg.includes('resource_exhausted') ||
      msg.includes('high demand') ||
      msg.includes('rate limit') ||
      msg.includes('quota') ||
      msg.includes('timeout') ||
      msg.includes('overloaded')
    ) {
      return true;
    }

    return false;
  }

  private async generateSingleAttempt(input: GeminiInputData, attempt: number, maxAttempts: number): Promise<AiAnalysis> {
    console.log(`[Gemini] Attempt ${attempt}/${maxAttempts}: Starting AI analysis for URL: ${input.url}`);

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
        console.error(`[Gemini] Attempt ${attempt}/${maxAttempts} failed: Empty response from Gemini API`);
        throw new ApiError(500, 'AI analysis produced an empty response');
      }

      let parsedData: unknown;
      try {
        parsedData = JSON.parse(responseText);
      } catch (parseErr) {
        console.error(`[Gemini] Attempt ${attempt}/${maxAttempts} failed: Response was not valid JSON`);
        throw new ApiError(500, 'AI analysis produced malformed JSON');
      }

      // Validate schema with Zod
      const validationResult = aiAnalysisSchema.safeParse(parsedData);
      if (!validationResult.success) {
        console.error(`[Gemini] Attempt ${attempt}/${maxAttempts} failed: Zod validation error`, validationResult.error);
        throw new ApiError(500, 'AI analysis response failed validation schema');
      }

      const aiResult = validationResult.data;

      // Enforce backend global score as source of truth for overallVerdict.score
      aiResult.overallVerdict.score = input.globalScore;

      console.log(`[Gemini] Attempt ${attempt}/${maxAttempts}: Completed successfully for URL: ${input.url}`);
      return aiResult;
    } catch (error: any) {
      if (error instanceof ApiError) {
        throw error;
      }

      const errorMessage = error?.message || 'Unknown error';
      console.error(`[Gemini] Attempt ${attempt}/${maxAttempts} failed: ${errorMessage}`);

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
        errorMessage.includes('UNAVAILABLE') ||
        errorMessage.includes('high demand')
      ) {
        throw new ApiError(503, 'Gemini AI service is currently unavailable');
      }

      throw new ApiError(500, 'Failed to generate AI analysis');
    }
  }

  public async generateAnalysis(input: GeminiInputData): Promise<AiAnalysis> {
    const MAX_ATTEMPTS = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.generateSingleAttempt(input, attempt, MAX_ATTEMPTS);
      } catch (error: any) {
        lastError = error;
        const isTransient = this.isTransientError(error);

        if (!isTransient || attempt === MAX_ATTEMPTS) {
          console.error(`[Gemini] Attempt ${attempt}/${MAX_ATTEMPTS} failed permanently or reached max attempts.`);
          break;
        }

        const backoffMs = attempt * 2000;
        console.warn(`[Gemini] Attempt ${attempt}/${MAX_ATTEMPTS} failed with transient error (${error?.message || error}). Retrying in ${backoffMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    if (lastError instanceof ApiError) {
      throw lastError;
    }
    throw new ApiError(503, `Gemini AI service is currently unavailable: ${lastError?.message || 'Unknown failure'}`);
  }
}

export const geminiService = new GeminiService();
