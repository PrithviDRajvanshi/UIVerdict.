import { chromium, Browser, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { ApiError } from '../errors/ApiError';
import {
  appendBounded,
  PlaywrightDiagnosticMetadata,
  sanitizeDiagnosticMessage,
  sanitizeDiagnosticUrl,
  sanitizePlaywrightDiagnostics,
} from './browser-diagnostics';

export interface ScreenshotResult {
  url: string;
  filename: string;
  path: string;
  sha256: string;
}

export type PlaywrightDiagnosticsCallback = (diagnostics: PlaywrightDiagnosticMetadata) => Promise<void>;

export const DEFAULT_FULL_PAGE_SCREENSHOT_TIMEOUT_MS = 60_000;

export class PlaywrightService {
  private tempDir: string;

  constructor(
    private readonly screenshotTimeoutMs = DEFAULT_FULL_PAGE_SCREENSHOT_TIMEOUT_MS,
    private readonly settlingDelayMs = 2000,
  ) {
    this.tempDir = path.resolve(process.cwd(), 'temp', 'screenshots');
  }

  private ensureTempDirExists(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  private generateFilename(targetUrl: string, analysisId?: string): string {
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timePart = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const uniqueSuffix = crypto.randomUUID();
    const safeAnalysisId = (analysisId || 'unassociated').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);
    
    let hostname = 'url';
    try {
      hostname = new URL(targetUrl).hostname.replace(/[^a-zA-Z0-9]/g, '-');
    } catch {
      hostname = 'url';
    }

    return `uiverdict-${safeAnalysisId}-${datePart}-${timePart}-${hostname.slice(0, 60)}-${uniqueSuffix}.png`;
  }

  private developmentRetentionMs(): number {
    if (process.env.NODE_ENV !== 'development') return 0;
    const hours = Number(process.env.UIVERDICT_DEV_SCREENSHOT_RETENTION_HOURS || 0);
    return Number.isFinite(hours) && hours > 0 ? Math.min(hours, 168) * 60 * 60 * 1000 : 0;
  }

  private async cleanupExpiredDevelopmentScreenshots(): Promise<void> {
    const retentionMs = this.developmentRetentionMs();
    if (!retentionMs) return;
    const cutoff = Date.now() - retentionMs;
    const names = await fs.promises.readdir(this.tempDir).catch(() => [] as string[]);
    await Promise.all(names.filter((name) => /^uiverdict-[a-zA-Z0-9-]+-\d{8}-\d{6}-[a-zA-Z0-9-]+-[a-f0-9-]+\.png$/i.test(name)).map(async (name) => {
      const filename = path.join(this.tempDir, name);
      const stats = await fs.promises.stat(filename).catch(() => null);
      if (stats && stats.mtimeMs < cutoff) await fs.promises.unlink(filename).catch(() => {});
    }));
  }

  private scheduleDevelopmentCleanup(filename: string): void {
    const retentionMs = this.developmentRetentionMs();
    if (!retentionMs || !filename.startsWith('uiverdict-')) return;
    const timer = setTimeout(() => {
      const target = path.resolve(this.tempDir, filename);
      const root = `${path.resolve(this.tempDir)}${path.sep}`;
      if (target.startsWith(root)) void fs.promises.unlink(target).catch(() => {});
    }, retentionMs);
    timer.unref();
  }

  private async readPageDiagnostics(page: Page): Promise<Record<string, unknown>> {
    return page.evaluate(() => {
      const visible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      return {
        finalUrl: location.href,
        title: document.title,
        readyState: document.readyState,
        bodyTextLength: document.body?.innerText.length ?? 0,
        visibleElementCount: [...(document.body?.querySelectorAll('*') ?? [])].filter(visible).length,
        imageCount: document.images.length,
        buttonCount: document.querySelectorAll('button,[role="button"]').length,
      };
    });
  }

  public async captureScreenshot(targetUrl: string, analysisId?: string, onDiagnostics?: PlaywrightDiagnosticsCallback): Promise<ScreenshotResult> {
    let browser: Browser | null = null;

    try {
      this.ensureTempDirExists();
      await this.cleanupExpiredDevelopmentScreenshots();

      try {
        let pwVersion = 'unknown';
        try {
          pwVersion = require('playwright/package.json').version;
        } catch {
          // Ignore version lookup failure
        }
        const defaultExecutablePath = chromium.executablePath();
        const hasChromePath = Boolean(process.env.CHROME_PATH);
        const chromePathVal = process.env.CHROME_PATH ? path.normalize(process.env.CHROME_PATH) : 'none';

        console.log('[Playwright] Diagnostic info:', {
          playwrightVersion: pwVersion,
          defaultExecutablePath,
          hasChromePath,
          chromePath: chromePathVal,
        });

        const launchOptions: Parameters<typeof chromium.launch>[0] = {
          headless: true,
          channel: 'chromium',
          timeout: 30000,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
          ],
        };

        console.log('[Playwright] Launching browser with options:', {
          headless: launchOptions.headless,
          channel: launchOptions.channel,
          timeout: launchOptions.timeout,
          args: launchOptions.args,
        });

        browser = await chromium.launch(launchOptions);
        console.log('[Playwright] Browser launched successfully');
      } catch (error) {
        console.error('[Playwright] Failed to launch browser instance:', sanitizeDiagnosticMessage((error as any)?.message || error));
        throw new ApiError(500, 'Failed to launch browser instance');
      }

      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
        },
      });

      const page: Page = await context.newPage();
      const diagnosticEvents = {
        consoleErrors: [] as string[],
        pageErrors: [] as string[],
        failedRequests: [] as Array<{ url: string; reason: string }>,
        mainFrameNavigations: [] as string[],
        navigationResponses: [] as Array<{ url: string; status: number }>,
        httpErrorResponses: [] as Array<{ url: string; status: number }>,
      };
      page.on('console', (message) => {
        if (message.type() === 'error') appendBounded(diagnosticEvents.consoleErrors, sanitizeDiagnosticMessage(message.text()));
      });
      page.on('pageerror', (error) => appendBounded(diagnosticEvents.pageErrors, sanitizeDiagnosticMessage(error.message)));
      page.on('requestfailed', (request) => appendBounded(diagnosticEvents.failedRequests, {
        url: sanitizeDiagnosticUrl(request.url()),
        reason: sanitizeDiagnosticMessage(request.failure()?.errorText ?? 'unknown'),
      }));
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) appendBounded(diagnosticEvents.mainFrameNavigations, sanitizeDiagnosticUrl(frame.url()));
      });
      page.on('response', (response) => {
        if (response.status() >= 400) appendBounded(diagnosticEvents.httpErrorResponses, {
          url: sanitizeDiagnosticUrl(response.url()),
          status: response.status(),
        });
        if (response.request().isNavigationRequest()) appendBounded(diagnosticEvents.navigationResponses, {
          url: sanitizeDiagnosticUrl(response.url()),
          status: response.status(),
        });
      });

      const navigationStartedAt = Date.now();
      let navigationDurationMs: number | null = null;
      let navigationTimedOut = false;
      let navigationError: string | null = null;
      let captureOutcome: 'CAPTURED' | 'NAVIGATION_TIMEOUT_USABLE_STATE' = 'CAPTURED';
      try {
        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        navigationDurationMs = Date.now() - navigationStartedAt;
      } catch (error: any) {
        navigationDurationMs = Date.now() - navigationStartedAt;
        navigationTimedOut = /timeout/i.test(error?.message || '');
        navigationError = sanitizeDiagnosticMessage(error?.message || error);
        console.error('[Playwright] Navigation error:', sanitizeDiagnosticMessage(error?.message || error));
        const errMessage = error?.message || '';

        if (errMessage.includes('Timeout') || errMessage.includes('timeout')) {
          let hasUsableState = false;
          try {
            const currentUrl = page.url();
            if (currentUrl && currentUrl !== 'about:blank') {
              const bodyLength = await page.evaluate(() => {
                return document.body ? document.body.innerText.trim().length : 0;
              });
              if (bodyLength > 0) {
                hasUsableState = true;
                captureOutcome = 'NAVIGATION_TIMEOUT_USABLE_STATE';
              }
            }
          } catch {
            hasUsableState = false;
          }

          if (!hasUsableState) {
            const pageState = await this.readPageDiagnostics(page).catch(() => null);
            if (onDiagnostics) await onDiagnostics(sanitizePlaywrightDiagnostics({
              requestedUrl: targetUrl,
              page: pageState,
              outcome: 'NAVIGATION_FAILED',
              navigationDurationMs,
              navigationTimedOut,
              navigationError,
              browserEvents: diagnosticEvents,
            }));
            throw new ApiError(504, `Navigation timeout while loading URL: ${targetUrl}`);
          }
        } else if (
          errMessage.includes('net::ERR_CONNECTION_REFUSED') ||
          errMessage.includes('net::ERR_CONNECTION_RESET') ||
          errMessage.includes('net::ERR_CONNECTION_ABORTED') ||
          errMessage.includes('ECONNREFUSED') ||
          errMessage.includes('ECONNRESET')
        ) {
          const pageState = await this.readPageDiagnostics(page).catch(() => null);
          if (onDiagnostics) await onDiagnostics(sanitizePlaywrightDiagnostics({ requestedUrl: targetUrl, page: pageState, outcome: 'NAVIGATION_FAILED', navigationDurationMs, navigationTimedOut, navigationError, browserEvents: diagnosticEvents }));
          throw new ApiError(502, `Connection failed while connecting to URL: ${targetUrl}`);
        } else if (errMessage.includes('net::ERR_NAME_NOT_RESOLVED') || errMessage.includes('ENOTFOUND')) {
          const pageState = await this.readPageDiagnostics(page).catch(() => null);
          if (onDiagnostics) await onDiagnostics(sanitizePlaywrightDiagnostics({ requestedUrl: targetUrl, page: pageState, outcome: 'NAVIGATION_FAILED', navigationDurationMs, navigationTimedOut, navigationError, browserEvents: diagnosticEvents }));
          throw new ApiError(502, `DNS failure or domain not found for URL: ${targetUrl}`);
        } else if (errMessage.includes('net::ERR_SSL') || errMessage.includes('CERT')) {
          const pageState = await this.readPageDiagnostics(page).catch(() => null);
          if (onDiagnostics) await onDiagnostics(sanitizePlaywrightDiagnostics({ requestedUrl: targetUrl, page: pageState, outcome: 'NAVIGATION_FAILED', navigationDurationMs, navigationTimedOut, navigationError, browserEvents: diagnosticEvents }));
          throw new ApiError(502, `HTTPS/SSL error while connecting to URL: ${targetUrl}`);
        } else {
          const pageState = await this.readPageDiagnostics(page).catch(() => null);
          if (onDiagnostics) await onDiagnostics(sanitizePlaywrightDiagnostics({ requestedUrl: targetUrl, page: pageState, outcome: 'NAVIGATION_FAILED', navigationDurationMs, navigationTimedOut, navigationError, browserEvents: diagnosticEvents }));
          throw new ApiError(502, `Failed to navigate to URL: ${targetUrl}`);
        }
      }

      // Settling period to allow visual components and fonts to stabilize
      const settlingDelayMs = this.settlingDelayMs;
      const settlingStartedAt = Date.now();
      try {
        await page.waitForTimeout(settlingDelayMs);
      } catch {
        // Ignore errors during settling phase
      }

      const filename = this.generateFilename(targetUrl, analysisId);
      const relativePath = path.join('temp', 'screenshots', filename).replace(/\\/g, '/');
      const absolutePath = path.join(this.tempDir, filename);

      const screenshotStartedAt = new Date().toISOString();
      let pageDiagnostics: Record<string, unknown> | null = null;
      try {
        pageDiagnostics = await this.readPageDiagnostics(page);
      } catch (error: any) {
        pageDiagnostics = { collectionError: sanitizeDiagnosticMessage(error?.message || error) };
      }
      const screenshotCaptureStartedAt = Date.now();
      const baseDiagnostics = {
        requestedUrl: targetUrl,
        page: pageDiagnostics,
        outcome: captureOutcome,
        navigationDurationMs,
        navigationTimedOut,
        navigationError,
        settlingDelayMs,
        screenshotStartedAt,
        browserEvents: diagnosticEvents,
      };
      if (onDiagnostics) await onDiagnostics(sanitizePlaywrightDiagnostics(baseDiagnostics));
      const safePageDiagnostics = pageDiagnostics ? {
        ...pageDiagnostics,
        ...(typeof pageDiagnostics.finalUrl === 'string' ? { finalUrl: sanitizeDiagnosticUrl(pageDiagnostics.finalUrl) } : {}),
        ...(typeof pageDiagnostics.title === 'string' ? { title: sanitizeDiagnosticMessage(pageDiagnostics.title) } : {}),
      } : { collectionError: 'page diagnostics unavailable' };
      console.log('[Playwright] Capture diagnostics:', {
        requestedUrl: sanitizeDiagnosticUrl(targetUrl),
        ...safePageDiagnostics,
        navigationDurationMs,
        navigationTimedOut,
        settlingDelayMs,
        settlingElapsedMs: screenshotCaptureStartedAt - settlingStartedAt,
        screenshotStartedAt,
        browserEvents: diagnosticEvents,
      });

      try {
        await page.screenshot({
          path: absolutePath,
          fullPage: true,
          timeout: this.screenshotTimeoutMs,
        });
        const screenshotBytes = await fs.promises.readFile(absolutePath);
        const sha256 = crypto.createHash('sha256').update(screenshotBytes).digest('hex');
        const screenshotDurationMs = Date.now() - screenshotCaptureStartedAt;
        const screenshotCompletedAt = new Date().toISOString();
        if (onDiagnostics) await onDiagnostics(sanitizePlaywrightDiagnostics({
          ...baseDiagnostics,
          screenshotDurationMs,
          screenshotCompletedAt,
        }));
        console.log('[Playwright] Screenshot timing:', {
          screenshotDurationMs,
          screenshotCompletedAt,
        });
        this.scheduleDevelopmentCleanup(filename);
        return { url: targetUrl, filename, path: relativePath, sha256 };
      } catch (error) {
        await fs.promises.unlink(absolutePath).catch(() => {});
        const captureError = error as any;
        const screenshotError = sanitizeDiagnosticMessage(captureError?.message || error);
        let pageGeometry: Record<string, number> | null = null;
        try {
          pageGeometry = await page.evaluate(() => ({
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            documentWidth: document.documentElement?.scrollWidth ?? 0,
            documentHeight: document.documentElement?.scrollHeight ?? 0,
            devicePixelRatio: window.devicePixelRatio,
          }));
        } catch {
          // Page may already be detached or closed; the capture error is primary.
        }
        console.error('[Playwright] Full-page screenshot failed:', {
          errorName: sanitizeDiagnosticMessage(captureError?.name || 'Error'),
          errorCode: sanitizeDiagnosticMessage(captureError?.code || 'unknown'),
          message: screenshotError,
          pageClosed: page.isClosed(),
          finalUrl: sanitizeDiagnosticUrl(page.url()),
          pageGeometry,
        });
        if (onDiagnostics) await onDiagnostics(sanitizePlaywrightDiagnostics({
          ...baseDiagnostics,
          outcome: 'CAPTURE_FAILED',
          screenshotDurationMs: Date.now() - screenshotCaptureStartedAt,
          screenshotError,
        }));
        throw new ApiError(500, 'Failed to capture full page screenshot');
      }
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  public async removeScreenshot(screenshot: ScreenshotResult): Promise<void> {
    if (this.developmentRetentionMs() > 0 && screenshot.filename.startsWith('uiverdict-')) return;
    const filePath = path.resolve(this.tempDir, screenshot.filename);
    const tempRoot = `${path.resolve(this.tempDir)}${path.sep}`;
    if (!filePath.startsWith(tempRoot)) {
      throw new Error('Refusing to remove a screenshot outside the temporary screenshot directory');
    }

    try {
      await fs.promises.unlink(filePath);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

export const playwrightService = new PlaywrightService();

