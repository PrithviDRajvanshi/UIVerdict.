export interface ReportMetrics {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seoStructure: number;
  firstContentfulPaint?: string;
  largestContentfulPaint?: string;
  speedIndex?: string;
  totalBlockingTime?: string;
  cumulativeLayoutShift?: number;
  timeToInteractive?: string;
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
  url?: string;
  screenshot?: {
    filename: string;
    path: string;
  };
}

