import { test as base, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * Extended Playwright test that collects istanbul coverage after each test.
 * When the app is built with vite-plugin-istanbul (CI only),
 * window.__coverage__ is available and gets saved to .nyc_output/.
 * When running locally without instrumentation, this is a no-op.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);

    const coverage = await page.evaluate(() => window.__coverage__).catch(() => null);
    if (coverage) {
      const dir = path.join(process.cwd(), '.nyc_output');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, `${randomUUID()}.json`),
        JSON.stringify(coverage)
      );
    }
  },
});

export { expect };
