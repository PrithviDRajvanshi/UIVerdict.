import { ApiError } from '../errors/ApiError';
import { sanitizeDiagnosticUrl } from './browser-diagnostics';

export const MAX_QUEUED_ANALYSES = 8;
export const ANALYSIS_QUEUE_WAIT_TIMEOUT_MS = 300_000;

const browserCleanupFailures = new WeakSet<object>();

export function markBrowserCleanupFailure(error: object): void {
  browserCleanupFailures.add(error);
}

export function isBrowserCleanupFailure(error: unknown): error is object {
  return (typeof error === 'object' && error !== null || typeof error === 'function')
    && browserCleanupFailures.has(error as object);
}

interface AnalysisQueueMetadata {
  analysisId: string;
  url: string;
}

interface QueueEntry<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  metadata: AnalysisQueueMetadata;
  enqueuedAt: number;
  signal?: AbortSignal;
  timeout?: NodeJS.Timeout;
  onAbort?: () => void;
}

/** Serializes the resource-heavy analysis pipeline within this Node.js process. */
export class AnalysisConcurrencyQueue {
  private active = false;
  private browserCleanupFailed = false;
  private readonly waiting: QueueEntry<any>[] = [];

  constructor(
    private readonly maxQueued = MAX_QUEUED_ANALYSES,
    private readonly waitTimeoutMs = ANALYSIS_QUEUE_WAIT_TIMEOUT_MS,
  ) {}

  public assertAvailable(): void {
    if (this.browserCleanupFailed) {
      throw this.unavailableError();
    }
  }

  public run<T>(run: () => Promise<T>, metadata: AnalysisQueueMetadata, signal?: AbortSignal): Promise<T> {
    if (this.browserCleanupFailed) {
      return Promise.reject(this.unavailableError());
    }
    if (signal?.aborted) return Promise.reject(this.cancelledError());

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry<T> = { run, resolve, reject, metadata, enqueuedAt: Date.now(), signal };
      if (!this.active && this.waiting.length === 0) {
        this.start(entry);
        return;
      }
      if (this.waiting.length >= this.maxQueued) {
        this.log('warn', '[AnalysisQueue] Queue limit reached:', this.logFields(entry));
        reject(new ApiError(503, 'Analysis queue is full; please retry shortly'));
        return;
      }

      entry.onAbort = () => this.removeWaiting(entry, this.cancelledError());
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      entry.timeout = setTimeout(() => this.removeWaiting(
        entry,
        new ApiError(503, 'Analysis queue wait timed out; please retry shortly'),
      ), this.waitTimeoutMs);
      this.waiting.push(entry);
      this.log('info', '[AnalysisQueue] Analysis queued:', {
        ...this.logFields(entry),
        queuePosition: this.waiting.length,
        maxQueued: this.maxQueued,
        waitTimeoutMs: this.waitTimeoutMs,
      });
    });
  }

  private async start<T>(entry: QueueEntry<T>): Promise<void> {
    this.active = true;
    this.clearWaitTracking(entry);
    const queueWaitMs = Date.now() - entry.enqueuedAt;
    const activeStartedAt = Date.now();
    this.log('info', '[AnalysisQueue] Analysis active:', {
      ...this.logFields(entry),
      queueWaitMs,
    });
    try {
      entry.resolve(await entry.run());
    } catch (error) {
      if (isBrowserCleanupFailure(error)) this.browserCleanupFailed = true;
      entry.reject(error);
    } finally {
      try {
        this.log('info', '[AnalysisQueue] Analysis released:', {
          ...this.logFields(entry),
          activeDurationMs: Date.now() - activeStartedAt,
        });
      } finally {
        this.active = false;
        this.startNext();
      }
    }
  }

  private startNext(): void {
    if (this.browserCleanupFailed) {
      const error = this.unavailableError();
      while (this.waiting.length) {
        const entry = this.waiting.shift()!;
        this.clearWaitTracking(entry);
        entry.reject(error);
      }
      return;
    }
    while (this.waiting.length) {
      const next = this.waiting.shift()!;
      this.clearWaitTracking(next);
      if (next.signal?.aborted) {
        next.reject(this.cancelledError());
        continue;
      }
      void this.start(next);
      return;
    }
  }

  private removeWaiting(entry: QueueEntry<any>, error: ApiError): void {
    const index = this.waiting.indexOf(entry);
    if (index < 0) return;
    this.waiting.splice(index, 1);
    this.clearWaitTracking(entry);
    this.log('warn', '[AnalysisQueue] Queued analysis not started:', {
      ...this.logFields(entry),
      queueWaitMs: Date.now() - entry.enqueuedAt,
      reason: error.message,
    });
    entry.reject(error);
  }

  private clearWaitTracking(entry: QueueEntry<any>): void {
    if (entry.timeout) clearTimeout(entry.timeout);
    if (entry.onAbort) entry.signal?.removeEventListener('abort', entry.onAbort);
    entry.timeout = undefined;
    entry.onAbort = undefined;
  }

  private cancelledError(): ApiError {
    return new ApiError(503, 'Analysis request was cancelled before processing');
  }

  private unavailableError(): ApiError {
    return new ApiError(503, 'Analysis is unavailable because browser cleanup could not be confirmed; restart the backend before retrying');
  }

  private logFields(entry: QueueEntry<any>): AnalysisQueueMetadata {
    return { analysisId: entry.metadata.analysisId, url: sanitizeDiagnosticUrl(entry.metadata.url) };
  }

  private log(level: 'info' | 'warn', ...values: unknown[]): void {
    try {
      console[level](...values);
    } catch {
      // Logging must not strand the process-wide analysis slot.
    }
  }
}
