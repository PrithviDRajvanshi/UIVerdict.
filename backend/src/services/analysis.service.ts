import { playwrightService, ScreenshotResult } from './playwright.service';
import { lighthouseService, LighthouseMetrics } from './lighthouse.service';
import { geminiService } from './gemini.service';
import { AiAnalysis } from '../validators/aiAnalysis.validator';
import { postgresRepository } from '../repositories/postgres/postgres.repository';
import { mongoRepository } from '../repositories/mongo/mongo.repository';
import { AnalysisStatus } from '@prisma/client';

export interface AnalysisData {
  url: string;
  screenshot: {
    filename: string;
    path: string;
  };
  metrics: LighthouseMetrics;
  aiAnalysis: AiAnalysis;
}

export interface AnalysisResponse {
  status: string;
  message: string;
  data: AnalysisData;
}

export class AnalysisService {
  public calculateGlobalScore(metrics: LighthouseMetrics): number {
    const score =
      metrics.performance * 0.30 +
      metrics.accessibility * 0.25 +
      metrics.bestPractices * 0.20 +
      metrics.seo * 0.25;
    return Math.round(score * 10) / 10;
  }

  public async analyzeUrl(url: string): Promise<AnalysisResponse> {
    // 1. Capture Playwright full page screenshot
    const screenshotData: ScreenshotResult = await playwrightService.captureScreenshot(url);

    // 2. Run Lighthouse performance, accessibility, best-practices, and SEO audit
    const metrics: LighthouseMetrics = await lighthouseService.runAudit(url);

    // 3. Calculate deterministic global score
    const globalScore = this.calculateGlobalScore(metrics);

    // 4. Generate Gemini AI qualitative analysis based on real metrics & evidence
    const aiAnalysis: AiAnalysis = await geminiService.generateAnalysis({
      url,
      metrics,
      screenshot: screenshotData,
      globalScore,
    });

    // 5. Orchestrate Dual Database Persistence (PostgreSQL + MongoDB)
    let analysisId: string | null = null;
    try {
      // 5a. Create relational metadata in PostgreSQL inside a Prisma transaction
      const { analysis } = await postgresRepository.createAnalysisTransaction(url);
      analysisId = analysis.id;

      // 5b. Persist full analysis snapshot document in MongoDB
      const mongoSnapshot = await mongoRepository.saveSnapshot({
        analysisId: analysis.id,
        url,
        screenshot: screenshotData,
        metrics,
        aiAnalysis,
      });

      // 5c. Update PostgreSQL Analysis status to COMPLETED with mongoDocumentId reference
      await postgresRepository.updateAnalysisStatus(
        analysis.id,
        AnalysisStatus.COMPLETED,
        mongoSnapshot._id.toString()
      );
    } catch (dbError: any) {
      console.error('⚠️ Database persistence warning/error:', dbError?.message || dbError);
      if (analysisId) {
        try {
          await postgresRepository.updateAnalysisStatus(analysisId, AnalysisStatus.FAILED);
        } catch (statusErr) {
          console.error('Failed to mark analysis status as FAILED:', statusErr);
        }
      }
    }

    return {
      status: 'success',
      message: 'Analysis completed successfully',
      data: {
        url,
        screenshot: {
          filename: screenshotData.filename,
          path: screenshotData.path,
        },
        metrics,
        aiAnalysis,
      },
    };
  }
}

export const analysisService = new AnalysisService();


