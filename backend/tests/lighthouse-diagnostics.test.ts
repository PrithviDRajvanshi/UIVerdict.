import assert from 'assert';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { LighthouseDiagnosticMetadata } from '../src/services/browser-diagnostics';
import { LighthouseService } from '../src/services/lighthouse.service';

async function run() {
  const profileRoot = os.tmpdir();
  const profilesBefore = new Set((await fs.promises.readdir(profileRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('lighthouse.'))
    .map((entry) => entry.name));
  const server = http.createServer((request, response) => {
    if (request.url === '/unavailable') {
      response.writeHead(503, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Unavailable</title><main>Temporarily unavailable</main>');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Local audit</title><main><h1>Local Lighthouse diagnostic fixture</h1></main>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const service = new LighthouseService();
  const completedDiagnostics: LighthouseDiagnosticMetadata[] = [];
  const errorPageDiagnostics: LighthouseDiagnosticMetadata[] = [];
  const cleanupWarnings: string[] = [];
  const cleanupCompletions: string[] = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = ((...args: unknown[]) => {
    if (String(args[0]).includes('Warning closing Chrome')) cleanupWarnings.push(args.map(String).join(' '));
    originalError(...args);
  }) as typeof console.error;
  console.log = ((...args: unknown[]) => {
    if (String(args[0]).includes('Chrome process exited and cleanup completed')) cleanupCompletions.push(String(args[0]));
    originalLog(...args);
  }) as typeof console.log;
  try {
    const metrics = await service.runAudit(`http://127.0.0.1:${address.port}/`, async (diagnostics) => {
      completedDiagnostics.push(diagnostics);
    });
    assert.strictEqual(typeof metrics.performance, 'number');
    assert.strictEqual(completedDiagnostics.at(-1)?.outcome, 'AUDIT_COMPLETED');
    assert.strictEqual(completedDiagnostics.at(-1)?.navigationResponseStatus, 200);
    assert.strictEqual(completedDiagnostics.at(-1)?.navigationStatusObserved, true);
    assert.strictEqual(cleanupCompletions.length, 1, 'runAudit resolves only after its Chrome process exits and cleanup completes');

    await assert.rejects(() => service.runAudit(`http://127.0.0.1:${address.port}/unavailable`, async (diagnostics) => {
      errorPageDiagnostics.push(diagnostics);
    }));
    assert.strictEqual(errorPageDiagnostics.at(-1)?.outcome, 'NAVIGATION_FAILED', 'HTTP error navigation must not be confused with a poor completed audit');
    assert.strictEqual(errorPageDiagnostics.at(-1)?.navigationResponseStatus, 503, JSON.stringify(errorPageDiagnostics.at(-1)));
    assert.deepStrictEqual(cleanupWarnings, [], 'Chrome cleanup must not race temporary profile deletion');
  } finally {
    console.error = originalError;
    console.log = originalLog;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  const newProfiles = (await fs.promises.readdir(profileRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('lighthouse.') && !profilesBefore.has(entry.name))
    .map((entry) => path.join(profileRoot, entry.name));
  assert.deepStrictEqual(newProfiles, [], 'Lighthouse must remove every temporary profile it created');
  console.log('Lighthouse navigation diagnostics tests passed.');
}

run().catch((error) => {
  console.error('Lighthouse diagnostics tests failed:', error);
  process.exitCode = 1;
});
