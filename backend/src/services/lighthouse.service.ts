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
  private async runSingleAudit(targetUrl: string, attempt: number, maxAttempts: number): Promise<LighthouseMetrics> {
    let chrome: chromeLauncher.LaunchedChrome | null = null;

    console.log(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Launching Chrome for URL: ${targetUrl}`);

    try {
      chrome = await chromeLauncher.launch({
        chromeFlags: [
          '--headless=new',
          '--no-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-software-rasterizer',
          '--no-first-run',
        ],
      });

      console.log(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Dedicated Chrome listening on port ${chrome.port}`);

      const lighthouseModule = await import('lighthouse');
      const lighthouse = lighthouseModule.default || lighthouseModule;

      const flags = {
        logLevel: 'error' as const,
        output: 'json' as const,
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        port: chrome.port,
      };

      const config = {
        extends: 'lighthouse:default',
        settings: {
          maxWaitForFcp: 45000,
          maxWaitForLoad: 60000,
        },
      };

      console.log(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Running audit...`);
      const runnerResult = await (lighthouse as any)(targetUrl, flags, config);

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

      const metrics: LighthouseMetrics = {
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

      console.log(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Completed successfully with performance score ${metrics.performance}`);
      return metrics;
    } finally {
      if (chrome) {
        console.log(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Cleaning up Chrome process...`);
        try {
          await chrome.kill();
        } catch (killErr) {
          console.error('[Lighthouse] Warning closing Chrome:', killErr);
        }
      }
    }
  }

  public async runAudit(targetUrl: string): Promise<LighthouseMetrics> {
    const MAX_ATTEMPTS = 2;
    let lastError: any = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.runSingleAudit(targetUrl, attempt, MAX_ATTEMPTS);
      } catch (error: any) {
        lastError = error;
        const errMessage = error?.message || 'Unknown Lighthouse error';
        console.error(`[Lighthouse] Attempt ${attempt}/${MAX_ATTEMPTS} failed: ${errMessage}`);

        if (attempt < MAX_ATTEMPTS) {
          console.log(`[Lighthouse] Waiting 2000ms before retrying Lighthouse audit...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    if (lastError instanceof ApiError) {
      throw lastError;
    }
    const finalMsg = lastError?.message || 'Lighthouse audit failed after retries';
    throw new ApiError(500, `Lighthouse audit failure: ${finalMsg}`);
  }
}

export const lighthouseService = new LighthouseService();
