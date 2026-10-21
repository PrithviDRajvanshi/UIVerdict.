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
import { markBrowserCleanupFailure } from './analysis-concurrency';

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
  status: 'started' | 'succeeded' | 'failed' | 'already_absent',
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

function readCgroupText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

function parseCgroupCounters(raw: string | null, allowedNames: string[]): Record<string, number> | null {
  if (!raw) return null;
  const counters: Record<string, number> = {};
  for (const line of raw.split(/\r?\n/)) {
    const [name, value] = line.trim().split(/\s+/);
    const count = Number(value);
    if (allowedNames.includes(name) && Number.isFinite(count) && count >= 0) counters[name] = count;
  }
  return Object.keys(counters).length ? counters : null;
}

function readContainerMemorySnapshot(): Record<string, unknown> | null {
  const v2Current = readCgroupText('/sys/fs/cgroup/memory.current');
  const v2Limit = readCgroupText('/sys/fs/cgroup/memory.max');
  const v2Events = parseCgroupCounters(readCgroupText('/sys/fs/cgroup/memory.events'), ['high', 'max', 'oom', 'oom_kill', 'oom_group_kill']);
  if (v2Current !== null || v2Limit !== null || v2Events) {
    const current = v2Current === null ? Number.NaN : Number(v2Current);
    const limit = v2Limit === null || v2Limit === 'max' ? Number.NaN : Number(v2Limit);
    return {
      cgroupVersion: 2,
      currentBytes: Number.isFinite(current) ? current : null,
      limitBytes: Number.isFinite(limit) ? limit : null,
      limitUnlimited: v2Limit === 'max',
      events: v2Events,
    };
  }

  const v1Usage = readCgroupText('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  const v1Limit = readCgroupText('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  const v1FailCount = readCgroupText('/sys/fs/cgroup/memory/memory.failcnt');
  const v1OomControl = readCgroupText('/sys/fs/cgroup/memory/memory.oom_control');
  if (v1Usage === null && v1Limit === null && v1FailCount === null && v1OomControl === null) return null;
  const usage = v1Usage === null ? Number.NaN : Number(v1Usage);
  const limit = v1Limit === null ? Number.NaN : Number(v1Limit);
  const failCount = v1FailCount === null ? Number.NaN : Number(v1FailCount);
  return {
    cgroupVersion: 1,
    currentBytes: Number.isFinite(usage) ? usage : null,
    limitBytes: Number.isFinite(limit) ? limit : null,
    failCount: Number.isFinite(failCount) ? failCount : null,
    oomControl: parseCgroupCounters(v1OomControl, ['under_oom', 'oom_kill']),
  };
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

  private readScreenshotResourceDiagnostics(): Record<string, unknown> {
    const memory = process.memoryUsage();
    return {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      uptimeSeconds: Math.round(process.uptime()),
      processMemoryBytes: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers,
      },
      containerMemory: readContainerMemorySnapshot(),
    };
  }

  private collectScreenshotFailureDiagnostics(
    page: Page,
    browser: Browser | null,
    pageDiagnostics: Record<string, unknown> | null,
  ): Record<string, unknown> {
    let pageClosed: boolean | null = null;
    let browserConnected: boolean | null = null;
    let finalUrl: string | null = null;
    let pageGeometry: Record<string, number> | null = null;
    let resourceDiagnostics: Record<string, unknown> | null = null;
    let resourceDiagnosticsError: string | null = null;

    try { pageClosed = page.isClosed(); } catch { /* Diagnostic state is optional. */ }
    try { browserConnected = browser?.isConnected() ?? false; } catch { /* Diagnostic state is optional. */ }
    try { finalUrl = sanitizeDiagnosticUrl(page.url()); } catch { /* The page may already be detached. */ }
    const geometryFields = ['viewportWidth', 'viewportHeight', 'documentWidth', 'documentHeight', 'devicePixelRatio'];
    const capturedGeometry = Object.fromEntries(geometryFields
      .filter((key) => typeof pageDiagnostics?.[key] === 'number' && Number.isFinite(pageDiagnostics[key]))
      .map((key) => [key, pageDiagnostics?.[key] as number]));
    if (Object.keys(capturedGeometry).length) pageGeometry = capturedGeometry;
    try {
      resourceDiagnostics = this.readScreenshotResourceDiagnostics();
    } catch (error: any) {
      resourceDiagnosticsError = sanitizeDiagnosticMessage(error?.message || error);
    }

    return {
      pageClosed,
      browserConnected,
      finalUrl,
      pageGeometry,
      pageGeometrySource: 'pre_capture_page_diagnostics',
      resourceDiagnostics,
      resourceDiagnosticsError,
    };
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
        devicePixelRatio: window.devicePixelRatio,
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
    let operationError: unknown = null;
    let screenshotArtifactPath: string | null = null;
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
      screenshotArtifactPath = absolutePath;

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
        ...(typeof pageDiagnostics.bodyText === 'string'
          ? { bodyText: sanitizeDiagnosticMessage(pageDiagnostics.bodyText, 300).slice(0, 300) }
          : {}),
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
      const screenshotOptions = {
        fullPage: true,
        timeoutMs: this.screenshotTimeoutMs,
        outputFormat: 'png',
        outputPathConfigured: true,
      };
      let screenshotStartResources: Record<string, unknown> | null = null;
      let screenshotStartResourceError: string | null = null;
      try {
        screenshotStartResources = this.readScreenshotResourceDiagnostics();
      } catch (resourceError: any) {
        screenshotStartResourceError = sanitizeDiagnosticMessage(resourceError?.message || resourceError);
      }
      console.info('[Playwright] Full-page screenshot capture started:', {
        requestedUrl: sanitizeDiagnosticUrl(targetUrl),
        screenshotOptions,
        pageClosed: page.isClosed(),
        browserConnected: browser.isConnected(),
        viewportWidth: pageDiagnostics?.viewportWidth ?? null,
        viewportHeight: pageDiagnostics?.viewportHeight ?? null,
        documentWidth: pageDiagnostics?.documentWidth ?? null,
        documentHeight: pageDiagnostics?.documentHeight ?? null,
        devicePixelRatio: pageDiagnostics?.devicePixelRatio ?? null,
        resourceDiagnostics: screenshotStartResources,
        resourceDiagnosticsError: screenshotStartResourceError,
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
          if ((cleanupError as NodeJS.ErrnoException)?.code === 'ENOENT') {
            logCaptureStage('screenshot_artifact_cleanup', 'already_absent', targetUrl, artifactCleanupStartedAt);
          } else {
            logCaptureStage('screenshot_artifact_cleanup', 'failed', targetUrl, artifactCleanupStartedAt, cleanupError);
          }
        }
        const captureError = error as any;
        const screenshotError = sanitizeDiagnosticMessage(captureError?.message || error);
        const errorName = sanitizeDiagnosticMessage(captureError?.name || 'Error');
        const errorCode = sanitizeDiagnosticMessage(captureError?.code || 'unknown');
        // Process-level OOM kills may happen without a catchable JavaScript exception.
        let failureDiagnostics: Record<string, unknown> = {};
        let failureDiagnosticsError: string | null = null;
        try {
          failureDiagnostics = this.collectScreenshotFailureDiagnostics(page, browser, pageDiagnostics);
        } catch (diagnosticError: any) {
          failureDiagnosticsError = sanitizeDiagnosticMessage(diagnosticError?.message || diagnosticError);
        }
        const pageClosed = failureDiagnostics.pageClosed === true;
        const browserConnected = failureDiagnostics.browserConnected !== false;
        const failureClass = /timeout|timed out/i.test(screenshotError)
          ? 'TIMEOUT'
          : pageClosed || !browserConnected || /target.*closed|browser.*closed|context.*closed|browser.*disconnected/i.test(screenshotError)
          ? 'PAGE_OR_BROWSER_CLOSED'
          : /out of memory|enomem|allocation failed|memory limit/i.test(screenshotError)
          ? 'RESOURCE_EXHAUSTION'
          : 'OTHER';
        console.error('[Playwright] Full-page screenshot failed:', {
          requestedUrl: sanitizeDiagnosticUrl(targetUrl),
          stage: screenshotStage,
          failureClass,
          elapsedMs: Date.now() - screenshotCallStartedAt,
          timeoutMs: this.screenshotTimeoutMs,
          errorName,
          errorCode,
          message: screenshotError,
          screenshotOptions,
          ...failureDiagnostics,
          failureDiagnosticsError,
          screenshotStartResources,
          screenshotStartResourceError,
        });
        try {
          await emitDiagnostics('diagnostics_persist_capture_failure', sanitizePlaywrightDiagnostics({
            ...baseDiagnostics,
            outcome: 'CAPTURE_FAILED',
            screenshotDurationMs: Date.now() - screenshotCaptureStartedAt,
            screenshotError,
          }));
        } catch {
          // Failure-diagnostic persistence is best effort; preserve the screenshot exception.
        }
        throw error;
      }
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      if (browser) {
        const closeStartedAt = Date.now();
        logCaptureStage('browser_cleanup', 'started', targetUrl, closeStartedAt);
        try {
          await browser.close();
          logCaptureStage('browser_cleanup', 'succeeded', targetUrl, closeStartedAt);
        } catch (error) {
          logCaptureStage('browser_cleanup', 'failed', targetUrl, closeStartedAt, error);
          if (!operationError) {
            if (screenshotArtifactPath) {
              try {
                await fs.promises.unlink(screenshotArtifactPath);
              } catch (artifactError) {
                if ((artifactError as NodeJS.ErrnoException)?.code !== 'ENOENT') {
                  logCaptureStage('screenshot_artifact_cleanup', 'failed', targetUrl, Date.now(), artifactError);
                }
              }
            }
            const cleanupError = new ApiError(500, 'Failed to close browser after screenshot capture');
            markBrowserCleanupFailure(cleanupError);
            throw cleanupError;
          }
          if (typeof operationError === 'object' && operationError !== null) markBrowserCleanupFailure(operationError);
        }
      }
    }
  }

  public async removeScreenshot(screenshot: ScreenshotResult, force = false): Promise<void> {
    if (!force && this.developmentRetentionMs() > 0 && screenshot.filename.startsWith('uiverdict-')) return;
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

