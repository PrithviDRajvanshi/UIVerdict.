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
  public async analyzeUrl(url: string, userId?: string): Promise<AnalysisResponse> {
    let analysisId: string | null = null;

    try {
      // 1. Create relational metadata in PostgreSQL inside a Prisma transaction (status: PROCESSING)
      const { analysis } = await postgresRepository.createAnalysisTransaction(url, 'Default Project', userId);
      analysisId = analysis.id;

      // 2. Capture Playwright full page screenshot
      const screenshotData: ScreenshotResult = await playwrightService.captureScreenshot(url);

      // 3. Run Lighthouse performance, accessibility, best-practices, and SEO audit
      const metrics: LighthouseMetrics = await lighthouseService.runAudit(url);

      // 4. Generate holistic Gemini AI UI/UX evaluation (independent score + qualitative critique)
      const aiAnalysis: AiAnalysis = await geminiService.generateAnalysis({
        url,
        metrics,
        screenshot: screenshotData,
      });

      // 6. Persist full analysis snapshot document in MongoDB
      const mongoSnapshot = await mongoRepository.saveSnapshot({
        analysisId: analysis.id,
        url,
        screenshot: screenshotData,
        metrics,
        aiAnalysis,
      });

      // 7. Update PostgreSQL Analysis status to COMPLETED with mongoDocumentId reference
      await postgresRepository.updateAnalysisStatus(
        analysis.id,
        AnalysisStatus.COMPLETED,
        mongoSnapshot._id.toString()
      );

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
    } catch (error: any) {
      console.error('❌ Analysis pipeline error:', error?.message || error);
      if (analysisId) {
        try {
          await postgresRepository.updateAnalysisStatus(analysisId, AnalysisStatus.FAILED);
        } catch (statusErr) {
          console.error('Failed to mark analysis status as FAILED:', statusErr);
        }
      }
      throw error;
    }
  }
}

export const analysisService = new AnalysisService();


