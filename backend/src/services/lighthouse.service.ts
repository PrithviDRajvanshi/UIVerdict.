import * as chromeLauncher from 'chrome-launcher';
import { execFileSync } from 'child_process';
import { chromium } from 'playwright';
import { ApiError } from '../errors/ApiError';
import { isBrowserCleanupFailure, markBrowserCleanupFailure } from './analysis-concurrency';
import { normalizeLighthouseCategoryScore } from './scoring.service';
import {
  classifyLighthouseFailure,
  classifyLighthouseResult,
  createLighthouseSessionDiagnostics,
  extractLighthouseNavigationResponses,
  LighthouseDiagnosticMetadata,
  sanitizeDiagnosticMessage,
  sanitizeDiagnosticUrl,
  sanitizeLighthouseDiagnostics,
} from './browser-diagnostics';

export interface LighthouseMetrics {
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

export type LighthouseDiagnosticsCallback = (diagnostics: LighthouseDiagnosticMetadata) => Promise<void>;

async function waitForChromeExit(chrome: chromeLauncher.LaunchedChrome, timeoutMs: number): Promise<void> {
  const child = chrome.process;
  if (child.exitCode !== null || child.signalCode !== null) return;
  // `close` also waits for Chrome Launcher's stdio files to close, which only
  // happens inside `chrome.kill()`. Wait for process `exit` to avoid deadlock.
  let timeout: NodeJS.Timeout | undefined;
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Timed out waiting for Chrome process to exit')), timeoutMs);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function stopChromeProcessTreeAndWait(chrome: chromeLauncher.LaunchedChrome, timeoutMs: number): Promise<void> {
  const pid = chrome.process.pid;
  if (!pid) throw new Error('Chrome process ID unavailable; process-tree cleanup cannot be confirmed');

  if (process.platform === 'win32') {
    // chrome-launcher suppresses taskkill errors, so invoke it directly and check the result.
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch (error) {
      // A normally closed root may already be gone before taskkill can enumerate its tree.
      if (chrome.process.exitCode === null && chrome.process.signalCode === null) throw error;
    }
    await waitForChromeExit(chrome, timeoutMs);
    return;
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ESRCH') throw error;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ESRCH') {
        await waitForChromeExit(chrome, Math.max(1, deadline - Date.now()));
        return;
      }
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for the Chrome process tree to exit');
}

async function requestGracefulChromeShutdown(port: number): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Chrome DevTools returned HTTP ${response.status}`);
  const version = await response.json() as { webSocketDebuggerUrl?: string };
  if (!version.webSocketDebuggerUrl) throw new Error('Chrome DevTools websocket URL unavailable');
  const debuggerUrl = new URL(version.webSocketDebuggerUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(debuggerUrl.hostname) || debuggerUrl.port !== String(port)) {
    throw new Error('Chrome DevTools websocket did not resolve to the local browser');
  }

  const socket = new WebSocket(debuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('Chrome DevTools websocket connection failed')), { once: true });
  });
  socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
}

async function stopChromeAndWait(chrome: chromeLauncher.LaunchedChrome): Promise<void> {
  if (chrome.process.exitCode === null && chrome.process.signalCode === null) {
    try {
      await requestGracefulChromeShutdown(chrome.port);
      await waitForChromeExit(chrome, 10000);
    } catch {
      // Fall through to checked process-tree termination below.
    }
  }

  // Confirm the whole process tree is gone. chrome-launcher.kill() suppresses termination
  // errors, so it cannot be the sole evidence that it is safe to release the queue slot.
  await stopChromeProcessTreeAndWait(chrome, 10000);

  // chrome-launcher owns its temporary profile and signal-handler registry. Its synchronous
  // profile removal now runs only after the browser process tree has exited.
  chrome.kill();
}

export class LighthouseService {
  private async runSingleAudit(targetUrl: string, attempt: number, maxAttempts: number, onDiagnostics?: LighthouseDiagnosticsCallback): Promise<LighthouseMetrics> {
    let chrome: chromeLauncher.LaunchedChrome | null = null;
    let auditError: unknown = null;
    const navigationResponses: Array<{ url: string; status: number }> = [];
    let finalUrl: string | null = null;
    let auditStartedAt = Date.now();
    let auditDurationMs: number | null = null;
    let outcome: 'AUDIT_COMPLETED' | 'NAVIGATION_FAILED' | 'AUDIT_FAILED' = 'AUDIT_FAILED';
    let failureReason: string | null = null;
    let diagnosticsPersisted = false;

    const persistDiagnostics = async (diagnosticOutcome: typeof outcome) => {
      if (!onDiagnostics) return;
      await onDiagnostics(sanitizeLighthouseDiagnostics({
        ...createLighthouseSessionDiagnostics(targetUrl, finalUrl ?? undefined, undefined, auditDurationMs ?? 0),
        outcome: diagnosticOutcome,
        navigationResponseStatus: navigationResponses.length ? navigationResponses[navigationResponses.length - 1].status : null,
        navigationStatusObserved: navigationResponses.length > 0,
        navigationResponses,
        navigationObservationError: navigationResponses.length ? null : 'Lighthouse main-document response status unavailable',
        auditDurationMs,
        attempt,
        maxAttempts,
        failureReason,
      }));
      diagnosticsPersisted = true;
    };

    console.log(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Launching Chrome for URL: ${sanitizeDiagnosticUrl(targetUrl)}`);

    const chromePath = process.env.CHROME_PATH || chromium.executablePath();

    try {
      chrome = await chromeLauncher.launch({
        chromePath,
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
      auditStartedAt = Date.now();
      const runnerResult = await (lighthouse as any)(targetUrl, flags, config);
      auditDurationMs = Date.now() - auditStartedAt;

      if (!runnerResult || !runnerResult.lhr) {
        throw new ApiError(500, 'Lighthouse audit produced no results');
      }

      const { categories, audits } = runnerResult.lhr;
      finalUrl = runnerResult.lhr.finalDisplayedUrl ? sanitizeDiagnosticUrl(runnerResult.lhr.finalDisplayedUrl) : finalUrl;
      navigationResponses.push(...extractLighthouseNavigationResponses(
        audits,
        runnerResult.artifacts?.DevtoolsLog,
        targetUrl,
        finalUrl,
      ));
      if (navigationResponses.length) finalUrl = navigationResponses[navigationResponses.length - 1].url;
      outcome = classifyLighthouseResult(
        runnerResult.lhr.runtimeError,
        navigationResponses.length ? navigationResponses[navigationResponses.length - 1].status : null,
      );
      if (!navigationResponses.length && outcome === 'NAVIGATION_FAILED' && finalUrl) {
        const statusMatch = String(runnerResult.lhr.runtimeError?.message || '').match(/status code:\s*(\d{3})/i);
        const status = statusMatch ? Number(statusMatch[1]) : null;
        if (status !== null && status >= 100 && status <= 599) navigationResponses.push({ url: finalUrl, status });
      }
      if (runnerResult.lhr.runtimeError) failureReason = sanitizeDiagnosticMessage(runnerResult.lhr.runtimeError.message || runnerResult.lhr.runtimeError.code || 'Lighthouse runtime error');
      console.log(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Session diagnostics:`, {
        ...createLighthouseSessionDiagnostics(
          targetUrl,
          runnerResult.lhr.finalDisplayedUrl,
          runnerResult.lhr.fetchTime,
          auditDurationMs,
        ),
      });
      await persistDiagnostics(outcome);
      if (outcome !== 'AUDIT_COMPLETED') {
        throw new ApiError(outcome === 'NAVIGATION_FAILED' ? 502 : 500, outcome === 'NAVIGATION_FAILED'
          ? 'Lighthouse navigation failed'
          : 'Lighthouse audit failed');
      }

      const getScore = (catKey: string): number | null => {
        const cat = categories[catKey];
        return normalizeLighthouseCategoryScore(cat?.score);
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
    } catch (error: any) {
      auditError = error;
      auditDurationMs = auditDurationMs ?? Date.now() - auditStartedAt;
      const lastNavigationStatus = navigationResponses.length ? navigationResponses[navigationResponses.length - 1].status : null;
      outcome = classifyLighthouseFailure(error, lastNavigationStatus);
      failureReason = sanitizeDiagnosticMessage(error?.message || error);
      if (!diagnosticsPersisted) await persistDiagnostics(outcome);
      throw error;
    } finally {
      if (chrome) {
        console.log(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Cleaning up Chrome process...`);
        try {
          await stopChromeAndWait(chrome);
          console.log(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Chrome process exited and cleanup completed`);
        } catch (killErr) {
          console.error('[Lighthouse] Warning closing Chrome:', sanitizeDiagnosticMessage((killErr as any)?.message || killErr));
          if (auditError && (typeof auditError === 'object' || typeof auditError === 'function')) {
            markBrowserCleanupFailure(auditError as object);
          } else {
            outcome = 'AUDIT_FAILED';
            failureReason = 'Lighthouse Chrome process cleanup failed';
            try {
              await persistDiagnostics(outcome);
            } catch (diagnosticsError: any) {
              console.error('[Lighthouse] Failed to persist browser cleanup failure:', sanitizeDiagnosticMessage(diagnosticsError?.message || diagnosticsError));
            }
            const cleanupError = new ApiError(500, 'Lighthouse Chrome process cleanup failed');
            markBrowserCleanupFailure(cleanupError);
            throw cleanupError;
          }
        }
      }
    }
  }

  public async runAudit(targetUrl: string, onDiagnostics?: LighthouseDiagnosticsCallback): Promise<LighthouseMetrics> {
    const MAX_ATTEMPTS = 2;
    let lastError: any = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.runSingleAudit(targetUrl, attempt, MAX_ATTEMPTS, onDiagnostics);
      } catch (error: any) {
        lastError = error;
        if (isBrowserCleanupFailure(error)) {
          throw error;
        }
        const errMessage = sanitizeDiagnosticMessage(error?.message || 'Unknown Lighthouse error');
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
