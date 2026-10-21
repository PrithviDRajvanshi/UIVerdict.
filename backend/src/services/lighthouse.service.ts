import * as chromeLauncher from 'chrome-launcher';
import { ChildProcess, ForkOptions, execFileSync, fork } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
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
  firstContentfulPaint: string | null;
  largestContentfulPaint: string | null;
  speedIndex: string | null;
  totalBlockingTime: string | null;
  cumulativeLayoutShift: string | null;
  timeToInteractive: string | null;
}

export type LighthouseDiagnosticsCallback = (diagnostics: LighthouseDiagnosticMetadata) => Promise<void>;

const LIGHTHOUSE_AUDIT_TIMEOUT_MS = 120_000;
const CHROME_READY_RETRIES = 5;
const CHROME_READY_RETRY_DELAY_MS = 100;
const LIGHTHOUSE_MEMORY_ABORT_POLL_INTERVAL_MS = 500;
const LIGHTHOUSE_MEMORY_ABORT_CONSECUTIVE_SAMPLES = 3;
const LIGHTHOUSE_HIGH_ANON_LOG_BYTES = 400_000_000;
const LIGHTHOUSE_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
export const LIGHTHOUSE_MEMORY_SAFE_CATEGORIES = ['accessibility', 'best-practices', 'seo'];

export interface LighthouseMemoryMonitor {
  readAnonBytes: () => Promise<number | null>;
  thresholdBytes: number;
  pollIntervalMs?: number;
  onAbort?: (anonBytes: number, thresholdBytes: number) => void;
  onStop?: () => void;
}

export interface LighthouseProcessMemorySummary {
  pid: number;
  type: string;
  rssMb: number;
}

function processTypeFromCmdline(cmdline: string): string {
  const normalized = cmdline.toLowerCase();
  if (/(^|\/)node(?:\.exe)?(?:\0|\s|$)/.test(normalized)) return 'node';
  const type = normalized.match(/(?:^|\s|\0)--type=([a-z-]+)/)?.[1];
  if (type === 'gpu-process') return 'gpu';
  if (type) return type;
  if (/chrom(e|ium)/.test(normalized)) return 'browser';
  return 'other';
}

export async function readTopProcessRss(procRoot = '/proc', limit = 8): Promise<LighthouseProcessMemorySummary[]> {
  const entries = await fs.readdir(procRoot, { withFileTypes: true });
  const pids = entries.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name)).map((entry) => Number(entry.name));
  const rssByPid: Array<{ pid: number; rssBytes: number }> = [];
  for (let offset = 0; offset < pids.length; offset += 64) {
    const batch = pids.slice(offset, offset + 64);
    const values = await Promise.all(batch.map(async (pid) => {
      try {
        const status = await fs.readFile(`${procRoot}/${pid}/status`, 'utf8');
        const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
        return match ? { pid, rssBytes: Number(match[1]) * 1024 } : null;
      } catch {
        return null;
      }
    }));
    rssByPid.push(...values.filter((value): value is { pid: number; rssBytes: number } => value !== null));
  }
  rssByPid.sort((a, b) => b.rssBytes - a.rssBytes);
  const top = await Promise.all(rssByPid.slice(0, limit).map(async ({ pid, rssBytes }) => {
    try {
      const cmdline = (await fs.readFile(`${procRoot}/${pid}/cmdline`)).toString('utf8');
      return { pid, type: processTypeFromCmdline(cmdline), rssMb: Math.round((rssBytes / 1024 / 1024) * 100) / 100 };
    } catch {
      return { pid, type: 'unavailable', rssMb: Math.round((rssBytes / 1024 / 1024) * 100) / 100 };
    }
  }));
  return top;
}

async function logHighAnonProcesses(stage: string, anonBytes: number, attempt: number): Promise<void> {
  try {
    const topProcesses = await readTopProcessRss();
    const { rss, heapUsed } = process.memoryUsage();
    console.info('[Lighthouse] High-anon process snapshot:', {
      attempt,
      stage,
      anonBytes,
      topProcesses,
      nodeRssBytes: rss,
      nodeHeapUsedBytes: heapUsed,
    });
  } catch {
    // Process diagnostics are best effort and must not affect the audit.
  }
}

