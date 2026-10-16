import assert from 'assert';
import { validateTargetPage } from '../src/services/target-page-validation';

const base = {
  httpStatus: 200, finalUrl: 'https://sample.test/', title: 'Sample', bodyText: 'A real site with enough rendered content to evaluate safely.',
  readyState: 'complete', visibleElementCount: 20, hasBody: true, hasCanvasOrSvg: false, hasLoginForm: false, challengeMarkers: [],
};
function run() {
  assert.strictEqual(validateTargetPage({ ...base, httpStatus: 403, title: 'Access Denied - CloudFront', bodyText: 'Access denied. Request blocked.' }).status, 'BLOCKED');
  assert.strictEqual(validateTargetPage({ ...base, title: 'Just a moment...', bodyText: 'Checking your browser. Verify you are human.', challengeMarkers: ['div#challenge'] }).status, 'BLOCKED');
  assert.strictEqual(validateTargetPage({ ...base, title: 'Legal', bodyText: 'Our access denied policy is documented in the terms. '.repeat(20) }).status, 'VALID');
  assert.strictEqual(validateTargetPage({ ...base, httpStatus: 404 }).status, 'INCONCLUSIVE');
  assert.strictEqual(validateTargetPage({ ...base, httpStatus: 401, title: 'Sign in', bodyText: 'Sign in to continue', hasLoginForm: true }).status, 'VALID');
  assert.strictEqual(validateTargetPage({ ...base, bodyText: '', title: '', hasBody: false, visibleElementCount: 0 }).reasonCode, 'EMPTY_DOCUMENT');
  assert.strictEqual(validateTargetPage({ ...base, bodyText: '', title: '', hasBody: false, visibleElementCount: 0, navigationError: 'net::ERR_NAME_NOT_RESOLVED' }).reasonCode, 'BROWSER_NETWORK_ERROR');
  assert.strictEqual(validateTargetPage({ ...base, readyState: 'loading', bodyText: 'Partial page is visible now.', visibleElementCount: 2 }).reasonCode, 'INCOMPLETE_DOCUMENT');
  console.log('Target page validation tests passed.');
}
run();
