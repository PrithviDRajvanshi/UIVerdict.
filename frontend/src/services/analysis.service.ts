import analysisMock from '../data/analysis.json';
import { AnalysisOverviewData } from '../types/analysis';

export async function fetchAnalysisOverview(): Promise<AnalysisOverviewData> {
  return analysisMock as AnalysisOverviewData;
}
