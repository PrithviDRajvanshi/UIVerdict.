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
import { TargetPageValidationError, validateTargetPage } from './target-page-validation';

export interface ScreenshotResult {
  url: string;
  filename: string;
  path: string;
  sha256: string;
}

export type PlaywrightDiagnosticsCallback = (diagnostics: PlaywrightDiagnosticMetadata) => Promise<void>;

export const DEFAULT_FULL_PAGE_SCREENSHOT_TIMEOUT_MS = 60_000;

function logCaptureStage(
  stage: string,
  status: 'started' | 'succeeded' | 'failed',
  targetUrl: string,
  startedAt: number,
  error?: unknown,
): void {
  const details: Record<string, unknown> = {
    stage,
    status,
    requestedUrl: sanitizeDiagnosticUrl(targetUrl),
    elapsedMs: Date.now() - startedAt,
  };
  if (error !== undefined) {
    const captureError = error as any;
    details.errorName = sanitizeDiagnosticMessage(captureError?.name || 'Error');
    details.errorCode = sanitizeDiagnosticMessage(captureError?.code || 'unknown');
    details.message = sanitizeDiagnosticMessage(captureError?.message || error);
  }
  const label = `[Playwright] Capture stage ${status}:`;
  if (status === 'failed') console.error(label, details);
  else console.info(label, details);
}

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
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        documentWidth: document.documentElement?.scrollWidth ?? 0,
        documentHeight: document.documentElement?.scrollHeight ?? 0,
        bodyText: document.body?.innerText.slice(0, 12000) ?? '',
        hasBody: Boolean(document.body),
        hasCanvasOrSvg: Boolean(document.querySelector('canvas,svg')),
        hasLoginForm: Boolean(document.querySelector('input[type="password"],form[action*="login" i],form[action*="signin" i]')),
        challengeMarkers: [...document.querySelectorAll('[id*="challenge" i],[class*="challenge" i],[id*="captcha" i],[class*="captcha" i]')].slice(0, 8).map((node) => `${node.tagName.toLowerCase()}#${(node as HTMLElement).id}`),
      };
    });
  }

  public async captureScreenshot(targetUrl: string, analysisId?: string, onDiagnostics?: PlaywrightDiagnosticsCallback): Promise<ScreenshotResult> {
    let browser: Browser | null = null;
    const emitDiagnostics = async (stage: string, diagnostics: PlaywrightDiagnosticMetadata): Promise<void> => {
      if (!onDiagnostics) return;
      const startedAt = Date.now();
      logCaptureStage(stage, 'started', targetUrl, startedAt);
      try {
        await onDiagnostics(diagnostics);
        logCaptureStage(stage, 'succeeded', targetUrl, startedAt);
      } catch (error) {
        logCaptureStage(stage, 'failed', targetUrl, startedAt, error);
        throw error;
      }
    };

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

        const launchStartedAt = Date.now();
        logCaptureStage('browser_launch', 'started', targetUrl, launchStartedAt);
        try {
          browser = await chromium.launch(launchOptions);
          logCaptureStage('browser_launch', 'succeeded', targetUrl, launchStartedAt);
        } catch (error) {
          logCaptureStage('browser_launch', 'failed', targetUrl, launchStartedAt, error);
          throw error;
        }
        console.log('[Playwright] Browser launched successfully');
      } catch (error) {
        const launchError = error as any;
        console.error('[Playwright] Failed to launch browser instance:', {
          requestedUrl: sanitizeDiagnosticUrl(targetUrl),
          errorName: sanitizeDiagnosticMessage(launchError?.name || 'Error'),
          errorCode: sanitizeDiagnosticMessage(launchError?.code || 'unknown'),
          message: sanitizeDiagnosticMessage(launchError?.message || error),
        });
        throw new ApiError(500, 'Failed to launch browser instance');
      }

      const contextStartedAt = Date.now();
      logCaptureStage('context_create', 'started', targetUrl, contextStartedAt);
      let context;
      try {
        context = await browser.newContext({
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
        logCaptureStage('context_create', 'succeeded', targetUrl, contextStartedAt);
      } catch (error) {
        logCaptureStage('context_create', 'failed', targetUrl, contextStartedAt, error);
        throw error;
      }

      const pageStartedAt = Date.now();
      logCaptureStage('page_create', 'started', targetUrl, pageStartedAt);
      let page: Page;
      try {
        page = await context.newPage();
        logCaptureStage('page_create', 'succeeded', targetUrl, pageStartedAt);
      } catch (error) {
        logCaptureStage('page_create', 'failed', targetUrl, pageStartedAt, error);
        throw error;
      }
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
        if (response.request().isNavigationRequest()) {
          try {
            if (response.frame() === page.mainFrame()) appendBounded(diagnosticEvents.navigationResponses, {
              url: sanitizeDiagnosticUrl(response.url()),
              status: response.status(),
            });
          } catch {
            // Ignore detached subframes; main-frame validation remains authoritative.
          }
        }
      });

      const collectPageDiagnostics = async (stage = 'page_diagnostics'): Promise<Record<string, unknown>> => {
        const startedAt = Date.now();
        logCaptureStage(stage, 'started', targetUrl, startedAt);
        try {
          const diagnostics = await this.readPageDiagnostics(page);
          logCaptureStage(stage, 'succeeded', targetUrl, startedAt);
          return diagnostics;
        } catch (error) {
          logCaptureStage(stage, 'failed', targetUrl, startedAt, error);
          throw error;
        }
      };

      const navigationStartedAt = Date.now();
      let navigationDurationMs: number | null = null;
      let navigationTimedOut = false;
      let navigationError: string | null = null;
      let captureOutcome: 'CAPTURED' | 'NAVIGATION_TIMEOUT_USABLE_STATE' = 'CAPTURED';
      logCaptureStage('navigation', 'started', targetUrl, navigationStartedAt);
      try {
        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        navigationDurationMs = Date.now() - navigationStartedAt;
        logCaptureStage('navigation', 'succeeded', targetUrl, navigationStartedAt);
      } catch (error: any) {
        navigationDurationMs = Date.now() - navigationStartedAt;
        logCaptureStage('navigation', 'failed', targetUrl, navigationStartedAt, error);
        navigationTimedOut = /timeout/i.test(error?.message || '');
        navigationError = sanitizeDiagnosticMessage(error?.message || error);
        console.error('[Playwright] Navigation error:', sanitizeDiagnosticMessage(error?.message || error));
        const errMessage = error?.message || '';

        if (errMessage.includes('Timeout') || errMessage.includes('timeout')) {
          let hasUsableState = false;
          const timeoutStateCheckStartedAt = Date.now();
          logCaptureStage('navigation_timeout_state_check', 'started', targetUrl, timeoutStateCheckStartedAt);
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
            logCaptureStage('navigation_timeout_state_check', 'succeeded', targetUrl, timeoutStateCheckStartedAt);
          } catch (stateCheckError) {
            logCaptureStage('navigation_timeout_state_check', 'failed', targetUrl, timeoutStateCheckStartedAt, stateCheckError);
            hasUsableState = false;
          }

          if (!hasUsableState) {
            const pageState = await collectPageDiagnostics('navigation_failure_page_diagnostics').catch(() => null);
            await emitDiagnostics('diagnostics_persist_navigation_failure', sanitizePlaywrightDiagnostics({
              requestedUrl: targetUrl,
              page: pageState,
              outcome: 'NAVIGATION_FAILED',
              navigationDurationMs,
              navigationTimedOut,
              navigationError,
              browserEvents: diagnosticEvents,
            }));
            throw new TargetPageValidationError({ status: 'INCONCLUSIVE', reasonCode: 'BROWSER_NETWORK_ERROR', reason: 'Navigation timed out before the intended page could be evaluated.' });
          }
        } else if (
          errMessage.includes('net::ERR_CONNECTION_REFUSED') ||
          errMessage.includes('net::ERR_CONNECTION_RESET') ||
          errMessage.includes('net::ERR_CONNECTION_ABORTED') ||
          errMessage.includes('ECONNREFUSED') ||
          errMessage.includes('ECONNRESET')
        ) {
          const pageState = await collectPageDiagnostics('navigation_failure_page_diagnostics').catch(() => null);
          await emitDiagnostics('diagnostics_persist_navigation_failure', sanitizePlaywrightDiagnostics({ requestedUrl: targetUrl, page: pageState, outcome: 'NAVIGATION_FAILED', navigationDurationMs, navigationTimedOut, navigationError, browserEvents: diagnosticEvents }));
          throw new TargetPageValidationError({ status: 'INCONCLUSIVE', reasonCode: 'BROWSER_NETWORK_ERROR', reason: 'The browser could not connect to the target page.' });
        } else if (errMessage.includes('net::ERR_NAME_NOT_RESOLVED') || errMessage.includes('ENOTFOUND')) {
          const pageState = await collectPageDiagnostics('navigation_failure_page_diagnostics').catch(() => null);
          await emitDiagnostics('diagnostics_persist_navigation_failure', sanitizePlaywrightDiagnostics({ requestedUrl: targetUrl, page: pageState, outcome: 'NAVIGATION_FAILED', navigationDurationMs, navigationTimedOut, navigationError, browserEvents: diagnosticEvents }));
          throw new TargetPageValidationError({ status: 'INCONCLUSIVE', reasonCode: 'BROWSER_NETWORK_ERROR', reason: 'The target hostname could not be resolved.' });
        } else if (errMessage.includes('net::ERR_SSL') || errMessage.includes('CERT')) {
          const pageState = await collectPageDiagnostics('navigation_failure_page_diagnostics').catch(() => null);
          await emitDiagnostics('diagnostics_persist_navigation_failure', sanitizePlaywrightDiagnostics({ requestedUrl: targetUrl, page: pageState, outcome: 'NAVIGATION_FAILED', navigationDurationMs, navigationTimedOut, navigationError, browserEvents: diagnosticEvents }));
          throw new TargetPageValidationError({ status: 'INCONCLUSIVE', reasonCode: 'BROWSER_NETWORK_ERROR', reason: 'The browser could not establish a secure connection to the target.' });
        } else {
          const pageState = await collectPageDiagnostics('navigation_failure_page_diagnostics').catch(() => null);
          await emitDiagnostics('diagnostics_persist_navigation_failure', sanitizePlaywrightDiagnostics({ requestedUrl: targetUrl, page: pageState, outcome: 'NAVIGATION_FAILED', navigationDurationMs, navigationTimedOut, navigationError, browserEvents: diagnosticEvents }));
          throw new TargetPageValidationError({ status: 'INCONCLUSIVE', reasonCode: 'BROWSER_NETWORK_ERROR', reason: 'Navigation failed before the intended page could be evaluated.' });
        }
      }

      // Settling period to allow visual components and fonts to stabilize
      const settlingDelayMs = this.settlingDelayMs;
      const settlingStartedAt = Date.now();
      logCaptureStage('settling_delay', 'started', targetUrl, settlingStartedAt);
      try {
        await page.waitForTimeout(settlingDelayMs);
        logCaptureStage('settling_delay', 'succeeded', targetUrl, settlingStartedAt);
      } catch (error) {
        logCaptureStage('settling_delay', 'failed', targetUrl, settlingStartedAt, error);
        // Ignore errors during settling phase
      }

      const filename = this.generateFilename(targetUrl, analysisId);
      const relativePath = path.join('temp', 'screenshots', filename).replace(/\\/g, '/');
      const absolutePath = path.join(this.tempDir, filename);

      const screenshotStartedAt = new Date().toISOString();
      let pageDiagnostics: Record<string, unknown> | null = null;
      try {
        pageDiagnostics = await collectPageDiagnostics();
      } catch (error: any) {
        pageDiagnostics = { collectionError: sanitizeDiagnosticMessage(error?.message || error) };
      }
      const latestNavigation = diagnosticEvents.navigationResponses[diagnosticEvents.navigationResponses.length - 1];
      const targetValidation = validateTargetPage({
        httpStatus: latestNavigation?.status ?? null,
        finalUrl: String(pageDiagnostics?.finalUrl ?? page.url()),
        title: String(pageDiagnostics?.title ?? ''),
        bodyText: String(pageDiagnostics?.bodyText ?? ''),
        readyState: String(pageDiagnostics?.readyState ?? ''),
        visibleElementCount: Number(pageDiagnostics?.visibleElementCount ?? 0),
        hasBody: Boolean(pageDiagnostics?.hasBody),
        hasCanvasOrSvg: Boolean(pageDiagnostics?.hasCanvasOrSvg),
        hasLoginForm: Boolean(pageDiagnostics?.hasLoginForm),
        challengeMarkers: Array.isArray(pageDiagnostics?.challengeMarkers) ? pageDiagnostics.challengeMarkers as string[] : [],
      });
      if (targetValidation.status !== 'VALID') {
        const validationDiagnostics = sanitizePlaywrightDiagnostics({
          requestedUrl: targetUrl,
          page: pageDiagnostics,
          outcome: targetValidation.status,
          validationReasonCode: targetValidation.reasonCode,
          validationReason: targetValidation.reason,
          navigationDurationMs,
          navigationTimedOut,
          navigationError,
          browserEvents: diagnosticEvents,
        });
        await emitDiagnostics('diagnostics_persist_validation', validationDiagnostics);
        console.warn('[Playwright] Target validation rejected evaluation:', {
          status: targetValidation.status,
          reasonCode: targetValidation.reasonCode,
          finalUrl: sanitizeDiagnosticUrl(String(pageDiagnostics?.finalUrl ?? page.url())),
        });
        throw new TargetPageValidationError(targetValidation);
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
      await emitDiagnostics('diagnostics_persist_capture', sanitizePlaywrightDiagnostics(baseDiagnostics));
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

      const screenshotCallStartedAt = Date.now();
      let screenshotStage: 'browser_capture' | 'read_artifact' | 'hash_artifact' | 'persist_diagnostics' = 'browser_capture';
      console.info('[Playwright] Full-page screenshot capture started:', {
        requestedUrl: sanitizeDiagnosticUrl(targetUrl),
        fullPage: true,
        timeoutMs: this.screenshotTimeoutMs,
        pageClosed: page.isClosed(),
        browserConnected: browser.isConnected(),
        viewportWidth: pageDiagnostics?.viewportWidth ?? null,
        viewportHeight: pageDiagnostics?.viewportHeight ?? null,
        documentWidth: pageDiagnostics?.documentWidth ?? null,
        documentHeight: pageDiagnostics?.documentHeight ?? null,
        startedAt: new Date(screenshotCallStartedAt).toISOString(),
      });
      try {
        await page.screenshot({
          path: absolutePath,
          fullPage: true,
          timeout: this.screenshotTimeoutMs,
        });
        console.info('[Playwright] Full-page screenshot browser capture completed:', {
          requestedUrl: sanitizeDiagnosticUrl(targetUrl),
          elapsedMs: Date.now() - screenshotCallStartedAt,
        });
        screenshotStage = 'read_artifact';
        const screenshotBytes = await fs.promises.readFile(absolutePath);
        screenshotStage = 'hash_artifact';
        const sha256 = crypto.createHash('sha256').update(screenshotBytes).digest('hex');
        const screenshotDurationMs = Date.now() - screenshotCaptureStartedAt;
        const screenshotCompletedAt = new Date().toISOString();
        screenshotStage = 'persist_diagnostics';
        await emitDiagnostics('diagnostics_persist_capture_success', sanitizePlaywrightDiagnostics({
          ...baseDiagnostics,
          screenshotDurationMs,
          screenshotCompletedAt,
        }));
        console.log('[Playwright] Screenshot timing:', {
          screenshotDurationMs,
          screenshotCompletedAt,
        });
        console.info('[Playwright] Full-page screenshot capture completed:', {
          requestedUrl: sanitizeDiagnosticUrl(targetUrl),
          elapsedMs: Date.now() - screenshotCallStartedAt,
          artifactBytes: screenshotBytes.length,
          completedAt: screenshotCompletedAt,
        });
        this.scheduleDevelopmentCleanup(filename);
        return { url: targetUrl, filename, path: relativePath, sha256 };
      } catch (error) {
        const artifactCleanupStartedAt = Date.now();
        logCaptureStage('screenshot_artifact_cleanup', 'started', targetUrl, artifactCleanupStartedAt);
        try {
          await fs.promises.unlink(absolutePath);
          logCaptureStage('screenshot_artifact_cleanup', 'succeeded', targetUrl, artifactCleanupStartedAt);
        } catch (cleanupError) {
          logCaptureStage('screenshot_artifact_cleanup', 'failed', targetUrl, artifactCleanupStartedAt, cleanupError);
        }
        const captureError = error as any;
        const screenshotError = sanitizeDiagnosticMessage(captureError?.message || error);
        const errorName = sanitizeDiagnosticMessage(captureError?.name || 'Error');
        const errorCode = sanitizeDiagnosticMessage(captureError?.code || 'unknown');
        // Process-level OOM kills may happen without a catchable JavaScript exception.
        const failureClass = /timeout|timed out/i.test(screenshotError)
          ? 'TIMEOUT'
          : page.isClosed() || !browser?.isConnected() || /target.*closed|browser.*closed|context.*closed|browser.*disconnected/i.test(screenshotError)
          ? 'PAGE_OR_BROWSER_CLOSED'
          : /out of memory|enomem|allocation failed|memory limit/i.test(screenshotError)
          ? 'RESOURCE_EXHAUSTION'
          : 'OTHER';
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
          requestedUrl: sanitizeDiagnosticUrl(targetUrl),
          stage: screenshotStage,
          failureClass,
          elapsedMs: Date.now() - screenshotCallStartedAt,
          timeoutMs: this.screenshotTimeoutMs,
          errorName,
          errorCode,
          message: screenshotError,
          pageClosed: page.isClosed(),
          browserConnected: browser?.isConnected() ?? false,
          finalUrl: sanitizeDiagnosticUrl(page.url()),
          pageGeometry,
        });
        await emitDiagnostics('diagnostics_persist_capture_failure', sanitizePlaywrightDiagnostics({
          ...baseDiagnostics,
          outcome: 'CAPTURE_FAILED',
          screenshotDurationMs: Date.now() - screenshotCaptureStartedAt,
          screenshotError,
        }));
        throw new ApiError(500, 'Failed to capture full page screenshot');
      }
    } finally {
      if (browser) {
        const closeStartedAt = Date.now();
        logCaptureStage('browser_cleanup', 'started', targetUrl, closeStartedAt);
        try {
          await browser.close();
          logCaptureStage('browser_cleanup', 'succeeded', targetUrl, closeStartedAt);
        } catch (error) {
          logCaptureStage('browser_cleanup', 'failed', targetUrl, closeStartedAt, error);
        }
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

