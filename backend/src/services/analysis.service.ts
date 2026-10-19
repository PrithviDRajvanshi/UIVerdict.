import { playwrightService, ScreenshotResult } from './playwright.service';
import { lighthouseService, LighthouseMetrics } from './lighthouse.service';
import { geminiService } from './gemini.service';
import { AiAnalysis } from '../validators/aiAnalysis.validator';
import { postgresRepository } from '../repositories/postgres/postgres.repository';
import { AnalysisStatus } from '@prisma/client';
import { sanitizeDiagnosticMessage, sanitizeDiagnosticUrl } from './browser-diagnostics';
import { TargetPageValidationError } from './target-page-validation';
import { calculateOverallScore } from './scoring.service';
import { resolveVerdictLabel } from '../validators/aiAnalysis.validator';
import { PlaywrightDiagnosticMetadata } from './browser-diagnostics';
import { AnalysisConcurrencyQueue } from './analysis-concurrency';
import { ApiError } from '../errors/ApiError';
import fs from 'fs/promises';
import { isBrowserCleanupFailure } from './analysis-concurrency';

const processAnalysisQueue = new AnalysisConcurrencyQueue();
const DEFAULT_LIGHTHOUSE_MEMORY_ABORT_BYTES = 850_000_000;

type MemoryAnonReader = () => Promise<number | null>;

async function readCgroupAnonBytes(): Promise<number | null> {
  try {
    const stat = await fs.readFile('/sys/fs/cgroup/memory.stat', 'utf8');
    const anonLine = stat.split(/\r?\n/).find((line) => line.startsWith('anon '));
    if (!anonLine) return null;
    const bytes = Number(anonLine.trim().split(/\s+/)[1]);
    return Number.isFinite(bytes) ? bytes : null;
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
  metrics: LighthouseMetrics;
  aiAnalysis: AiAnalysis | null;
  aiStatus: 'AVAILABLE' | 'UNAVAILABLE';
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

  public async analyzeUrl(url: string, userId?: string, signal?: AbortSignal): Promise<AnalysisResponse> {
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
        return this.runAnalysisPipeline(url, analysis, signal);
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

  private async runAnalysisPipeline(url: string, analysis: { id: string; status: AnalysisStatus }, signal?: AbortSignal): Promise<AnalysisResponse> {
    const analysisId = analysis.id;
    let screenshotData: ScreenshotResult | null = null;
    const latestPlaywrightDiagnostics: { current: PlaywrightDiagnosticMetadata | null } = { current: null };
    let metrics: LighthouseMetrics;
    let aiAnalysis: AiAnalysis | null = null;
    let technicalUnavailable = false;
    let technicalUnavailableReason: string | null = null;

    try {
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
      if (signal?.aborted) throw new Error('Analysis request was cancelled');

      // Lighthouse owns its Chrome process. The monitor aborts through LighthouseService,
      // which kills and waits for the process tree before this stage can resolve.
      const auditController = new AbortController();
      let pollerStopped = false;
      let pollTimer: NodeJS.Timeout | undefined;
      let wakePoller: (() => void) | undefined;
      let memoryAbortReason: string | null = null;
      const thresholdBytes = lighthouseMemoryThresholdBytes();
      const externalAbort = () => auditController.abort(signal?.reason ?? 'request cancelled');
      if (signal?.aborted) externalAbort();
      else signal?.addEventListener('abort', externalAbort, { once: true });
      const pollIntervalMs = this.memoryMonitor.pollIntervalMs ?? 1000;
      const poller = (async () => {
        while (!pollerStopped) {
          await new Promise<void>((resolve) => {
            let settled = false;
            const wake = () => {
              if (settled) return;
              settled = true;
              wakePoller = undefined;
              resolve();
            };
            wakePoller = wake;
            pollTimer = setTimeout(wake, pollIntervalMs);
          });
          if (pollerStopped) return;
          let anonBytes: number | null = null;
          try {
            anonBytes = await (this.memoryMonitor.readAnonBytes ?? readCgroupAnonBytes)();
          } catch {
            // Memory monitoring is best-effort; unreadable cgroup data is skipped silently.
          }
          if (pollerStopped) return;
          if (anonBytes !== null && anonBytes > thresholdBytes) {
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
            auditController.abort(memoryAbortReason);
            return;
          }
        }
      })();
      try {
        metrics = await lighthouseService.runAudit(url, (diagnostics) =>
          postgresRepository.updateLighthouseDiagnostics(analysis.id, diagnostics).then(() => undefined), auditController.signal);
        console.log(`[AnalysisService] Lighthouse audit completed for URL: ${sanitizeDiagnosticUrl(url)} (Performance: ${metrics.performance}, Accessibility: ${metrics.accessibility})`);
      } catch (lighthouseError: any) {
        if (isBrowserCleanupFailure(lighthouseError) || signal?.aborted) throw lighthouseError;
        technicalUnavailable = true;
        metrics = unavailableLighthouseMetrics();
        technicalUnavailableReason = memoryAbortReason ?? sanitizeDiagnosticMessage(lighthouseError?.message || 'Lighthouse audit unavailable').slice(0, 160);
        console.warn('[AnalysisService] Continuing with a partial visual report because Lighthouse is unavailable:', {
          analysisId,
          reason: technicalUnavailableReason,
        });
      } finally {
        pollerStopped = true;
        if (pollTimer) clearTimeout(pollTimer);
        wakePoller?.();
        signal?.removeEventListener('abort', externalAbort);
        await poller;
        try {
          this.memoryMonitor.onStop?.();
        } catch {
          // The monitor hook must not mask the Lighthouse result or failure.
        }
      }
      if (memoryAbortReason) {
        technicalUnavailable = true;
        metrics = unavailableLighthouseMetrics();
        technicalUnavailableReason = memoryAbortReason;
      }
      if (signal?.aborted) throw new Error('Analysis request was cancelled');

      // 5. Save complete analysis result to PostgreSQL and mark status COMPLETED
      console.log(`[AnalysisService] Persisting complete analysis result to PostgreSQL for analysisId: ${analysis.id}`);
      await postgresRepository.saveAnalysisResult(analysis.id, {
        metrics,
        ...(aiAnalysis ? { aiAnalysis } : {}),
        status: AnalysisStatus.COMPLETED,
        screenshotArtifactName: screenshotData.filename,
        screenshotSha256: screenshotData.sha256,
      });
      const overallScore = aiAnalysis ? calculateOverallScore(aiAnalysis.visualDesignScore, metrics) : null;
      console.log(`[AnalysisService] PostgreSQL persistence complete. Analysis status marked as COMPLETED.`);

      // 6. Final response construction and return
      return {
        status: 'success',
        message: technicalUnavailable
          ? 'Analysis completed with partial technical results'
          : aiAnalysis ? 'Analysis completed successfully' : 'Lighthouse analysis completed; AI feedback is unavailable',
        data: {
          id: analysis.id,
          url,
          metrics,
          aiAnalysis,
          aiStatus: aiAnalysis ? 'AVAILABLE' : 'UNAVAILABLE',
          overallScore,
          verdictLabel: overallScore === null ? null : resolveVerdictLabel(overallScore),
          visualDesignScore: aiAnalysis?.visualDesignScore ?? null,
          targetValidationStatus: 'VALID',
          partial: technicalUnavailable,
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
            metrics: { performance: null, accessibility: null, bestPractices: null, seo: null, firstContentfulPaint: '', largestContentfulPaint: '', speedIndex: '', totalBlockingTime: '', cumulativeLayoutShift: '', timeToInteractive: '' },
            aiAnalysis: null,
            aiStatus: 'UNAVAILABLE',
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
