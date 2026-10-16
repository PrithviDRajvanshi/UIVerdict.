export const MAX_DIAGNOSTIC_EVENTS = 20;
export const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 240;
export const DIAGNOSTIC_SCHEMA_VERSION = 1;

export type DiagnosticOutcome = 'CAPTURED' | 'NAVIGATION_TIMEOUT_USABLE_STATE' | 'NAVIGATION_FAILED' | 'CAPTURE_FAILED' | 'AUDIT_COMPLETED' | 'AUDIT_FAILED';
export type LighthouseAuditOutcome = 'AUDIT_COMPLETED' | 'NAVIGATION_FAILED' | 'AUDIT_FAILED';

export function classifyLighthouseFailure(error: any, navigationResponseStatus: number | null): LighthouseAuditOutcome {
  const errorCode = String(error?.code || error?.name || '');
  const recognizedNavigationFailure = /NO_DOCUMENT_REQUEST|FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS_FAILURE|INSECURE_DOCUMENT_REQUEST|CHROME_INTERSTITIAL_ERROR|NOT_HTML|PAGE_HUNG/i.test(errorCode);
  return recognizedNavigationFailure || (navigationResponseStatus !== null && navigationResponseStatus >= 400)
    ? 'NAVIGATION_FAILED'
    : 'AUDIT_FAILED';
}

export function classifyLighthouseResult(runtimeError: unknown, navigationResponseStatus: number | null = null): LighthouseAuditOutcome {
  if (!runtimeError && (navigationResponseStatus === null || navigationResponseStatus < 400)) return 'AUDIT_COMPLETED';
  return classifyLighthouseFailure(runtimeError, navigationResponseStatus);
}

export function extractLighthouseNavigationResponses(
  audits: any,
  devtoolsLog: any,
  requestedUrl: string,
  finalUrl: string | null,
): Array<{ url: string; status: number }> {
  const events = Array.isArray(devtoolsLog) ? devtoolsLog : [];
  const mainFrameIds = new Set<string>();
  for (const event of events) {
    if (event?.method === 'Page.frameNavigated' && event.params?.frame && !event.params.frame.parentId) {
      mainFrameIds.add(event.params.frame.id);
    }
  }
  const expectedUrls = new Set([sanitizeDiagnosticUrl(requestedUrl), ...(finalUrl ? [sanitizeDiagnosticUrl(finalUrl)] : [])]);
  const networkResponses: Array<{ url: string; status: number }> = [];
  for (const event of events) {
    if (event?.method === 'Network.requestWillBeSent' && event.params?.type === 'Document' && event.params?.redirectResponse) {
      const redirect = event.params.redirectResponse;
      const isMainFrame = mainFrameIds.has(event.params.frameId) || expectedUrls.has(sanitizeDiagnosticUrl(redirect.url));
      const status = safeStatus(redirect.status);
      if (isMainFrame && status !== null) appendBounded(networkResponses, { url: sanitizeDiagnosticUrl(redirect.url), status });
    }
    if (event?.method === 'Network.responseReceived' && event.params?.type === 'Document') {
      const response = event.params.response;
      const isMainFrame = mainFrameIds.has(event.params.frameId) || expectedUrls.has(sanitizeDiagnosticUrl(response?.url));
      const status = safeStatus(response?.status);
      if (isMainFrame && status !== null) appendBounded(networkResponses, { url: sanitizeDiagnosticUrl(response.url), status });
    }
  }
  if (networkResponses.length) return networkResponses;

  const items = audits?.['network-requests']?.details?.items;
  const validItems = Array.isArray(items) ? items.filter((item: any) =>
    item?.resourceType === 'Document' && safeStatus(item?.statusCode) !== null && typeof item?.url === 'string') : [];
  const mainFrameItems = validItems.filter((item: any) => item.experimentalFromMainFrame === true);
  const candidateItems = mainFrameItems.length ? mainFrameItems : validItems.filter((item: any) =>
    finalUrl && sanitizeDiagnosticUrl(item.url) === finalUrl);
  const responses = boundedEvents(candidateItems, (item) => ({
    url: sanitizeDiagnosticUrl(item.url),
    status: safeStatus(item.statusCode) as number,
  }));
  if (responses.length) return responses;

  const auditStatus = safeStatus(Number.parseInt(String(audits?.['http-status-code']?.displayValue ?? ''), 10));
  return auditStatus !== null && finalUrl ? [{ url: finalUrl, status: auditStatus }] : [];
}

