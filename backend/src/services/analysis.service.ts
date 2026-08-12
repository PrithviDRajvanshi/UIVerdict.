import { playwrightService, ScreenshotResult } from './playwright.service';
import { lighthouseService, LighthouseMetrics } from './lighthouse.service';

export interface AnalysisData {
  url: string;
  screenshot: {
    filename: string;
    path: string;
  };
  metrics: LighthouseMetrics;
}

export interface AnalysisResponse {
  status: string;
  message: string;
  data: AnalysisData;
}

export class AnalysisService {
  public async analyzeUrl(url: string): Promise<AnalysisResponse> {
    // 1. Capture Playwright full page screenshot
    const screenshotData: ScreenshotResult = await playwrightService.captureScreenshot(url);

    // 2. Run Lighthouse performance, accessibility, best-practices, and SEO audit
    const metrics: LighthouseMetrics = await lighthouseService.runAudit(url);

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
      },
    };
  }
}

export const analysisService = new AnalysisService();
