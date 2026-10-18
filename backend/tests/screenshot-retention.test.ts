import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PlaywrightService } from '../src/services/playwright.service';

async function run() {
  const previousCwd = process.cwd();
  const oldNodeEnv = process.env.NODE_ENV;
  const oldRetention = process.env.UIVERDICT_DEV_SCREENSHOT_RETENTION_HOURS;
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'uiverdict-retention-'));
  try {
    process.chdir(root);
    process.env.NODE_ENV = 'development';
    process.env.UIVERDICT_DEV_SCREENSHOT_RETENTION_HOURS = '1';
    const service = new PlaywrightService();
    const directory = path.join(root, 'temp', 'screenshots');
    await fs.promises.mkdir(directory, { recursive: true });

    const expiredManaged = 'uiverdict-run-20261013-000000-example-com-abcdef123456.png';
    const legacy = '20261013-000000-example-com-legacy.png';
    const retained = 'uiverdict-run-20261013-000001-example-com-abcdef123457.png';
    for (const name of [expiredManaged, legacy, retained]) await fs.promises.writeFile(path.join(directory, name), 'temporary');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.promises.utimes(path.join(directory, expiredManaged), old, old);
    await fs.promises.utimes(path.join(directory, legacy), old, old);

    await (service as any).cleanupExpiredDevelopmentScreenshots();
    assert.strictEqual(fs.existsSync(path.join(directory, expiredManaged)), false, 'expired new-format artifacts are cleaned');
    assert.strictEqual(fs.existsSync(path.join(directory, legacy)), true, 'legacy artifacts are never swept');
    assert.strictEqual(fs.existsSync(path.join(directory, retained)), true, 'unexpired development artifacts are retained');
    await service.removeScreenshot({ url: 'https://example.com', filename: retained, path: `temp/screenshots/${retained}`, sha256: 'a'.repeat(64) });
    assert.strictEqual(fs.existsSync(path.join(directory, retained)), true, 'opt-in development retention skips immediate removal');

    const analysisArtifact = 'uiverdict-analysis-20261013-000002-example-com-abcdef123458.png';
    await fs.promises.writeFile(path.join(directory, analysisArtifact), 'temporary');
    await service.removeScreenshot({ url: 'https://example.com', filename: analysisArtifact, path: `temp/screenshots/${analysisArtifact}`, sha256: 'a'.repeat(64) }, true);
    assert.strictEqual(fs.existsSync(path.join(directory, analysisArtifact)), false,
      'analysis pipeline cleanup removes its screenshot even when development retention is enabled');

    process.env.NODE_ENV = 'production';
    await service.removeScreenshot({ url: 'https://example.com', filename: retained, path: `temp/screenshots/${retained}`, sha256: 'a'.repeat(64) });
    assert.strictEqual(fs.existsSync(path.join(directory, retained)), false, 'production always removes the temporary screenshot');
    console.log('Screenshot retention and cleanup tests passed.');
  } finally {
    process.chdir(previousCwd);
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
    if (oldRetention === undefined) delete process.env.UIVERDICT_DEV_SCREENSHOT_RETENTION_HOURS; else process.env.UIVERDICT_DEV_SCREENSHOT_RETENTION_HOURS = oldRetention;
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error('Screenshot retention tests failed:', error);
  process.exitCode = 1;
});
