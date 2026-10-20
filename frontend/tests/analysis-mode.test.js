import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_ANALYSIS_MODE, OVERALL_MODE_ENABLED, OVERALL_MODE_TOOLTIP } from '../src/services/analysis-mode.js';

assert.equal(DEFAULT_ANALYSIS_MODE, 'visual');
assert.equal(OVERALL_MODE_ENABLED, false, 'overall mode remains disabled');
assert.match(OVERALL_MODE_TOOLTIP, /needs more memory.*current server allows.*coming soon/i);
const heroForm = await readFile(new URL('../src/components/hero/UrlSearchForm.tsx', import.meta.url), 'utf8');
assert.match(heroForm, /disabled=\{!OVERALL_MODE_ENABLED\}/, 'the overall button is disabled from the tested mode flag');
assert.match(heroForm, /VISUAL[\s\S]*TECHNICAL[\s\S]*OVERALL/, 'the horizontal selector offers the three requested labels');
assert.match(heroForm, /new URLSearchParams\(\{ url: validUrl, mode \}\)/, 'selected mode survives a reload of the analysis route');
const reportPage = await readFile(new URL('../src/pages/Report/ReportPage.tsx', import.meta.url), 'utf8');
assert.match(reportPage, /new URLSearchParams\(location\.search\)/, 'report mode can be recovered from its URL after reload');
assert.match(reportPage, /showTechnical && isAuthenticated/, 'technical telemetry is rendered only when technical mode is present');
console.log('Analysis mode toggle tests passed.');
