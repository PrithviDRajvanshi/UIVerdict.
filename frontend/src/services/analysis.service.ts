import analysisMock from '../data/analysis.json';
import { AnalysisOverviewData } from '../types/analysis';
import { ReportData } from '../types/report';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface BackendScreenshot {
  filename: string;
  path: string;
}

export interface BackendMetrics {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
  firstContentfulPaint: string;
  largestContentfulPaint: string;
  speedIndex: string;
  totalBlockingTime: string;
  cumulativeLayoutShift: number;
  timeToInteractive: string;
}

export interface BackendAiAnalysis {
  overallVerdict: {
    score: number;
    label: string;
  };
  qualitativeCritique: string[];
  strengths: string[];
  areasForRefinement: string[];
}

export interface BackendAnalysisData {
  url: string;
  screenshot: BackendScreenshot;
  metrics: BackendMetrics;
  aiAnalysis: BackendAiAnalysis;
}

export interface BackendAnalysisResponse {
  status: string;
  message: string;
  data: BackendAnalysisData;
}

export async function fetchAnalysisOverview(): Promise<AnalysisOverviewData> {
  return analysisMock as AnalysisOverviewData;
}

export async function analyzeWebsite(url: string, signal?: AbortSignal): Promise<BackendAnalysisData> {
  let formattedUrl = url.trim();
  if (!formattedUrl) {
    throw new Error('Please enter a valid website URL.');
  }

  if (!/^https?:\/\//i.test(formattedUrl)) {
    formattedUrl = `https://${formattedUrl}`;
  }

  try {
    new URL(formattedUrl);
  } catch {
    throw new Error('Please enter a valid website URL.');
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: formattedUrl }),
      signal,
    });
  } catch (netErr: any) {
    if (netErr?.name === 'AbortError') {
      throw netErr;
    }
    throw new Error('Unable to connect to the UIVerdict server.');
  }

  if (!response.ok) {
    let errorJson: any = null;
    try {
      errorJson = await response.json();
    } catch {
      // Ignore parse error
    }

    if (response.status === 400) {
      const msg =
        errorJson?.message ||
        (Array.isArray(errorJson?.errors) && errorJson.errors[0]?.message) ||
        'Please enter a valid website URL.';
      throw new Error(msg);
    } else if (response.status === 404 || response.status >= 500) {
      throw new Error('Unable to analyze this website right now. Please try again.');
    } else {
      throw new Error(errorJson?.message || 'Unable to analyze this website right now. Please try again.');
    }
  }

  const result: BackendAnalysisResponse = await response.json();

  if (!result || !result.data || !result.data.metrics || !result.data.aiAnalysis) {
    throw new Error('Received an unexpected response from the server.');
  }

  return result.data;
}

export function mapBackendToReportData(data: BackendAnalysisData, id?: string): ReportData {
  const reportId = id || `UV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const timestamp = new Date().toISOString();

  return {
    evaluationId: reportId,
    algorithm: 'v4.2.1-STABLE // FORENSIC SCAN COMPLETE',
    timestamp,
    latency: '45ms',
    overallScore: data.aiAnalysis.overallVerdict?.score ?? 0,
    verdictStatus: data.aiAnalysis.overallVerdict?.label || 'Satisfactory',
    metrics: {
      performance: data.metrics.performance,
      accessibility: data.metrics.accessibility,
      bestPractices: data.metrics.bestPractices,
      seoStructure: data.metrics.seo,
      firstContentfulPaint: data.metrics.firstContentfulPaint,
      largestContentfulPaint: data.metrics.largestContentfulPaint,
      speedIndex: data.metrics.speedIndex,
      totalBlockingTime: data.metrics.totalBlockingTime,
      cumulativeLayoutShift: data.metrics.cumulativeLayoutShift,
      timeToInteractive: data.metrics.timeToInteractive,
    },
    qualitativeCritique: data.aiAnalysis.qualitativeCritique || [],
    strengths: data.aiAnalysis.strengths || [],
    refinements: data.aiAnalysis.areasForRefinement || [],
    url: data.url,
    screenshot: data.screenshot,
  };
}
