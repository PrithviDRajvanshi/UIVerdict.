import type { ScreenshotResult } from './playwright.service';
import type { LighthouseMetrics } from './lighthouse.service';
import { AiAnalysis } from '../validators/aiAnalysis.validator';
import { postgresRepository } from '../repositories/postgres/postgres.repository';
import { AnalysisStatus } from '@prisma/client';
import { sanitizeDiagnosticMessage, sanitizeDiagnosticUrl } from './browser-diagnostics';
import { TargetPageValidationError } from './target-page-validation';
import { PlaywrightDiagnosticMetadata } from './browser-diagnostics';
import { AnalysisConcurrencyQueue } from './analysis-concurrency';
import { ApiError } from '../errors/ApiError';
import fs from 'fs/promises';
import { isBrowserCleanupFailure } from './analysis-concurrency';

const processAnalysisQueue = new AnalysisConcurrencyQueue();
const DEFAULT_LIGHTHOUSE_MEMORY_ABORT_BYTES = 850_000_000;
export type AnalysisMode = 'visual' | 'tech';

type MemoryAnonReader = () => Promise<number | null>;

async function readCgroupAnonBytes(): Promise<number | null> {
  try {
    const stat = await fs.readFile('/sys/fs/cgroup/memory.stat', 'utf8');
    const line = stat.split(/\r?\n/).find((entry) => entry.startsWith('anon '));
    if (!line) return null;
    const value = Number(line.trim().split(/\s+/)[1]);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function lighthouseMemoryThresholdBytes(): number {
  const raw = process.env.LIGHTHOUSE_MEMORY_ABORT_BYTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_LIGHTHOUSE_MEMORY_ABORT_BYTES;
  const configured = Number(raw);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_LIGHTHOUSE_MEMORY_ABORT_BYTES;
}

function unavailableLighthouseMetrics(): LighthouseMetrics {
  return {
    performance: null,
    accessibility: null,
    bestPractices: null,
    seo: null,
    firstContentfulPaint: null,
    largestContentfulPaint: null,
    speedIndex: null,
    totalBlockingTime: null,
    cumulativeLayoutShift: null,
    timeToInteractive: null,
  };
}

export interface AnalysisData {
  id: string;
  url: string;
  mode: AnalysisMode;
  metrics: LighthouseMetrics;
  aiAnalysis: AiAnalysis | null;
  aiStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_REQUESTED';
  overallScore: number | null;
  verdictLabel: string | null;
  visualDesignScore: number | null;
  targetValidationStatus: 'VALID' | 'BLOCKED' | 'INCONCLUSIVE';
  partial: boolean;
  technicalUnavailable: boolean;
  technicalUnavailableReason: string | null;
}

export interface AnalysisResponse {
  status: string;
  message: string;
  data: AnalysisData;
  [key: string]: unknown;
}

export class AnalysisService {
  constructor(private readonly memoryMonitor: {
    readAnonBytes?: MemoryAnonReader;
    pollIntervalMs?: number;
    onStop?: () => void;
  } = {}) {}

  public async analyzeUrl(url: string, userId?: string, signal?: AbortSignal, mode: AnalysisMode = 'visual'): Promise<AnalysisResponse> {
    let analysisId: string | null = null;
    let pipelineStarted = false;
    try {
      processAnalysisQueue.assertAvailable();
      if (signal?.aborted) throw new ApiError(503, 'Analysis request was cancelled before processing');
      const { analysis } = await postgresRepository.createAnalysisTransaction(url, 'Default Project', userId);
      analysisId = analysis.id;
      console.log(`[AnalysisService] Analysis initiated in PostgreSQL: ${analysis.id} (Status: ${analysis.status})`);
      return await processAnalysisQueue.run(() => {
        pipelineStarted = true;
        return this.runAnalysisPipeline(url, analysis, mode, signal);
      }, { analysisId, url }, signal);
    } catch (error) {
      if (analysisId && !pipelineStarted) {
        try {
          await postgresRepository.updateAnalysisStatus(analysisId, AnalysisStatus.FAILED);
          console.log(`[AnalysisService] Marked PostgreSQL analysis ${analysisId} as FAILED before pipeline start`);
        } catch (statusError: any) {
          console.error('[AnalysisService] Failed to mark queued analysis as FAILED:', sanitizeDiagnosticMessage(statusError?.message || statusError));
        }
      }
      throw error;
    }
  }

  private async runAnalysisPipeline(url: string, analysis: { id: string; status: AnalysisStatus }, mode: AnalysisMode, signal?: AbortSignal): Promise<AnalysisResponse> {
    const analysisId = analysis.id;
    let screenshotData: ScreenshotResult | null = null;
    const latestPlaywrightDiagnostics: { current: PlaywrightDiagnosticMetadata | null } = { current: null };
    let metrics: LighthouseMetrics;
    let aiAnalysis: AiAnalysis | null = null;
    let technicalUnavailable = false;
    let technicalUnavailableReason: string | null = null;

    try {
      if (mode === 'visual') {
      const { playwrightService } = await import('./playwright.service');
      const { geminiService } = await import('./gemini.service');
      try {
        // Playwright resolves only after its browser cleanup completes.
        if (signal?.aborted) throw new Error('Analysis request was cancelled');
        screenshotData = await playwrightService.captureScreenshot(url, analysisId, (diagnostics) =>
          (latestPlaywrightDiagnostics.current = diagnostics, postgresRepository.updatePlaywrightDiagnostics(analysis.id, diagnostics).then(() => undefined)));
        await postgresRepository.updateScreenshotIdentity(analysis.id, screenshotData.filename, screenshotData.sha256);
        console.log(`[AnalysisService] Screenshot capture completed: ${screenshotData.filename} (${screenshotData.path})`);

        if (signal?.aborted) throw new Error('Analysis request was cancelled');

        // Gemini receives visual evidence only. Keep the screenshot until the request and fallback finish.
        try {
          aiAnalysis = await geminiService.generateAnalysis({ url, screenshot: screenshotData });
          console.log(`[AnalysisService] Gemini AI visual assessment completed for URL: ${sanitizeDiagnosticUrl(url)} (Visual design score: ${aiAnalysis.visualDesignScore})`);
        } catch (aiError: any) {
          console.warn(`[AnalysisService] AI feedback unavailable: ${sanitizeDiagnosticMessage(aiError?.message || 'unknown error')}`);
          throw new ApiError(503, 'Temporarily unavailable, try again');
        }
      } finally {
        if (screenshotData) {
          try {
            await playwrightService.removeScreenshot(screenshotData, true);
          } catch (cleanupError: any) {
            try {
              console.error('[AnalysisService] Failed to remove temporary screenshot:', sanitizeDiagnosticMessage(cleanupError?.message || cleanupError));
            } catch {
              // Cleanup and its diagnostics must not replace the analysis result or error.
            }
          }
        }
      }
      }
      if (mode === 'visual') {
        metrics = unavailableLighthouseMetrics();
      } else {
      const { LIGHTHOUSE_MEMORY_SAFE_CATEGORIES, lighthouseService } = await import('./lighthouse.service');
      if (signal?.aborted) throw new Error('Analysis request was cancelled');

      // Lighthouse owns the monitor and creates a fresh controller/poller per Chrome attempt.
      let memoryAbortReason: string | null = null;
      try {
        metrics = await lighthouseService.runAudit(url, (diagnostics) =>
          postgresRepository.updateLighthouseDiagnostics(analysis.id, diagnostics).then(() => undefined), signal, undefined,
          LIGHTHOUSE_MEMORY_SAFE_CATEGORIES, {
            readAnonBytes: this.memoryMonitor.readAnonBytes ?? readCgroupAnonBytes,
            thresholdBytes: lighthouseMemoryThresholdBytes(),
            pollIntervalMs: this.memoryMonitor.pollIntervalMs,
            onAbort: (anonBytes, thresholdBytes) => {
              memoryAbortReason = 'memory limit';
              try {
                console.warn('[AnalysisService] Lighthouse memory limit reached; aborting Chrome audit:', {
                  analysisId,
                  anonBytes,
                  thresholdBytes,
                });
              } catch {
                // Logging must not prevent the memory abort.
              }
            },
            onStop: this.memoryMonitor.onStop,
          });
        console.log(`[AnalysisService] Lighthouse audit completed for URL: ${sanitizeDiagnosticUrl(url)} (Performance: ${metrics.performance}, Accessibility: ${metrics.accessibility})`);
      } catch (lighthouseError: any) {
        if (isBrowserCleanupFailure(lighthouseError) || signal?.aborted) throw lighthouseError;
        technicalUnavailable = true;
        metrics = unavailableLighthouseMetrics();
        technicalUnavailableReason = memoryAbortReason ?? sanitizeDiagnosticMessage(lighthouseError?.message || 'Lighthouse audit unavailable').slice(0, 160);
        console.warn('[AnalysisService] Lighthouse returned no usable technical results:', {
          analysisId,
          reason: technicalUnavailableReason,
        });
      }
      if (memoryAbortReason) {
        technicalUnavailable = true;
        technicalUnavailableReason = memoryAbortReason;
      }
      }
      if (signal?.aborted) throw new Error('Analysis request was cancelled');
      const hasTechnicalResult = [metrics.performance, metrics.accessibility, metrics.bestPractices, metrics.seo,
        metrics.firstContentfulPaint, metrics.largestContentfulPaint, metrics.speedIndex,
        metrics.totalBlockingTime, metrics.cumulativeLayoutShift, metrics.timeToInteractive]
        .some((value) => value !== null && value !== '' && !(typeof value === 'string' && value.toLowerCase() === 'n/a'));
      const modeHasResult = mode === 'visual' ? aiAnalysis !== null : hasTechnicalResult;
      if (!modeHasResult) {
        throw new ApiError(503, 'Temporarily unavailable, try again');
      }

      // 5. Save complete analysis result to PostgreSQL and mark status COMPLETED
      console.log(`[AnalysisService] Persisting complete analysis result to PostgreSQL for analysisId: ${analysis.id}`);
      await postgresRepository.saveAnalysisResult(analysis.id, {
        metrics,
        ...(aiAnalysis ? { aiAnalysis } : {}),
        overallScore: null,
        status: AnalysisStatus.COMPLETED,
        ...(screenshotData ? { screenshotArtifactName: screenshotData.filename, screenshotSha256: screenshotData.sha256 } : {}),
      });
      const overallScore = null;
      const partial = mode === 'tech' && (technicalUnavailable || [metrics.accessibility, metrics.bestPractices, metrics.seo].some((score) => score === null));
      console.log(`[AnalysisService] PostgreSQL persistence complete. Analysis status marked as COMPLETED.`);

      // 6. Final response construction and return
      return {
        status: 'success',
        message: mode === 'visual'
          ? 'Visual analysis completed successfully'
          : technicalUnavailable ? 'Technical analysis completed with partial results' : 'Technical analysis completed successfully',
        data: {
          id: analysis.id,
          url,
          mode,
          metrics,
          aiAnalysis,
          aiStatus: mode === 'tech' ? 'NOT_REQUESTED' : aiAnalysis ? 'AVAILABLE' : 'UNAVAILABLE',
          overallScore,
          verdictLabel: null,
          visualDesignScore: aiAnalysis?.visualDesignScore ?? null,
          targetValidationStatus: 'VALID',
          partial,
          technicalUnavailable,
          technicalUnavailableReason,
        },
      };
    } catch (error: any) {
      console.error('Analysis pipeline error:', sanitizeDiagnosticMessage(error?.message || error));
      if (error instanceof TargetPageValidationError && analysisId) {
        const status = error.validation.status === 'BLOCKED' ? AnalysisStatus.BLOCKED : AnalysisStatus.INCONCLUSIVE;
        if (latestPlaywrightDiagnostics.current) {
          await postgresRepository.updatePlaywrightDiagnostics(analysisId, {
            ...latestPlaywrightDiagnostics.current,
            outcome: error.validation.status,
            validationReasonCode: error.validation.reasonCode,
            validationReason: error.validation.reason,
          });
        }
        await postgresRepository.updateAnalysisStatus(analysisId, status);
        return {
          status: error.validation.status.toLowerCase(),
          message: error.validation.reason ?? 'The target page could not be evaluated.',
          data: {
            id: analysisId,
            url,
            mode,
            metrics: { performance: null, accessibility: null, bestPractices: null, seo: null, firstContentfulPaint: '', largestContentfulPaint: '', speedIndex: '', totalBlockingTime: '', cumulativeLayoutShift: '', timeToInteractive: '' },
            aiAnalysis: null,
            aiStatus: mode === 'tech' ? 'NOT_REQUESTED' : 'UNAVAILABLE',
            overallScore: null,
            verdictLabel: null,
            visualDesignScore: null,
            targetValidationStatus: error.validation.status,
            partial: false,
            technicalUnavailable: false,
            technicalUnavailableReason: null,
          },
        };
      }
      if (analysisId) {
        try {
          await postgresRepository.updateAnalysisStatus(analysisId, AnalysisStatus.FAILED);
          console.log(`[AnalysisService] Marked PostgreSQL analysis ${analysisId} as FAILED`);
        } catch (statusErr) {
          console.error('Failed to mark analysis status as FAILED:', sanitizeDiagnosticMessage((statusErr as any)?.message || statusErr));
        }
      }
      throw error;
    }
  }
}

export const analysisService = new AnalysisService();
