export interface AnalysisResponse {
  status: string;
  message: string;
}

export class AnalysisService {
  public async analyzeUrl(_url: string): Promise<AnalysisResponse> {
    return {
      status: 'success',
      message: 'Analysis endpoint ready.',
    };
  }
}

export const analysisService = new AnalysisService();