export async function waitForChromeDevTools(port: number): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CHROME_READY_RETRIES; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
      if (!response.ok) throw new Error(`Chrome DevTools returned HTTP ${response.status}`);
      const version = await response.json() as { webSocketDebuggerUrl?: unknown };
      if (typeof version.webSocketDebuggerUrl !== 'string' || !version.webSocketDebuggerUrl.startsWith(`ws://127.0.0.1:${port}/`)) {
        throw new Error('Chrome DevTools returned an invalid WebSocket endpoint');
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < CHROME_READY_RETRIES) await new Promise((resolve) => setTimeout(resolve, CHROME_READY_RETRY_DELAY_MS));
    }
  }
  throw new Error(`Chrome DevTools readiness failed after ${CHROME_READY_RETRIES} attempts: ${sanitizeDiagnosticMessage((lastError as any)?.message || lastError || 'unavailable')}`);
}

async function logCgroupMemorySnapshot(stage: 'before_launch' | 'after_audit' | 'after_cleanup', attempt: number): Promise<void> {
  try {
    const [currentText, statText, eventsText] = await Promise.all([
      fs.readFile('/sys/fs/cgroup/memory.current', 'utf8'),
      fs.readFile('/sys/fs/cgroup/memory.stat', 'utf8'),
      fs.readFile('/sys/fs/cgroup/memory.events', 'utf8'),
    ]);
    const readValue = (text: string, key: string): number | null => {
      const line = text.split(/\r?\n/).find((entry) => entry.startsWith(`${key} `));
      if (!line) return null;
      const value = Number(line.trim().split(/\s+/)[1]);
      return Number.isFinite(value) ? value : null;
    };
    const memoryCurrent = Number(currentText.trim());
    const anon = readValue(statText, 'anon');
    const oomKill = readValue(eventsText, 'oom_kill');
    if (!Number.isFinite(memoryCurrent) || anon === null || oomKill === null) return;
    const { rss, heapUsed } = process.memoryUsage();
    console.info('[Lighthouse] Cgroup memory snapshot:', {
      attempt,
      stage,
      memoryCurrentBytes: memoryCurrent,
      anonBytes: anon,
      oomKill,
      processRssBytes: rss,
      processHeapUsedBytes: heapUsed,
    });
  } catch {
    // cgroup v2 files may not be mounted or readable; resource diagnostics are best effort.
  }
}

function logAttemptError(error: any, attempt: number, maxAttempts: number, lhrRuntimeError: unknown): void {
  const stackLines = typeof error?.stack === 'string'
    ? error.stack.split(/\r?\n/).slice(0, 5).map((line: string) => sanitizeDiagnosticMessage(line))
    : [];
  const normalizedRuntimeError = lhrRuntimeError === null || lhrRuntimeError === undefined
    ? null
    : typeof lhrRuntimeError === 'object'
    ? {
      name: sanitizeDiagnosticMessage((lhrRuntimeError as any).name || 'Error'),
      code: sanitizeDiagnosticMessage((lhrRuntimeError as any).code || ''),
      message: sanitizeDiagnosticMessage((lhrRuntimeError as any).message || lhrRuntimeError),
      stackLines: typeof (lhrRuntimeError as any).stack === 'string'
        ? (lhrRuntimeError as any).stack.split(/\r?\n/).slice(0, 5).map((line: string) => sanitizeDiagnosticMessage(line))
        : [],
    }
    : sanitizeDiagnosticMessage(lhrRuntimeError);
  try {
    console.error('[Lighthouse] Attempt failed with underlying error:', {
      attempt,
      maxAttempts,
      name: sanitizeDiagnosticMessage(error?.name || 'Error'),
      code: sanitizeDiagnosticMessage(error?.code || ''),
      message: sanitizeDiagnosticMessage(error?.message || error),
      stackLines,
      lhrRuntimeError: normalizedRuntimeError,
    });
  } catch {
    // Diagnostic logging must not change the attempt's error or cleanup behavior.
  }
}

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

  await waitForLinuxProcessGroupExit(pid, timeoutMs);
  await waitForChromeExit(chrome, timeoutMs);
}