export interface PlaywrightDiagnosticMetadata {
  version: number;
  outcome: DiagnosticOutcome;
  requestedUrl: string;
  finalUrl: string | null;
  titleLength: number | null;
  readyState: string | null;
  bodyTextLength: number | null;
  visibleElementCount: number | null;
  imageCount: number | null;
  buttonCount: number | null;
  navigationDurationMs: number | null;
  navigationTimedOut: boolean;
  navigationError: string | null;
  settlingDelayMs: number | null;
  screenshotStartedAt: string | null;
  screenshotDurationMs: number | null;
  screenshotCompletedAt: string | null;
  mainFrameNavigations: string[];
  navigationResponses: Array<{ url: string; status: number }>;
  httpErrorResponses: Array<{ url: string; status: number }>;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: Array<{ url: string; reason: string }>;
}

export interface LighthouseDiagnosticMetadata {
  version: number;
  outcome: LighthouseAuditOutcome;
  requestedUrl: string;
  finalUrl: string | null;
  navigationResponseStatus: number | null;
  navigationStatusObserved: boolean;
  navigationResponses: Array<{ url: string; status: number }>;
  navigationObservationError: string | null;
  auditDurationMs: number | null;
  fetchTime: string | null;
  attempt: number;
  maxAttempts: number;
  failureReason: string | null;
}

/** Removes URL credentials, query strings, and fragments before diagnostics are logged. */
export function sanitizeDiagnosticUrl(value: string): string {
  if (value === '[non-http-url]' || value === '[invalid-url]') return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '[non-http-url]';
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '[invalid-url]';
  }
}

/** Redacts common secret assignments and strips URL query strings from event messages. */
export function sanitizeDiagnosticMessage(value: unknown): string {
  const message = String(value ?? '');
  return message
    .replace(/\bauthorization\b\s*[:=]\s*(?:(?:bearer|basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, 'authorization=[redacted]')
    .replace(/\b(cookie|set-cookie|password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[redacted-api-key]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-access-key]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, (rawUrl) => {
      const trailing = rawUrl.match(/[),.;]+$/)?.[0] ?? '';
      const candidate = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
      return sanitizeDiagnosticUrl(candidate) + trailing;
    })
    .slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH);
}

export function appendBounded<T>(events: T[], event: T): void {
  if (events.length < MAX_DIAGNOSTIC_EVENTS) events.push(event);
}

export function createLighthouseSessionDiagnostics(
  requestedUrl: string,
  finalUrl: string | undefined,
  fetchTime: string | undefined,
  auditDurationMs: number,
) {
  return {
    requestedUrl: sanitizeDiagnosticUrl(requestedUrl),
    finalUrl: sanitizeDiagnosticUrl(finalUrl || requestedUrl),
    fetchTime: fetchTime ?? null,
    auditDurationMs,
  };
}

function boundedEvents<T>(value: unknown, map: (item: any) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_DIAGNOSTIC_EVENTS).map(map).filter((item): item is T => item !== null);
}

function safeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function safeStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function safeUrlStatusEvents(value: unknown): Array<{ url: string; status: number }> {
  return boundedEvents(value, (item) => {
    const status = safeStatus(item?.status);
    return typeof item?.url === 'string' && status !== null
      ? { url: sanitizeDiagnosticUrl(item.url), status }
      : null;
  });
}

