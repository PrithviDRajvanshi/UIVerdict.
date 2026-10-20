import analysisMock from '../data/analysis.json';
import { AnalysisOverviewData } from '../types/analysis';
import { API_URL } from '../config/api.config';


export interface BackendMetrics {
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
}

export interface BackendAiAnalysis {
  visualDesignScore: number;
  qualitativeCritique: string[];
  strengths: string[];
  areasForRefinement: string[];
}

export interface BackendAnalysisData {
  id: string;
  url: string;
  mode: 'visual' | 'tech';
  metrics: BackendMetrics;
  aiAnalysis: BackendAiAnalysis | null;
  aiStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_REQUESTED';
  status: 'VALID' | 'BLOCKED' | 'INCONCLUSIVE';
  overallScore: number | null;
  verdictLabel: string | null;
  visualDesignScore: number | null;
}

export interface BackendAnalysisResponse {
  status: string;
  message: string;
  data: BackendAnalysisData;
}

export async function fetchAnalysisOverview(): Promise<AnalysisOverviewData> {
  return analysisMock as AnalysisOverviewData;
}

export async function analyzeWebsite(url: string, mode: 'visual' | 'tech' = 'visual', signal?: AbortSignal): Promise<BackendAnalysisData> {
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
      body: JSON.stringify({ url: formattedUrl, mode }),
      credentials: 'include',
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

  if (!result || !result.data || !result.data.id) {
    throw new Error('Received an unexpected response from the server.');
  }

  return result.data;
}
