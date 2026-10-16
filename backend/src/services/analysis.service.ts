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
}

export interface AnalysisResponse {
  status: string;
  message: string;
  data: AnalysisData;
  [key: string]: unknown;
}

export class AnalysisService {
  public async analyzeUrl(url: string, userId?: string): Promise<AnalysisResponse> {
    let analysisId: string | null = null;
    let screenshotData: ScreenshotResult | null = null;
    const latestPlaywrightDiagnostics: { current: PlaywrightDiagnosticMetadata | null } = { current: null };

    try {
      // 1. Create relational analysis record in PostgreSQL (status: PROCESSING)
      const { analysis } = await postgresRepository.createAnalysisTransaction(url, 'Default Project', userId);
      analysisId = analysis.id;
      console.log(`[AnalysisService] Analysis initiated in PostgreSQL: ${analysis.id} (Status: ${analysis.status})`);

      // 2. Capture Playwright full page screenshot
      screenshotData = await playwrightService.captureScreenshot(url, analysisId, (diagnostics) =>
        (latestPlaywrightDiagnostics.current = diagnostics, postgresRepository.updatePlaywrightDiagnostics(analysis.id, diagnostics).then(() => undefined)));
      await postgresRepository.updateScreenshotIdentity(analysis.id, screenshotData.filename, screenshotData.sha256);
      console.log(`[AnalysisService] Screenshot capture completed: ${screenshotData.filename} (${screenshotData.path})`);

      // 3. Run Lighthouse performance, accessibility, best-practices, and SEO audit
      const metrics: LighthouseMetrics = await lighthouseService.runAudit(url, (diagnostics) =>
        postgresRepository.updateLighthouseDiagnostics(analysis.id, diagnostics).then(() => undefined));
      console.log(`[AnalysisService] Lighthouse audit completed for URL: ${sanitizeDiagnosticUrl(url)} (Performance: ${metrics.performance}, Accessibility: ${metrics.accessibility})`);

      // 4. Generate holistic Gemini AI UI/UX evaluation (independent score + qualitative critique)
      let aiAnalysis: AiAnalysis | null = null;
      try {
        aiAnalysis = await geminiService.generateAnalysis({ url, metrics, screenshot: screenshotData });
        console.log(`[AnalysisService] Gemini AI visual assessment completed for URL: ${sanitizeDiagnosticUrl(url)} (Visual design score: ${aiAnalysis.visualDesignScore})`);
      } catch (aiError: any) {
        console.warn(`[AnalysisService] AI feedback unavailable; preserving Lighthouse report: ${sanitizeDiagnosticMessage(aiError?.message || 'unknown error')}`);
      }

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
        message: aiAnalysis ? 'Analysis completed successfully' : 'Lighthouse analysis completed; AI feedback is unavailable',
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
    } finally {
      if (screenshotData) {
        try {
          await playwrightService.removeScreenshot(screenshotData);
        } catch (cleanupError: any) {
          console.error('[AnalysisService] Failed to remove temporary screenshot:', sanitizeDiagnosticMessage(cleanupError?.message || cleanupError));
        }
      }
    }
  }
}

export const analysisService = new AnalysisService();
