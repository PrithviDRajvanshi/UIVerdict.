import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config/env';
import { ApiError } from '../errors/ApiError';
import { LighthouseMetrics } from './lighthouse.service';
import { ScreenshotResult } from './playwright.service';
import { UI_VERDICT_SYSTEM_PROMPT, generateUserPrompt } from '../prompts/uiVerdict.prompt';
import { aiAnalysisSchema, AiAnalysis, resolveVerdictLabel } from '../validators/aiAnalysis.validator';
import fs from 'fs';
import path from 'path';

export interface GeminiInputData {
  url: string;
  metrics: LighthouseMetrics;
  screenshot: ScreenshotResult;
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    overallVerdict: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.NUMBER, description: 'Independent holistic UIVerdict score between 0 and 100 based on UX/UI evaluation and objective evidence' },
        label: {
          type: Type.STRING,
          enum: ['EXCELLENT', 'GOOD', 'SATISFACTORY', 'NEEDS IMPROVEMENT', 'POOR'],
          description: 'Verdict label strictly aligned with the UIVerdict score rubric',
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

    // Never retry on missing files, bad paths, or client errors
    if (msg.includes('screenshot') || msg.includes('file not found') || msg.includes('path traversal') || statusCode === 400) {
      return false;
    }

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

  private loadScreenshotPart(screenshot: ScreenshotResult): { inlineData: { mimeType: string; data: string } } {
    if (!screenshot || (!screenshot.path && !screenshot.filename)) {
      throw new ApiError(500, 'Screenshot evidence metadata is missing');
    }

    const screenshotsBaseDir = path.resolve(process.cwd(), 'temp', 'screenshots');

    // Safely resolve screenshot file path
    let targetPath: string;
    if (screenshot.path && path.isAbsolute(screenshot.path)) {
      targetPath = path.normalize(screenshot.path);
    } else if (screenshot.path) {
      targetPath = path.resolve(process.cwd(), screenshot.path);
    } else {
      const safeFilename = path.basename(screenshot.filename);
      targetPath = path.resolve(screenshotsBaseDir, safeFilename);
    }

    targetPath = path.normalize(targetPath);

    // Security: Prevent directory traversal outside temp directory
    const tempDir = path.resolve(process.cwd(), 'temp');
    if (!targetPath.startsWith(screenshotsBaseDir) && !targetPath.startsWith(tempDir)) {
      console.error('[Gemini] Path traversal attempt detected for screenshot path:', targetPath);
      throw new ApiError(400, 'Invalid screenshot file path');
    }

    if (!fs.existsSync(targetPath)) {
      console.error('[Gemini] Screenshot evidence file does not exist:', targetPath);
      throw new ApiError(500, 'Screenshot evidence file not found for multimodal analysis');
    }

    let imageBuffer: Buffer;
    try {
      imageBuffer = fs.readFileSync(targetPath);
    } catch (err: any) {
      console.error('[Gemini] Failed to read screenshot evidence file:', err?.message || err);
      throw new ApiError(500, 'Failed to read screenshot evidence file');
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      throw new ApiError(500, 'Screenshot evidence file is empty');
    }

    return {
      inlineData: {
        mimeType: 'image/png',
        data: imageBuffer.toString('base64'),
      },
    };
  }

  private async generateSingleAttempt(input: GeminiInputData, attempt: number, maxAttempts: number): Promise<AiAnalysis> {
    console.log(`[Gemini] Attempt ${attempt}/${maxAttempts}: Starting multimodal AI analysis for URL: ${input.url}`);

    const client = this.getClient();
    const userPrompt = generateUserPrompt(input);
    const screenshotPart = this.loadScreenshotPart(input.screenshot);

    const contents = [
      { text: userPrompt },
      screenshotPart,
    ];

    try {
      const response = await client.models.generateContent({
        model: config.geminiModel,
        contents,
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

      // Validate score range 0-100 and normalize verdict label according to documented rubric
      const rawScore = Number(aiResult.overallVerdict.score);
      const normalizedScore = Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10));
      aiResult.overallVerdict.score = normalizedScore;
      aiResult.overallVerdict.label = resolveVerdictLabel(normalizedScore, aiResult.overallVerdict.label);

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
