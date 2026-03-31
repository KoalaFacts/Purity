import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', msg => {
  if (msg.type() === 'error' || msg.type() === 'warning')
    console.log(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));

console.log('Opening benchmark (auto-run)...\n');
await page.goto('http://localhost:5179/bench.html?auto', { timeout: 10000 });

// Wait for completion — up to 5 minutes
await page.getByText('Done! All operations used Purity state() + watch().').waitFor({ timeout: 300000 });

// Print status
const status = await page.locator('#status').textContent();
console.log(status);

// Print table
const rows = await page.locator('#results-body tr').all();
if (rows.length > 0) {
  console.log('\n| Operation | Median | Mean | StdDev | Min | Max |');
  console.log('|-----------|--------|------|--------|-----|-----|');
  for (const row of rows) {
    const cells = await row.locator('td').all();
    const texts = [];
    for (const cell of cells) texts.push((await cell.textContent()).trim());
    console.log(`| ${texts.join(' | ')} |`);
  }
}

await browser.close();
