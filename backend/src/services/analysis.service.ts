import { playwrightService, ScreenshotResult } from './playwright.service';

export interface AnalysisResponse {
  status: string;
  message: string;
  data: ScreenshotResult;
}

export class AnalysisService {
  public async analyzeUrl(url: string): Promise<AnalysisResponse> {
    const screenshotData = await playwrightService.captureScreenshot(url);

    return {
      status: 'success',
      message: 'Screenshot captured successfully',
      data: screenshotData,
    };
  }
}

export const analysisService = new AnalysisService();
