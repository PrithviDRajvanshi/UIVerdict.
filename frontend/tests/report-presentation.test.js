import assert from 'node:assert/strict';
import { getReportPresentation } from '../src/services/report-presentation.js';

const blocked = getReportPresentation('BLOCKED', 'UNAVAILABLE');
assert.equal(blocked.validated, false);
assert.equal(blocked.scoresAvailable, false);
assert.equal(blocked.retryAvailable, true);
assert.match(blocked.targetMessage, /prevented the analyzer/);

const inconclusive = getReportPresentation('INCONCLUSIVE', 'UNAVAILABLE');
assert.equal(inconclusive.scoresAvailable, false);
assert.equal(inconclusive.retryAvailable, true);

const aiUnavailable = getReportPresentation('COMPLETED', 'UNAVAILABLE');
assert.equal(aiUnavailable.validated, true);
assert.equal(aiUnavailable.scoresAvailable, true);
assert.equal(aiUnavailable.aiUnavailable, true);
assert.equal(aiUnavailable.retryAvailable, false);

const complete = getReportPresentation('COMPLETED', 'AVAILABLE');
assert.equal(complete.aiUnavailable, false);
assert.equal(complete.scoresAvailable, true);

console.log('Frontend report state tests passed.');
