import { playwrightService, ScreenshotResult } from './playwright.service';
import { lighthouseService, LighthouseMetrics } from './lighthouse.service';
import { geminiService } from './gemini.service';
import { AiAnalysis } from '../validators/aiAnalysis.validator';
import { postgresRepository } from '../repositories/postgres/postgres.repository';
import { AnalysisStatus } from '@prisma/client';
import { sanitizeDiagnosticMessage, sanitizeDiagnosticUrl } from './browser-diagnostics';

export interface AnalysisData {
  id: string;
  url: string;
  metrics: LighthouseMetrics;
  aiAnalysis: AiAnalysis | null;
  aiStatus: 'AVAILABLE' | 'UNAVAILABLE';
}

export interface AnalysisResponse {
  status: string;
  message: string;
  data: AnalysisData;
}

export class AnalysisService {
  public async analyzeUrl(url: string, userId?: string): Promise<AnalysisResponse> {
    let analysisId: string | null = null;
    let screenshotData: ScreenshotResult | null = null;

    try {
      // 1. Create relational analysis record in PostgreSQL (status: PROCESSING)
      const { analysis } = await postgresRepository.createAnalysisTransaction(url, 'Default Project', userId);
      analysisId = analysis.id;
      console.log(`[AnalysisService] Analysis initiated in PostgreSQL: ${analysis.id} (Status: ${analysis.status})`);

      // 2. Capture Playwright full page screenshot
      screenshotData = await playwrightService.captureScreenshot(url, analysisId, (diagnostics) =>
        postgresRepository.updatePlaywrightDiagnostics(analysis.id, diagnostics).then(() => undefined));
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
        console.log(`[AnalysisService] Gemini AI analysis completed for URL: ${sanitizeDiagnosticUrl(url)} (Score: ${aiAnalysis.overallVerdict.score})`);
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
        },
      };
    } catch (error: any) {
      console.error('Analysis pipeline error:', sanitizeDiagnosticMessage(error?.message || error));
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
