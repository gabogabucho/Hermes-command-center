import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

mkdirSync('docs/screenshots', { recursive: true });

async function shot(page, name) {
  await page.screenshot({ path: `docs/screenshots/${name}.png` });
  console.log('✓', name);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto('http://localhost:5173');

// PIN gate screenshot (before unlock)
await page.waitForSelector('.pin-gate', { timeout: 8000 });
await shot(page, 'pin-gate');

// PIN auto-submits after 4 digits (indices 0-3 = keys 1,2,3,4)
const allKeys = page.locator('.pin-key');
for (const idx of [0, 1, 2, 3]) await allKeys.nth(idx).click();
await page.waitForSelector('.ops-console', { timeout: 8000 });
await page.waitForTimeout(600); // let metrics settle

for (const skin of ['amber','cyber','matrix']) {
  await page.locator(`.ops-skin-btn.skin-opt-${skin}`).click();
  await page.waitForTimeout(400);
  for (const mode of ['PRO','LITE']) {
    await page.locator('.ops-mode-btn').filter({ hasText: mode }).click();
    await page.waitForTimeout(500);
    await shot(page, `${skin}-${mode.toLowerCase()}`);
  }
}

await browser.close();
console.log('all screenshots saved to docs/screenshots/');
