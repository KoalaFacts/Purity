import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}\n${err.stack}`));
page.on('crash', () => console.log('[CRASH] Page crashed!'));

await page.goto('http://localhost:5179/diag.html', { timeout: 10000 });

// Wait for DONE text
try {
  await page.getByText('DONE').waitFor({ timeout: 30000 });
  console.log('\n=== RESULTS ===');
  console.log(await page.locator('#status').textContent());
} catch (e) {
  console.log('\nTimed out. Current status:');
  try {
    console.log(await page.locator('#status').textContent({ timeout: 3000 }));
  } catch { console.log('Could not read status'); }
}

await browser.close();
