import { ReportData } from '../types/report';
import { API_URL } from '../config/api.config';

interface SavedReportResponse {
  status: string;
  data: {
    id: string;
    url: string;
    createdAt: string;
    aiStatus: 'AVAILABLE' | 'UNAVAILABLE';
    metrics: {
      performance: number | null;
      accessibility: number | null;
      bestPractices: number | null;
      seo: number | null;
      firstContentfulPaint: string;
      largestContentfulPaint: string;
      speedIndex: string;
      totalBlockingTime: string;
      cumulativeLayoutShift: string;
      timeToInteractive: string;
    };
    aiAnalysis: {
      overallVerdict: { score: number; label: string };
      qualitativeCritique: string[];
      strengths: string[];
      areasForRefinement: string[];
    } | null;
  };
}

export async function fetchReportById(id: string): Promise<ReportData> {
  const response = await fetch(`${API_URL}/api/v1/reports/${encodeURIComponent(id)}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) throw new Error(response.status === 404 ? 'Report not found or access denied.' : 'Failed to retrieve report.');

  const result: SavedReportResponse = await response.json();
  const saved = result.data;
  const cls = Number.parseFloat(saved.metrics.cumulativeLayoutShift);

  return {
    evaluationId: saved.id,
    algorithm: 'UIVERDICT // COMPLETED ANALYSIS',
    timestamp: new Date(saved.createdAt).toISOString(),
    latency: '—',
    overallScore: saved.aiAnalysis?.overallVerdict.score ?? null,
    verdictStatus: saved.aiAnalysis?.overallVerdict.label ?? 'AI UNAVAILABLE',
    aiStatus: saved.aiStatus,
    metrics: {
      performance: saved.metrics.performance,
      accessibility: saved.metrics.accessibility,
      bestPractices: saved.metrics.bestPractices,
      seoStructure: saved.metrics.seo,
      firstContentfulPaint: saved.metrics.firstContentfulPaint,
      largestContentfulPaint: saved.metrics.largestContentfulPaint,
      speedIndex: saved.metrics.speedIndex,
      totalBlockingTime: saved.metrics.totalBlockingTime,
      cumulativeLayoutShift: Number.isFinite(cls) ? cls : null,
      timeToInteractive: saved.metrics.timeToInteractive,
    },
    qualitativeCritique: saved.aiAnalysis?.qualitativeCritique ?? [],
    strengths: saved.aiAnalysis?.strengths ?? [],
    refinements: saved.aiAnalysis?.areasForRefinement ?? [],
    url: saved.url,
  };
}