export function sanitizePlaywrightDiagnostics(input: any): PlaywrightDiagnosticMetadata {
  const page = input?.page ?? {
    finalUrl: input?.finalUrl,
    titleLength: input?.titleLength,
    readyState: input?.readyState,
    bodyTextLength: input?.bodyTextLength,
    visibleElementCount: input?.visibleElementCount,
    imageCount: input?.imageCount,
    buttonCount: input?.buttonCount,
  };
  const events = input?.browserEvents ?? input ?? {};
  const strings = (value: unknown) => boundedEvents(value, (item) => typeof item === 'string' ? sanitizeDiagnosticMessage(item) : null);
  return {
    version: DIAGNOSTIC_SCHEMA_VERSION,
    outcome: input?.outcome === 'NAVIGATION_FAILED' || input?.outcome === 'NAVIGATION_TIMEOUT_USABLE_STATE' || input?.outcome === 'CAPTURE_FAILED'
      ? input.outcome : 'CAPTURED',
    requestedUrl: sanitizeDiagnosticUrl(String(input?.requestedUrl ?? '')),
    finalUrl: typeof page.finalUrl === 'string' ? sanitizeDiagnosticUrl(page.finalUrl) : null,
    titleLength: safeCount(page.titleLength) ?? (page.title === undefined ? null : String(page.title).length),
    readyState: ['loading', 'interactive', 'complete'].includes(page.readyState) ? page.readyState : null,
    bodyTextLength: safeCount(page.bodyTextLength),
    visibleElementCount: safeCount(page.visibleElementCount),
    imageCount: safeCount(page.imageCount),
    buttonCount: safeCount(page.buttonCount),
    navigationDurationMs: safeCount(input?.navigationDurationMs),
    navigationTimedOut: input?.navigationTimedOut === true,
    navigationError: input?.navigationError ? sanitizeDiagnosticMessage(input.navigationError) : null,
    settlingDelayMs: safeCount(input?.settlingDelayMs),
    screenshotStartedAt: typeof input?.screenshotStartedAt === 'string' ? input.screenshotStartedAt.slice(0, 40) : null,
    screenshotDurationMs: safeCount(input?.screenshotDurationMs),
    screenshotCompletedAt: typeof input?.screenshotCompletedAt === 'string' ? input.screenshotCompletedAt.slice(0, 40) : null,
    mainFrameNavigations: boundedEvents(events.mainFrameNavigations, (url) => typeof url === 'string' ? sanitizeDiagnosticUrl(url) : null),
    navigationResponses: safeUrlStatusEvents(events.navigationResponses),
    httpErrorResponses: safeUrlStatusEvents(events.httpErrorResponses),
    consoleErrors: strings(events.consoleErrors),
    pageErrors: strings(events.pageErrors),
    failedRequests: boundedEvents(events.failedRequests, (item) => typeof item?.url === 'string'
      ? { url: sanitizeDiagnosticUrl(item.url), reason: sanitizeDiagnosticMessage(item.reason ?? 'unknown') }
      : null),
  };
}

export function sanitizeLighthouseDiagnostics(input: any): LighthouseDiagnosticMetadata {
  const outcome = input?.outcome === 'NAVIGATION_FAILED' || input?.outcome === 'AUDIT_FAILED'
    ? input.outcome : 'AUDIT_COMPLETED';
  return {
    version: DIAGNOSTIC_SCHEMA_VERSION,
    outcome,
    requestedUrl: sanitizeDiagnosticUrl(String(input?.requestedUrl ?? '')),
    finalUrl: typeof input?.finalUrl === 'string' ? sanitizeDiagnosticUrl(input.finalUrl) : null,
    navigationResponseStatus: safeStatus(input?.navigationResponseStatus),
    navigationStatusObserved: input?.navigationStatusObserved === true,
    navigationResponses: safeUrlStatusEvents(input?.navigationResponses),
    navigationObservationError: input?.navigationObservationError ? sanitizeDiagnosticMessage(input.navigationObservationError) : null,
    auditDurationMs: safeCount(input?.auditDurationMs),
    fetchTime: typeof input?.fetchTime === 'string' ? input.fetchTime.slice(0, 40) : null,
    attempt: safeCount(input?.attempt) ?? 1,
    maxAttempts: safeCount(input?.maxAttempts) ?? 1,
    failureReason: input?.failureReason ? sanitizeDiagnosticMessage(input.failureReason) : null,
  };
}
