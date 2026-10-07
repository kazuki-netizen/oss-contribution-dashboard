import { chromium } from '@playwright/test';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  await page.goto(process.env['PREVIEW_URL'] ?? 'http://127.0.0.1:4173/');
  await page.locator('.contribution-row').first().waitFor();
  await page.screenshot({ path: 'docs/dashboard.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/dashboard-mobile.png', fullPage: true });
  console.log('Saved desktop and mobile screenshots.');
} finally {
  await browser.close();
}
