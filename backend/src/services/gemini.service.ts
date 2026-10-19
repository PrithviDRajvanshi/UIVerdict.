import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config/env';
import { ApiError } from '../errors/ApiError';
import { ScreenshotResult } from './playwright.service';
import { UI_VERDICT_SYSTEM_PROMPT, generateUserPrompt } from '../prompts/uiVerdict.prompt';
import { aiAnalysisSchema, AiAnalysis } from '../validators/aiAnalysis.validator';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const SCREENSHOT_DOWNSCALE_THRESHOLD_BYTES = 1_000_000;
const GEMINI_IMAGE_MAX_HEIGHT = 4096;

export interface GeminiInputData {
  url: string;
  screenshot: ScreenshotResult;
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    visualDesignScore: { type: Type.NUMBER, description: 'Screenshot-only visual design score between 0 and 100; exclude Lighthouse metrics and interaction claims' },
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
  required: ['visualDesignScore', 'qualitativeCritique', 'strengths', 'areasForRefinement'],
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

  private async loadScreenshotPart(screenshot: ScreenshotResult): Promise<{
    part: { inlineData: { mimeType: string; data: string } };
    fileReadMs: number;
    imageTransformMs: number;
    base64EncodeMs: number;
    sourceBytes: number;
    imageBytesSent: number;
    base64BytesSent: number;
  }> {
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

    const readStartedAt = Date.now();
    let imageBuffer: Buffer;
    try {
      imageBuffer = await fs.promises.readFile(targetPath);
    } catch (err: any) {
      console.error('[Gemini] Failed to read screenshot evidence file:', err?.message || err);
      throw new ApiError(500, 'Failed to read screenshot evidence file');
    }
    const fileReadMs = Date.now() - readStartedAt;

    if (!imageBuffer || imageBuffer.length === 0) {
      throw new ApiError(500, 'Screenshot evidence file is empty');
    }

    const sourceBytes = imageBuffer.byteLength;
    const transformStartedAt = Date.now();
    let imageBytes = imageBuffer;
    let mimeType = 'image/png';
    if (sourceBytes > SCREENSHOT_DOWNSCALE_THRESHOLD_BYTES) {
      try {
        const image = sharp(imageBuffer, { limitInputPixels: 40_000_000 });
        const metadata = await image.metadata();
        if (!metadata.height) throw new Error('Screenshot height unavailable');
        const targetHeight = Math.min(GEMINI_IMAGE_MAX_HEIGHT, Math.max(1, Math.floor(metadata.height * 0.75)));
        imageBytes = await image
          .rotate()
          .resize({ height: targetHeight, withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        mimeType = 'image/jpeg';
      } catch (error: any) {
        console.error('[Gemini] Failed to downscale large screenshot:', this.sanitizedError(error));
        throw new ApiError(500, 'Failed to prepare screenshot for Gemini analysis');
      }
    }
    const imageTransformMs = Date.now() - transformStartedAt;
    const base64StartedAt = Date.now();
    const base64 = imageBytes.toString('base64');
    const base64EncodeMs = Date.now() - base64StartedAt;

    return {
      part: { inlineData: { mimeType, data: base64 } },
      fileReadMs,
      imageTransformMs,
      base64EncodeMs,
      sourceBytes,
      imageBytesSent: imageBytes.byteLength,
      base64BytesSent: Buffer.byteLength(base64, 'utf8'),
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

    console.info('[Gemini] Attempt started:', { model, attempt, maxAttempts, timeoutMs });
    const clientStartedAt = Date.now();
    const client = this.getClient();
    const clientInitMs = Date.now() - clientStartedAt;
    const promptStartedAt = Date.now();
    const userPrompt = generateUserPrompt(input);
    const promptBuildMs = Date.now() - promptStartedAt;
    const screenshotPart = await this.loadScreenshotPart(input.screenshot);

    const requestBuildStartedAt = Date.now();
    const contents = [
      { text: userPrompt },
      screenshotPart.part,
    ];
    const request = {
      model,
      contents,
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema,
        systemInstruction: UI_VERDICT_SYSTEM_PROMPT,
        abortSignal: undefined as AbortSignal | undefined,
        httpOptions: { timeout: timeoutMs },
      },
    };
    const requestBuildMs = Date.now() - requestBuildStartedAt;
    console.info('[Gemini] Request prepared:', {
      model,
      attempt,
      maxAttempts,
      timeoutMs,
      clientInitMs,
      promptBuildMs,
      fileReadMs: screenshotPart.fileReadMs,
      imageTransformMs: screenshotPart.imageTransformMs,
      base64EncodeMs: screenshotPart.base64EncodeMs,
      requestBuildMs,
      sourceBytes: screenshotPart.sourceBytes,
      imageBytesSent: screenshotPart.imageBytesSent,
      base64BytesSent: screenshotPart.base64BytesSent,
      mimeType: screenshotPart.part.inlineData.mimeType,
    });

    const abortController = new AbortController();
    let timer: NodeJS.Timeout | null = null;
    let didTimeout = false;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        didTimeout = true;
        abortController.abort();
        reject(new Error(`Gemini request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      request.config.abortSignal = abortController.signal;
      const requestStartedAt = Date.now();
      console.info('[Gemini] Sending request:', { model, attempt, maxAttempts, timeoutMs });
      const apiPromise = client.models.generateContent(request);

      const response = await Promise.race([apiPromise, timeoutPromise]);
      const requestDurationMs = Date.now() - requestStartedAt;

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

      aiResult.visualDesignScore = Math.round(aiResult.visualDesignScore * 10) / 10;

      console.info('[Gemini] Attempt succeeded:', {
        model, attempt, maxAttempts, timeoutMs, requestDurationMs, elapsedMs: Date.now() - startedAt, status: 200,
      });
      return aiResult;
    } catch (error: any) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      if (error instanceof ApiError) {
        console.error('[Gemini] Attempt failed:', {
          model, attempt, maxAttempts, timeoutMs, elapsedMs: Date.now() - startedAt,
          status: error.statusCode, message: this.sanitizedError(error),
        });
        throw error;
      }

      const isTimeout =
        didTimeout ||
        abortController.signal.aborted ||
        error?.name === 'AbortError' ||
        String(error?.message || '').toLowerCase().includes('timed out') ||
        String(error?.message || '').toLowerCase().includes('timeout');

      if (isTimeout) {
        console.error('[Gemini] Attempt timed out:', { model, attempt, maxAttempts, timeoutMs });
        const timeoutError: any = new ApiError(503, `Gemini request timed out after ${timeoutMs}ms`);
        timeoutError.transient = true;
        throw timeoutError;
      }

      const status = this.statusOf(error);
      const message = this.sanitizedError(error);
      console.error('[Gemini] Attempt failed:', {
        model, attempt, maxAttempts, timeoutMs, elapsedMs: Date.now() - startedAt,
        status: status || 'n/a', message,
      });
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
