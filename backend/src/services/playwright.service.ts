import { chromium, Browser, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { ApiError } from '../errors/ApiError';

export interface ScreenshotResult {
  url: string;
  filename: string;
  path: string;
}

export class PlaywrightService {
  private tempDir: string;

  constructor() {
    this.tempDir = path.resolve(process.cwd(), 'temp', 'screenshots');
  }

  private ensureTempDirExists(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  private generateFilename(targetUrl: string): string {
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timePart = now.toTimeString().slice(0, 8).replace(/:/g, '');
    
    let hostname = 'url';
    try {
      hostname = new URL(targetUrl).hostname.replace(/[^a-zA-Z0-9]/g, '-');
    } catch {
      hostname = 'url';
    }

    return `${datePart}-${timePart}-${hostname}.png`;
  }

  public async captureScreenshot(targetUrl: string): Promise<ScreenshotResult> {
    let browser: Browser | null = null;

    try {
      this.ensureTempDirExists();

      try {
        browser = await chromium.launch({
          headless: true,
        });
      } catch (error) {
        throw new ApiError(500, 'Failed to launch browser instance');
      }

      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true,
      });

      const page: Page = await context.newPage();

      try {
        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
      } catch (error: any) {
        const errMessage = error?.message || '';

        if (errMessage.includes('Timeout') || errMessage.includes('timeout')) {
          let hasUsableState = false;
          try {
            const currentUrl = page.url();
            if (currentUrl && currentUrl !== 'about:blank') {
              const bodyLength = await page.evaluate(() => {
                return document.body ? document.body.innerText.trim().length : 0;
              });
              if (bodyLength > 0) {
                hasUsableState = true;
              }
            }
          } catch {
            hasUsableState = false;
          }

          if (!hasUsableState) {
            throw new ApiError(504, `Navigation timeout while loading URL: ${targetUrl}`);
          }
        } else if (
          errMessage.includes('net::ERR_CONNECTION_REFUSED') ||
          errMessage.includes('net::ERR_CONNECTION_RESET') ||
          errMessage.includes('net::ERR_CONNECTION_ABORTED') ||
          errMessage.includes('ECONNREFUSED') ||
          errMessage.includes('ECONNRESET')
        ) {
          throw new ApiError(502, `Connection failed while connecting to URL: ${targetUrl}`);
        } else if (errMessage.includes('net::ERR_NAME_NOT_RESOLVED') || errMessage.includes('ENOTFOUND')) {
          throw new ApiError(502, `DNS failure or domain not found for URL: ${targetUrl}`);
        } else if (errMessage.includes('net::ERR_SSL') || errMessage.includes('CERT')) {
          throw new ApiError(502, `HTTPS/SSL error while connecting to URL: ${targetUrl}`);
        } else {
          throw new ApiError(502, `Failed to navigate to URL: ${targetUrl}`);
        }
      }

      // Settling period to allow visual components and fonts to stabilize
      try {
        await page.waitForTimeout(2000);
      } catch {
        // Ignore errors during settling phase
      }

      const filename = this.generateFilename(targetUrl);
      const relativePath = path.join('temp', 'screenshots', filename).replace(/\\/g, '/');
      const absolutePath = path.join(this.tempDir, filename);

      try {
        await page.screenshot({
          path: absolutePath,
          fullPage: true,
        });
      } catch (error) {
        throw new ApiError(500, 'Failed to capture full page screenshot');
      }

      return {
        url: targetUrl,
        filename,
        path: relativePath,
      };
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
}

export const playwrightService = new PlaywrightService();

