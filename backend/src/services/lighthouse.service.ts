import * as chromeLauncher from 'chrome-launcher';
import { ApiError } from '../errors/ApiError';

export interface LighthouseMetrics {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
  firstContentfulPaint: string;
  largestContentfulPaint: string;
  speedIndex: string;
  totalBlockingTime: string;
  cumulativeLayoutShift: string;
  timeToInteractive: string;
}

export class LighthouseService {
  public async runAudit(targetUrl: string): Promise<LighthouseMetrics> {
    let chrome: chromeLauncher.LaunchedChrome | null = null;

    try {
      chrome = await chromeLauncher.launch({
        chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'],
      });

      const lighthouseModule = await import('lighthouse');
      const lighthouse = lighthouseModule.default || lighthouseModule;

      const options = {
        logLevel: 'error' as const,
        output: 'json' as const,
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        port: chrome.port,
      };

      const runnerResult = await (lighthouse as any)(targetUrl, options);

      if (!runnerResult || !runnerResult.lhr) {
        throw new ApiError(500, 'Lighthouse audit produced no results');
      }

      const { categories, audits } = runnerResult.lhr;

      const getScore = (catKey: string): number => {
        const cat = categories[catKey];
        return cat && typeof cat.score === 'number' ? Math.round(cat.score * 100) : 0;
      };

      const getDisplayValue = (auditKey: string): string => {
        const audit = audits[auditKey];
        return audit && audit.displayValue ? audit.displayValue : 'N/A';
      };

      return {
        performance: getScore('performance'),
        accessibility: getScore('accessibility'),
        bestPractices: getScore('best-practices'),
        seo: getScore('seo'),
        firstContentfulPaint: getDisplayValue('first-contentful-paint'),
        largestContentfulPaint: getDisplayValue('largest-contentful-paint'),
        speedIndex: getDisplayValue('speed-index'),
        totalBlockingTime: getDisplayValue('total-blocking-time'),
        cumulativeLayoutShift: getDisplayValue('cumulative-layout-shift'),
        timeToInteractive: getDisplayValue('interactive'),
      };
    } catch (error: any) {
      if (error instanceof ApiError) {
        throw error;
      }
      const message = error?.message || 'Lighthouse audit failed';
      throw new ApiError(500, `Lighthouse audit failure: ${message}`);
    } finally {
      if (chrome) {
        try {
          await chrome.kill();
        } catch {}
      }
    }
  }
}

export const lighthouseService = new LighthouseService();
