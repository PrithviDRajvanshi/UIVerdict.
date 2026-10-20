import { ReportData } from '../types/report';
import { API_URL } from '../config/api.config';

interface SavedReportResponse {
  status: string;
  data: {
    id: string;
    url: string;
    createdAt: string;
    mode?: ReportData['mode'];
    aiStatus: ReportData['aiStatus'];
    status: ReportData['status'];
    visualDesignScore: number | null;
    validationReason: string | null;
    overallScore: number | null;
    verdictLabel: string | null;
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
      visualDesignScore: number | null;
      overallVerdict: { score: number; label: string } | null;
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
  const hasVisualScore = saved.visualDesignScore !== null;
  const hasTechnicalScores = [saved.metrics.performance, saved.metrics.accessibility, saved.metrics.bestPractices, saved.metrics.seo]
    .some((score) => score !== null) || [saved.metrics.firstContentfulPaint, saved.metrics.largestContentfulPaint,
      saved.metrics.speedIndex, saved.metrics.totalBlockingTime, saved.metrics.cumulativeLayoutShift,
      saved.metrics.timeToInteractive].some((metric) => metric !== null && metric !== '' && metric.toLowerCase() !== 'n/a');
  const inferredMode: ReportData['mode'] = saved.mode ?? (
    hasVisualScore && hasTechnicalScores ? 'overall'
      : hasVisualScore ? 'visual'
      : hasTechnicalScores ? 'tech'
      : saved.overallScore !== null ? 'overall' : 'unknown'
  );

  return {
    evaluationId: saved.id,
    algorithm: 'UIVERDICT // COMPLETED ANALYSIS',
    timestamp: new Date(saved.createdAt).toISOString(),
    latency: '—',
    overallScore: saved.overallScore,
    mode: inferredMode,
    verdictStatus: saved.verdictLabel ?? 'OVERALL UNAVAILABLE',
    aiStatus: saved.aiStatus,
    status: saved.status,
    visualDesignScore: saved.visualDesignScore,
    validationReason: saved.validationReason,
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
