export interface ReportMetrics {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seoStructure: number | null;
  firstContentfulPaint?: string;
  largestContentfulPaint?: string;
  speedIndex?: string;
  totalBlockingTime?: string;
  cumulativeLayoutShift?: number | null;
  timeToInteractive?: string;
}

export interface ReportData {
  evaluationId: string;
  algorithm: string;
  timestamp: string;
  latency: string;
  overallScore: number | null;
  verdictStatus: string;
  aiStatus: 'AVAILABLE' | 'UNAVAILABLE';
  metrics: ReportMetrics;
  qualitativeCritique: string[];
  strengths: string[];
  refinements: string[];
  url?: string;
}