interface LinuxProcessGroupMember {
  pid: number;
  state: string;
  commandLine: string;
}

interface LinuxProcessGroupScan {
  members: LinuxProcessGroupMember[];
  complete: boolean;
}

async function scanLinuxProcessGroup(procRoot: string, pgid: number): Promise<LinuxProcessGroupScan> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(procRoot, { withFileTypes: true });
  } catch {
    return { members: [], complete: false };
  }

  const members: LinuxProcessGroupMember[] = [];
  let complete = true;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    let stat: string;
    try {
      stat = await fs.readFile(`${procRoot}/${entry.name}/stat`, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') complete = false;
      continue;
    }

    const commandEnd = stat.lastIndexOf(')');
    if (commandEnd < 0) {
      complete = false;
      continue;
    }
    const fields = stat.slice(commandEnd + 1).trim().split(/\s+/);
    const state = fields[0];
    const processGroup = Number(fields[2]); // stat field 5 (pgrp), after pid/comm/state/ppid.
    if (!state || !Number.isInteger(processGroup)) {
      complete = false;
      continue;
    }
    if (processGroup !== pgid) continue;

    let commandLine = '[unavailable]';
    try {
      const raw = await fs.readFile(`${procRoot}/${entry.name}/cmdline`);
      commandLine = sanitizeDiagnosticMessage(raw.toString('utf8').replace(/\0/g, ' ').trim() || '[empty]');
    } catch {
      // A process may exit between reading stat and cmdline; retain the stat evidence.
    }
    members.push({ pid, state, commandLine });
  }
  return { members, complete };
}

type ProcessGroupProbe = (pgid: number) => boolean;

