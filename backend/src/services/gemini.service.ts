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
      this.ai = new GoogleGenAI({
        apiKey: config.geminiApiKey,
        httpOptions: {
          timeout: config.geminiTimeoutMs,
        },
      });
    }
    return this.ai;
  }

  protected async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private statusOf(error: any): number {
    return Number(error?.status || error?.statusCode || error?.response?.status || 0);
  }

  private isTransientError(error: any): boolean {
    return [429, 500, 502, 503, 504].includes(this.statusOf(error)) ||
      error?.name === 'AbortError' || error?.code === 'ETIMEDOUT' ||
      /timeout|timed out|deadline_exceeded|socket hang up|fetch failed|network error/i.test(String(error?.message || ''));
  }

  private sanitizedError(error: any): string {
    return String(error?.message || 'Unknown error').replace(/AIza[\w-]{20,}/g, '[redacted]')
      .replace(/https?:\/\/\S+/g, '[url]').replace(/\s+/g, ' ').slice(0, 240);
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

  private async generateSingleAttempt(
    input: GeminiInputData,
    model: string,
    attempt: number,
    maxAttempts: number,
    timeoutMs: number
  ): Promise<AiAnalysis> {
    const startedAt = Date.now();

    const client = this.getClient();
    const userPrompt = generateUserPrompt(input);
    const screenshotPart = this.loadScreenshotPart(input.screenshot);

    const contents = [
      { text: userPrompt },
      screenshotPart,
    ];

    const abortController = new AbortController();
    let timer: NodeJS.Timeout | null = null;
    let didTimeout = false;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        didTimeout = true;
        abortController.abort();
        reject(new Error(`[Gemini] Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const apiPromise = client.models.generateContent({
        model,
        contents,
        config: {
          responseMimeType: 'application/json',
          responseSchema: responseSchema,
          systemInstruction: UI_VERDICT_SYSTEM_PROMPT,
          abortSignal: abortController.signal,
          httpOptions: {
            timeout: timeoutMs,
          },
        },
      });

      const response = await Promise.race([apiPromise, timeoutPromise]);

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

      console.info(`[Gemini] model=${model} attempt=${attempt}/${maxAttempts} elapsed_ms=${Date.now() - startedAt} status=200 result=success`);
      return aiResult;
    } catch (error: any) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      if (error instanceof ApiError) {
        console.error(`[Gemini] model=${model} attempt=${attempt}/${maxAttempts} elapsed_ms=${Date.now() - startedAt} status=${error.statusCode} error=${this.sanitizedError(error)}`);
        throw error;
      }

      const isTimeout =
        didTimeout ||
        abortController.signal.aborted ||
        error?.name === 'AbortError' ||
        String(error?.message || '').toLowerCase().includes('timed out') ||
        String(error?.message || '').toLowerCase().includes('timeout');

      if (isTimeout) {
        console.error(`[Gemini] Request timed out after ${timeoutMs}ms`);
        const timeoutError: any = new ApiError(503, `Gemini request timed out after ${timeoutMs}ms`);
        timeoutError.transient = true;
        throw timeoutError;
      }

      const status = this.statusOf(error);
      const message = this.sanitizedError(error);
      console.error(`[Gemini] model=${model} attempt=${attempt}/${maxAttempts} elapsed_ms=${Date.now() - startedAt} status=${status || 'n/a'} error=${message}`);
      if (status === 401 || status === 403 || /api[_ ]key|permission_denied|unauthorized|forbidden/i.test(message)) {
        throw new ApiError(502, 'Gemini authentication or permission failure');
      }
      if (status === 404 || /unsupported model|invalid model|model .*not found/i.test(message)) {
        throw new ApiError(502, 'Configured Gemini model is unsupported');
      }
      if (status === 400) throw new ApiError(502, 'Gemini rejected the analysis request');
      const retryable = this.isTransientError(error);
      const wrapped: any = new ApiError(status || 503, retryable ? 'Gemini is temporarily unavailable' : 'Gemini analysis request failed');
      wrapped.transient = retryable;
      throw wrapped;
    } finally {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }
  }

  public async generateAnalysis(input: GeminiInputData): Promise<AiAnalysis> {
    const models = [...new Set([config.geminiModel, config.geminiFallbackModel, config.geminiLastFallbackModel].filter(Boolean))];
    const deadline = Date.now() + config.geminiDeadlineMs;
    let lastError: any;
    for (const model of models) {
      for (let attempt = 1; attempt <= config.geminiMaxAttempts; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        try {
          return await this.generateSingleAttempt(input, model, attempt, config.geminiMaxAttempts, Math.min(config.geminiTimeoutMs, remaining));
        } catch (error: any) {
          lastError = error;
          const transient = Boolean(error?.transient) || (!(error instanceof ApiError) && this.isTransientError(error));
          if (!transient) throw error;
          if (attempt < config.geminiMaxAttempts && Date.now() < deadline) {
            const capMs = Math.min(500, 150 * 2 ** (attempt - 1));
            const delayMs = Math.floor(Math.random() * capMs);
            if (delayMs < deadline - Date.now()) await this.sleep(delayMs);
          }
          if ([503, 504].includes(this.statusOf(error)) || /timeout|deadline/i.test(error.message || '')) break;
        }
      }
      if (Date.now() >= deadline) break;
    }
    throw new ApiError(503, `AI feedback is unavailable: ${lastError?.message || 'Gemini deadline exceeded'}`);
  }
}

export const geminiService = new GeminiService();
