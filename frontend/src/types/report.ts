export interface ReportMetrics {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seoStructure: number;
}

export interface ReportData {
  evaluationId: string;
  algorithm: string;
  timestamp: string;
  latency: string;
  overallScore: number;
  verdictStatus: string;
  metrics: ReportMetrics;
  qualitativeCritique: string[];
  strengths: string[];
  refinements: string[];
}