export async function waitForLinuxProcessGroupExit(
  pgid: number,
  timeoutMs: number,
  procRoot = '/proc',
  groupExists: ProcessGroupProbe = (groupId) => {
    try {
      process.kill(-groupId, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ESRCH') return false;
      throw error;
    }
  },
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastScan: LinuxProcessGroupScan = { members: [], complete: false };
  while (Date.now() < deadline) {
    if (!groupExists(pgid)) return;
    lastScan = await scanLinuxProcessGroup(procRoot, pgid);
    const liveMembers = lastScan.members.filter((member) => member.state !== 'Z');
    if (lastScan.complete && liveMembers.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const survivors = lastScan.members.filter((member) => member.state !== 'Z');
  console.error('[Lighthouse] Chrome process group did not exit before timeout:', {
    processGroup: pgid,
    scanComplete: lastScan.complete,
    survivors: survivors.map(({ pid, state, commandLine }) => ({ pid, state, commandLine })),
  });
  const survivorIds = survivors.map(({ pid }) => pid).join(', ') || 'unknown';
  throw new Error(`Timed out waiting for live Chrome process group members to exit: ${survivorIds}`);
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

export async function stopChromeAndWait(
  chrome: chromeLauncher.LaunchedChrome,
  waitForProcessTree: typeof stopChromeProcessTreeAndWait = stopChromeProcessTreeAndWait,
): Promise<void> {
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
  await waitForProcessTree(chrome, 10000);

  // chrome-launcher owns its temporary profile and signal-handler registry. Its synchronous
  // profile removal now runs only after the browser process tree has exited.
  try {
    chrome.kill();
  } catch (error) {
    console.warn('[Lighthouse] Chrome process tree exited, but chrome-launcher resource cleanup failed:',
      sanitizeDiagnosticMessage((error as any)?.message || error));
  }
}

interface LighthouseServiceDependencies {
  launchChrome: typeof chromeLauncher.launch;
  runLighthouse?: (targetUrl: string, flags: Record<string, unknown>, config: Record<string, unknown>) => Promise<any>;
  forkWorker: typeof fork;
  stopChrome: typeof stopChromeAndWait;
  killChromeProcessTree: typeof stopChromeProcessTreeAndWait;
  waitForChromeReady: (port: number) => Promise<void>;
  auditTimeoutMs: number;
}

export class LighthouseService {
  private readonly dependencies: LighthouseServiceDependencies;

  constructor(dependencies: Partial<LighthouseServiceDependencies> = {}) {
    this.dependencies = {
      launchChrome: dependencies.launchChrome ?? chromeLauncher.launch,
      runLighthouse: dependencies.runLighthouse,
      forkWorker: dependencies.forkWorker ?? fork,
      stopChrome: dependencies.stopChrome ?? stopChromeAndWait,
      killChromeProcessTree: dependencies.killChromeProcessTree ?? stopChromeProcessTreeAndWait,
      waitForChromeReady: dependencies.waitForChromeReady ?? waitForChromeDevTools,
      auditTimeoutMs: dependencies.auditTimeoutMs ?? LIGHTHOUSE_AUDIT_TIMEOUT_MS,
    };
  }

  private async runLighthouseWithTimeout(
    targetUrl: string,
    flags: Record<string, unknown>,
    config: Record<string, unknown>,
    chrome: chromeLauncher.LaunchedChrome,
    signal?: AbortSignal,
  ): Promise<any> {
    let timeout: NodeJS.Timeout | undefined;
    let worker: ChildProcess | null = null;
    let audit: Promise<any>;
    if (this.dependencies.runLighthouse) {
      // Dependency injection keeps unit tests isolated; production uses the forked worker.
      audit = Promise.resolve().then(() => this.dependencies.runLighthouse!(targetUrl, flags, config));
    } else {
      let isTypeScript = __filename.endsWith('.ts');
      let workerPath = path.join(__dirname, `lighthouse-child.${isTypeScript ? 'ts' : 'js'}`);
      if (isTypeScript) {
        const compiledWorkerPath = path.resolve(__dirname, '../../dist/services/lighthouse-child.js');
        try {
          const [sourceStat, compiledStat] = await Promise.all([
            fs.stat(path.join(__dirname, 'lighthouse-child.ts')),
            fs.stat(compiledWorkerPath),
          ]);
          if (compiledStat.mtimeMs >= sourceStat.mtimeMs) {
            workerPath = compiledWorkerPath;
            isTypeScript = false;
          }
        } catch {
          // Local development may not have compiled output; ts-node handles the source worker.
        }
      }
      const execArgv = ['--max-old-space-size=256'];
      if (isTypeScript) execArgv.push('-r', 'ts-node/register/transpile-only');
      worker = this.dependencies.forkWorker(workerPath, [], {
        execArgv,
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      });
      audit = new Promise((resolve, reject) => {
        let result: any;
        let workerError: Error | null = null;
        worker!.on('message', (message: any) => {
          if (message?.type === 'result') result = message.result;
          else if (message?.type === 'error') {
            workerError = Object.assign(new Error(message.error?.message || 'Lighthouse child failed'), {
              name: message.error?.name || 'Error',
              code: message.error?.code || '',
            });
          }
        });
        worker!.once('error', reject);
        worker!.once('exit', (code, signalCode) => {
          if (workerError) reject(workerError);
          else if (result !== undefined && code === 0) resolve(result);
          else reject(new Error(`Lighthouse child exited without a result (code=${code}, signal=${signalCode})`));
        });
        worker!.send({ targetUrl, flags, config }, (error) => {
          if (error) reject(error);
        });
      });
    }

    const terminateWorkerAndWait = async (): Promise<void> => {
      if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
      const exited = new Promise<void>((resolve) => worker!.once('exit', () => resolve()));
      worker.kill('SIGKILL');
      // A false return can race with a process that is already exiting; the
      // exit wait below is the authoritative cleanup confirmation.
      let timeoutHandle: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          exited,
          new Promise<never>((_resolve, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error('Timed out waiting for Lighthouse child process to exit')), 10000);
          }),
        ]);
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    };
    const terminateResources = async (originalError: object, stage: 'timeout' | 'abort'): Promise<void> => {
      const results = await Promise.allSettled([
        terminateWorkerAndWait(),
        this.dependencies.killChromeProcessTree(chrome, 10000),
      ]);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (!failures.length) return;
      markBrowserCleanupFailure(originalError);
      for (const failure of failures) {
        try {
          console.error(`[Lighthouse] Failed to confirm browser cleanup after audit ${stage}:`,
            sanitizeDiagnosticMessage((failure.reason as any)?.message || failure.reason));
        } catch {
          // Preserve the original timeout or abort error.
        }
      }
    };
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(async () => {
        const timeoutError = new ApiError(504, `Lighthouse audit exceeded ${this.dependencies.auditTimeoutMs}ms timeout`);
        try {
          console.error('[Lighthouse] Audit timed out; terminating Chrome process tree:', {
            timeoutMs: this.dependencies.auditTimeoutMs,
          });
        } catch {
          // Logging must not prevent the timeout from terminating Chrome.
        }
        await terminateResources(timeoutError, 'timeout');
        reject(timeoutError);
      }, this.dependencies.auditTimeoutMs);
    });

    let abortListener: (() => void) | undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      const rejectAfterCleanup = async () => {
        const reason = typeof signal?.reason === 'string' ? signal.reason : 'cancelled';
        const abortError = new ApiError(503, `Lighthouse audit aborted: ${reason}`);
        (abortError as ApiError & { lighthouseAbort?: boolean }).lighthouseAbort = true;
        await terminateResources(abortError, 'abort');
        reject(abortError);
      };
      abortListener = () => { void rejectAfterCleanup(); };
      if (signal?.aborted) abortListener();
      else signal?.addEventListener('abort', abortListener, { once: true });
    });

    try {
      // Killing Chrome can make Lighthouse reject first with ConnectionClosedError.
      // If the caller already aborted, wait for process cleanup and preserve the
      // abort marker so runAudit does not mistake this for a retryable audit error.
      const abortAwareAudit = audit.catch(async (error) => {
        if (signal?.aborted) {
          try {
            await abortPromise;
          } catch (abortError) {
            throw abortError;
          }
        }
        throw error;
      });
      return await Promise.race([abortAwareAudit, timeoutPromise, abortPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (abortListener) signal?.removeEventListener('abort', abortListener);
    }
  }

  private async runSingleAudit(
    targetUrl: string,
    attempt: number,
    maxAttempts: number,
    onDiagnostics?: LighthouseDiagnosticsCallback,
    signal?: AbortSignal,
    onlyCategories: string[] = LIGHTHOUSE_CATEGORIES,
  ): Promise<LighthouseMetrics> {
    let chrome: chromeLauncher.LaunchedChrome | null = null;
    let auditError: unknown = null;
    let lhrRuntimeError: unknown = null;
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
      await logCgroupMemorySnapshot('before_launch', attempt);
      chrome = await this.dependencies.launchChrome({
        chromePath,
        chromeFlags: [
          '--headless=new',
          '--no-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-software-rasterizer',
          '--mute-audio',
          '--no-first-run',
          '--renderer-process-limit=1',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-component-update',
          '--js-flags=--max-old-space-size=192',
        ],
      });

      console.log(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Dedicated Chrome listening on port ${chrome.port}`);

      try {
        await this.dependencies.waitForChromeReady(chrome.port);
      } catch (readinessError) {
        try {
          console.error(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Chrome DevTools readiness failed:`, {
            port: chrome.port,
            pid: chrome.process.pid ?? null,
            name: sanitizeDiagnosticMessage((readinessError as any)?.name || 'Error'),
            message: sanitizeDiagnosticMessage((readinessError as any)?.message || readinessError),
          });
        } catch {
          // Readiness diagnostics must not replace the connection error.
        }
        throw readinessError;
      }
      if (signal?.aborted) {
        const reason = typeof signal.reason === 'string' ? signal.reason : 'cancelled';
        const abortError = new ApiError(503, `Lighthouse audit aborted: ${reason}`) as ApiError & { lighthouseAbort?: boolean };
        abortError.lighthouseAbort = true;
        throw abortError;
      }

      const flags = {
        logLevel: 'error' as const,
        output: 'json' as const,
        onlyCategories,
        port: chrome.port,
      };

      const config = {
        extends: 'lighthouse:default',
        settings: {
          maxWaitForFcp: 45000,
          maxWaitForLoad: 60000,
          disableFullPageScreenshot: true,
          skipAudits: ['screenshot-thumbnails'],
        },
      };

      console.log(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Running audit with categories: ${onlyCategories.join(', ')}`);
      auditStartedAt = Date.now();
      let metrics: LighthouseMetrics;
      try {
        metrics = await (async (): Promise<LighthouseMetrics> => {
          const runnerResult = await this.runLighthouseWithTimeout(targetUrl, flags, config, chrome!, signal);
          auditDurationMs = Date.now() - auditStartedAt;

          if (!runnerResult || !runnerResult.lhr) {
            throw new ApiError(500, 'Lighthouse audit produced no results');
          }

          const lhr = runnerResult.lhr;
          const runtimeError = lhr.runtimeError;
          lhrRuntimeError = runtimeError == null ? null : {
            name: sanitizeDiagnosticMessage(runtimeError.name || 'Error'),
            code: sanitizeDiagnosticMessage(runtimeError.code || ''),
            message: sanitizeDiagnosticMessage(runtimeError.message || runtimeError),
            stack: typeof runtimeError.stack === 'string'
              ? runtimeError.stack.split(/\r?\n/).slice(0, 5).map((line: string) => sanitizeDiagnosticMessage(line)).join('\n')
              : undefined,
          };
          const categories = lhr.categories ?? {};
          const audits = lhr.audits ?? {};
          const displayedUrl = lhr.finalDisplayedUrl ? sanitizeDiagnosticUrl(lhr.finalDisplayedUrl) : finalUrl;
          finalUrl = displayedUrl ?? null;
          if (Array.isArray(runnerResult.navigationResponses)) {
            navigationResponses.push(...runnerResult.navigationResponses);
          } else {
            navigationResponses.push(...extractLighthouseNavigationResponses(
              audits,
              runnerResult.artifacts?.DevtoolsLog,
              targetUrl,
              finalUrl,
            ));
          }
          if (navigationResponses.length) finalUrl = navigationResponses[navigationResponses.length - 1].url;
          outcome = classifyLighthouseResult(
            runtimeError,
            navigationResponses.length ? navigationResponses[navigationResponses.length - 1].status : null,
          );
          if (!navigationResponses.length && outcome === 'NAVIGATION_FAILED' && finalUrl) {
            const statusMatch = String(runtimeError?.message || '').match(/status code:\s*(\d{3})/i);
            const status = statusMatch ? Number(statusMatch[1]) : null;
            if (status !== null && status >= 100 && status <= 599) navigationResponses.push({ url: finalUrl, status });
          }
          if (runtimeError) failureReason = sanitizeDiagnosticMessage(runtimeError.message || runtimeError.code || 'Lighthouse runtime error');
          console.log(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Session diagnostics:`, {
            ...createLighthouseSessionDiagnostics(
              targetUrl,
              displayedUrl ?? undefined,
              lhr.fetchTime,
              auditDurationMs,
            ),
          });
          await persistDiagnostics(outcome);
          if (outcome !== 'AUDIT_COMPLETED') {
            throw new ApiError(outcome === 'NAVIGATION_FAILED' ? 502 : 500, outcome === 'NAVIGATION_FAILED'
              ? 'Lighthouse navigation failed'
              : 'Lighthouse audit failed');
          }

          const getScore = (catKey: string): number | null => normalizeLighthouseCategoryScore(categories[catKey]?.score);
          const getDisplayValue = (auditKey: string): string => audits[auditKey]?.displayValue || 'N/A';
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
        })();
      } finally {
        await logCgroupMemorySnapshot('after_audit', attempt);
      }

      console.log(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Completed successfully with performance score ${metrics.performance}`);
      return metrics;
    } catch (error: any) {
      // Chrome may close the DevTools connection before the abort promise wins
      // the race. The monitor's per-attempt signal is authoritative here.
      if (signal?.aborted && /memory limit/i.test(String(signal.reason ?? '')) && !isBrowserCleanupFailure(error)) {
        const memoryAbort = new ApiError(503, 'Lighthouse audit aborted: memory limit') as ApiError & { lighthouseAbort?: boolean };
        memoryAbort.lighthouseAbort = true;
        error = memoryAbort;
      }
      auditError = error;
      logAttemptError(error, attempt, maxAttempts, lhrRuntimeError);
      auditDurationMs = auditDurationMs ?? Date.now() - auditStartedAt;
      const lastNavigationStatus = navigationResponses.length ? navigationResponses[navigationResponses.length - 1].status : null;
      outcome = classifyLighthouseFailure(error, lastNavigationStatus);
      failureReason = sanitizeDiagnosticMessage(error?.message || error);
      if (!diagnosticsPersisted) {
        try {
          await persistDiagnostics(outcome);
        } catch (diagnosticsError: any) {
          try {
            console.error('[Lighthouse] Failed to persist diagnostics without replacing the audit error:',
              sanitizeDiagnosticMessage(diagnosticsError?.message || diagnosticsError));
          } catch {
            // Diagnostics and their logging must not replace the original audit error.
          }
        }
      }
      throw error;
    } finally {
      try {
        if (chrome) {
          console.log(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Cleaning up Chrome process...`);
          try {
            await this.dependencies.stopChrome(chrome);
            console.log(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Chrome process exited and cleanup completed`, {
              pid: chrome.process.pid ?? null,
              exitCode: chrome.process.exitCode,
              signalCode: chrome.process.signalCode,
              killed: chrome.process.killed,
            });
          } catch (killErr) {
            const cleanupError = new ApiError(500, 'Lighthouse Chrome process cleanup failed');
            const propagatedError = auditError && (typeof auditError === 'object' || typeof auditError === 'function')
              ? auditError as object
              : cleanupError;
            markBrowserCleanupFailure(propagatedError);
            try {
              console.error('[Lighthouse] Warning closing Chrome:', sanitizeDiagnosticMessage((killErr as any)?.message || killErr));
              console.error(`[Lighthouse] Attempt ${attempt}/${maxAttempts}: Chrome exit state after cleanup failure:`, {
                pid: chrome.process.pid ?? null,
                exitCode: chrome.process.exitCode,
                signalCode: chrome.process.signalCode,
                killed: chrome.process.killed,
              });
            } catch {
              // The propagated error has already been marked for fail-closed handling.
            }
            if (propagatedError === cleanupError) {
              outcome = 'AUDIT_FAILED';
              failureReason = 'Lighthouse Chrome process cleanup failed';
              try {
                await persistDiagnostics(outcome);
              } catch (diagnosticsError: any) {
                try {
                  console.error('[Lighthouse] Failed to persist browser cleanup failure:', sanitizeDiagnosticMessage(diagnosticsError?.message || diagnosticsError));
                } catch {
                  // Keep the marked cleanup error as the propagated failure.
                }
              }
              throw cleanupError;
            }
          }
        }
      } finally {
        await logCgroupMemorySnapshot('after_cleanup', attempt);
      }
    }
  }

  private async runAttemptWithMonitor(
    targetUrl: string,
    attempt: number,
    maxAttempts: number,
    onDiagnostics: LighthouseDiagnosticsCallback | undefined,
    externalSignal: AbortSignal | undefined,
    onlyCategories: string[],
    memoryMonitor?: LighthouseMemoryMonitor,
  ): Promise<LighthouseMetrics> {
    const attemptController = new AbortController();
    const forwardExternalAbort = () => attemptController.abort(externalSignal?.reason ?? 'request cancelled');
    if (externalSignal?.aborted) forwardExternalAbort();
    else externalSignal?.addEventListener('abort', forwardExternalAbort, { once: true });

    let stopped = false;
    let resolveStopped!: () => void;
    const stoppedPromise = new Promise<void>((resolve) => { resolveStopped = resolve; });
    let timer: NodeJS.Timeout | undefined;
    let wakePoller: (() => void) | undefined;
    let lastHighAnonLogAt = 0;
    const pollIntervalMs = memoryMonitor?.pollIntervalMs ?? LIGHTHOUSE_MEMORY_ABORT_POLL_INTERVAL_MS;
    let consecutiveAboveThresholdSamples = 0;
    const poller = memoryMonitor ? (async () => {
      while (!stopped && !attemptController.signal.aborted) {
        await new Promise<void>((resolve) => {
          let done = false;
          const wake = () => {
            if (done) return;
            done = true;
            wakePoller = undefined;
            resolve();
          };
          wakePoller = wake;
          timer = setTimeout(wake, pollIntervalMs);
        });
        if (stopped || attemptController.signal.aborted) return;
        let anonBytes: number | null = null;
        try {
          const readPromise = memoryMonitor.readAnonBytes();
          const result = await Promise.race([readPromise.then((value) => ({ value })), stoppedPromise.then(() => null)]);
          if (result === null) return;
          anonBytes = result.value;
        } catch {
          // Cgroup data is best-effort; unreadable snapshots are skipped silently.
        }
        if (!stopped) {
          consecutiveAboveThresholdSamples = anonBytes !== null && anonBytes > memoryMonitor.thresholdBytes
            ? consecutiveAboveThresholdSamples + 1
            : 0;
          if (consecutiveAboveThresholdSamples >= LIGHTHOUSE_MEMORY_ABORT_CONSECUTIVE_SAMPLES) {
            if (anonBytes !== null) await logHighAnonProcesses('memory_abort', anonBytes, attempt);
            try {
              memoryMonitor.onAbort?.(anonBytes!, memoryMonitor.thresholdBytes);
            } catch {
              // Logging hooks must not prevent the abort.
            }
            attemptController.abort('memory limit');
            return;
          }
          if (anonBytes !== null && anonBytes > LIGHTHOUSE_HIGH_ANON_LOG_BYTES) {
            const now = Date.now();
            if (now - lastHighAnonLogAt >= 1000) {
              lastHighAnonLogAt = now;
              await logHighAnonProcesses('audit_high_anon', anonBytes, attempt);
            }
          }
        }
      }
    })() : Promise.resolve();

    try {
      return await this.runSingleAudit(targetUrl, attempt, maxAttempts, onDiagnostics, attemptController.signal, onlyCategories);
    } finally {
      stopped = true;
      resolveStopped();
      if (timer) clearTimeout(timer);
      wakePoller?.();
      externalSignal?.removeEventListener('abort', forwardExternalAbort);
      await poller;
      try {
        memoryMonitor?.onStop?.();
      } catch {
        // Monitoring cleanup must not mask the audit result or failure.
      }
    }
  }

  public async runAudit(
    targetUrl: string,
    onDiagnostics?: LighthouseDiagnosticsCallback,
    signal?: AbortSignal,
    retrySignal?: AbortSignal,
    initialCategories: string[] = LIGHTHOUSE_CATEGORIES,
    memoryMonitor?: LighthouseMemoryMonitor,
  ): Promise<LighthouseMetrics> {
    const MAX_ATTEMPTS = 2;
    let lastError: any = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.runAttemptWithMonitor(targetUrl, attempt, MAX_ATTEMPTS, onDiagnostics, signal, initialCategories, memoryMonitor);
      } catch (error: any) {
        lastError = error;
        if (isBrowserCleanupFailure(error) || (error instanceof ApiError && error.statusCode === 504)) {
          throw error;
        }
        if (error?.lighthouseAbort === true) {
          if (/memory limit/i.test(String(error.message || ''))) {
            if (!initialCategories.includes('performance')) throw error;
            console.warn('[Lighthouse] Retrying once without the performance category after a memory abort');
            const retryExternalSignal = retrySignal ?? (signal?.aborted && /memory limit/i.test(String(signal.reason ?? '')) ? undefined : signal);
            return this.runAttemptWithMonitor(targetUrl, 1, 1, onDiagnostics, retryExternalSignal, LIGHTHOUSE_MEMORY_SAFE_CATEGORIES, memoryMonitor);
          }
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
