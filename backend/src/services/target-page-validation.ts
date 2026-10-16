export type TargetPageStatus = 'VALID' | 'BLOCKED' | 'INCONCLUSIVE';

export type TargetPageReasonCode =
  | 'CDN_ACCESS_DENIED'
  | 'BOT_CHALLENGE'
  | 'BROWSER_NETWORK_ERROR'
  | 'HTTP_ERROR_STATUS'
  | 'EMPTY_DOCUMENT'
  | 'INCOMPLETE_DOCUMENT';

export interface TargetPageSignals {
  httpStatus: number | null;
  finalUrl: string;
  title: string;
  bodyText: string;
  readyState: string;
  visibleElementCount: number;
  hasBody: boolean;
  hasCanvasOrSvg: boolean;
  hasLoginForm: boolean;
  challengeMarkers: string[];
  navigationError?: string | null;
  browserErrorPage?: boolean;
}

export interface TargetPageValidation {
  status: TargetPageStatus;
  reasonCode: TargetPageReasonCode | null;
  reason: string | null;
}

export class TargetPageValidationError extends Error {
  constructor(public readonly validation: TargetPageValidation) {
    super(validation.reason ?? 'Target page could not be evaluated.');
    this.name = 'TargetPageValidationError';
  }
}

const denialText = /access denied|request blocked|your request (?:has been )?blocked|request could not be satisfied|temporarily blocked|not authorized to access/i;
const challengeText = /verify (?:that )?you are human|checking your browser|security verification|complete (?:the )?security check|unusual traffic|automated requests|captcha|just a moment/i;
const edgeProviderText = /cloudflare|cloudfront|akamai|imperva|incapsula|sucuri|datadome|perimeterx|fastly/i;
const browserErrorText = /this site can.t be reached|webpage is not available|err_(?:name_not_resolved|connection_[a-z_]+|internet_disconnected|network_access_denied|timed_out|address_unreachable)/i;
const networkNavigationError = /net::ERR_(?:NAME_NOT_RESOLVED|CONNECTION_[A-Z_]+|INTERNET_DISCONNECTED|NETWORK_ACCESS_DENIED|TIMED_OUT|ADDRESS_UNREACHABLE)|ECONN(?:REFUSED|RESET|TIMEDOUT)|ENOTFOUND/i;

/** Classifies the rendered document conservatively; text alone never proves a block. */
export function validateTargetPage(signals: TargetPageSignals): TargetPageValidation {
  const title = signals.title.trim();
  const text = signals.bodyText.trim();
  const shortInterstitial = text.length <= 4000;
  const explicitDenial = denialText.test(`${title}\n${text}`);
  const challenge = challengeText.test(`${title}\n${text}`);
  const edgeProvider = edgeProviderText.test(`${title}\n${text}`);
  const hasStrongChallengeMarker = signals.challengeMarkers.length > 0;

  if ((signals.browserErrorPage || browserErrorText.test(`${title}\n${text}`) || networkNavigationError.test(signals.navigationError ?? '')) && text.length < 2000) {
    return { status: 'INCONCLUSIVE', reasonCode: 'BROWSER_NETWORK_ERROR', reason: 'The browser could not load the target page.' };
  }

  const loginPage = signals.hasLoginForm && /sign[ -]?in|log[ -]?in|authenticate/i.test(`${title}\n${text}`);
  if ((challenge && (hasStrongChallengeMarker || (shortInterstitial && title.length > 0 && /challenge|verification|just a moment|security check/i.test(title)))) ||
      (explicitDenial && shortInterstitial && (edgeProvider || signals.httpStatus === 403 || signals.httpStatus === 429))) {
    const reasonCode = challenge ? 'BOT_CHALLENGE' : 'CDN_ACCESS_DENIED';
    return {
      status: 'BLOCKED',
      reasonCode,
      reason: reasonCode === 'BOT_CHALLENGE'
        ? 'The target returned a bot or human-verification challenge.'
        : 'The target or its edge service denied access to the page.',
    };
  }

  if (signals.httpStatus !== null && signals.httpStatus >= 400 && !loginPage) {
    return { status: 'INCONCLUSIVE', reasonCode: 'HTTP_ERROR_STATUS', reason: `The target returned HTTP ${signals.httpStatus}; its intended page could not be confirmed.` };
  }

  if (!signals.hasBody || (text.length < 20 && signals.visibleElementCount < 2 && !signals.hasCanvasOrSvg)) {
    return { status: 'INCONCLUSIVE', reasonCode: 'EMPTY_DOCUMENT', reason: 'The target rendered an empty or unusable document.' };
  }

  if (signals.readyState === 'loading' && text.length < 50 && signals.visibleElementCount < 3) {
    return { status: 'INCONCLUSIVE', reasonCode: 'INCOMPLETE_DOCUMENT', reason: 'The target document did not finish rendering enough content to evaluate.' };
  }

  return { status: 'VALID', reasonCode: null, reason: null };
}
