import process from 'process';
import { extractLighthouseNavigationResponses, sanitizeDiagnosticUrl } from './browser-diagnostics';

interface LighthouseAuditRequest {
  targetUrl: string;
  flags: Record<string, unknown>;
  config: Record<string, unknown>;
}

function getDisplayAudits(audits: Record<string, any> = {}): Record<string, { displayValue?: string }> {
  const keys = [
    'first-contentful-paint',
    'largest-contentful-paint',
    'speed-index',
    'total-blocking-time',
    'cumulative-layout-shift',
    'interactive',
  ];
  return Object.fromEntries(keys.map((key) => [key, { displayValue: audits[key]?.displayValue }]));
}

process.on('message', async (request: LighthouseAuditRequest) => {
  try {
    const lighthouseModule = await import('lighthouse');
    const lighthouse = lighthouseModule.default || lighthouseModule;
    const runnerResult = await (lighthouse as any)(request.targetUrl, request.flags, request.config);
    const lhr = runnerResult?.lhr;
    if (!lhr) throw new Error('Lighthouse audit produced no results');

    const finalDisplayedUrl = lhr.finalDisplayedUrl ? sanitizeDiagnosticUrl(lhr.finalDisplayedUrl) : null;
    const navigationResponses = extractLighthouseNavigationResponses(
      lhr.audits ?? {},
      runnerResult.artifacts?.DevtoolsLog,
      request.targetUrl,
      finalDisplayedUrl,
    );
    const runtimeError = lhr.runtimeError == null ? null : {
      name: String(lhr.runtimeError.name || 'Error'),
      code: String(lhr.runtimeError.code || ''),
      message: String(lhr.runtimeError.message || lhr.runtimeError),
      stack: typeof lhr.runtimeError.stack === 'string'
        ? lhr.runtimeError.stack.split(/\r?\n/).slice(0, 5).join('\n')
        : undefined,
    };
    const compactResult = {
      lhr: {
        categories: Object.fromEntries(
          ['performance', 'accessibility', 'best-practices', 'seo'].map((key) => [key, { score: lhr.categories?.[key]?.score ?? null }]),
        ),
        audits: getDisplayAudits(lhr.audits),
        runtimeError,
        finalDisplayedUrl,
        fetchTime: lhr.fetchTime,
      },
      navigationResponses,
    };
    process.send?.({ type: 'result', result: compactResult });
  } catch (error: any) {
    process.send?.({
      type: 'error',
      error: {
        name: String(error?.name || 'Error'),
        code: String(error?.code || ''),
        message: String(error?.message || error),
      },
    });
  } finally {
    process.disconnect?.();
  }
});
