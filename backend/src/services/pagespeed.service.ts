import { ApiError } from '../errors/ApiError';
import type { LighthouseMetrics } from './lighthouse.service';
import { normalizeLighthouseCategoryScore } from './scoring.service';

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const PSI_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;

interface PageSpeedServiceOptions {
  apiKey?: string | (() => string | undefined);
  fetch?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function metricDisplayValue(audits: Record<string, any>, key: string): string | null {
  const value = audits[key]?.displayValue;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function mapPageSpeedResult(payload: any): LighthouseMetrics {
  const lighthouseResult = payload?.lighthouseResult;
  const categories = lighthouseResult?.categories ?? {};
  const audits = lighthouseResult?.audits ?? {};
  return {
    performance: normalizeLighthouseCategoryScore(categories.performance?.score),
    accessibility: normalizeLighthouseCategoryScore(categories.accessibility?.score),
    bestPractices: normalizeLighthouseCategoryScore(categories['best-practices']?.score),
    seo: normalizeLighthouseCategoryScore(categories.seo?.score),
    firstContentfulPaint: metricDisplayValue(audits, 'first-contentful-paint'),
    largestContentfulPaint: metricDisplayValue(audits, 'largest-contentful-paint'),
    speedIndex: metricDisplayValue(audits, 'speed-index'),
    totalBlockingTime: metricDisplayValue(audits, 'total-blocking-time'),
    cumulativeLayoutShift: metricDisplayValue(audits, 'cumulative-layout-shift'),
    timeToInteractive: metricDisplayValue(audits, 'interactive'),
  };
}

export class PageSpeedService {
  private readonly getApiKey: () => string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: PageSpeedServiceOptions = {}) {
    const configuredApiKey = options.apiKey;
    this.getApiKey = typeof configuredApiKey === 'function'
      ? configuredApiKey
      : () => configuredApiKey ?? process.env.PSI_API_KEY;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  public async runAudit(pageUrl: string, externalSignal?: AbortSignal): Promise<LighthouseMetrics> {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error('PageSpeed Insights API key is not configured');

    const requestUrl = new URL(PSI_ENDPOINT);
    requestUrl.searchParams.set('url', pageUrl);
    requestUrl.searchParams.set('strategy', 'desktop');
    for (const category of PSI_CATEGORIES) requestUrl.searchParams.append('category', category);
    requestUrl.searchParams.set('key', apiKey);

    for (let attempt = 0; attempt < 2; attempt++) {
      if (externalSignal?.aborted) throw new Error('PageSpeed Insights request was cancelled');
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.timeoutMs);
      const abortExternal = () => controller.abort(externalSignal?.reason);
      externalSignal?.addEventListener('abort', abortExternal, { once: true });

      try {
        const response = await this.fetchImpl(requestUrl, { signal: controller.signal });
        if (!response.ok) {
          if ((response.status === 429 || response.status >= 500) && attempt === 0) {
            await this.sleep(this.retryDelayMs);
            continue;
          }
          throw new Error(`PageSpeed Insights returned HTTP ${response.status}`);
        }
        return mapPageSpeedResult(await response.json());
      } catch (error) {
        if (timedOut) throw new Error('PageSpeed Insights request timed out');
        if (externalSignal?.aborted) throw new Error('PageSpeed Insights request was cancelled');
        throw error;
      } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', abortExternal);
      }
    }

    throw new ApiError(503, 'PageSpeed Insights request failed');
  }
}

export const pageSpeedService = new PageSpeedService();
