#!/usr/bin/env node
// Browser accessibility check for any running Purity page, including shadow DOM.
// Usage: npm run a11y -- http://localhost:4173/

import axe from 'axe-core';
import { chromium, firefox, webkit } from 'playwright';

const target = process.argv[2];
if (!target) {
  console.error('Usage: npm run a11y -- <page-url> [chromium|firefox|webkit|all]');
  process.exit(1);
}

const requested = process.argv[3] ?? 'chromium';
const engines = { chromium, firefox, webkit };
const names = requested === 'all' ? Object.keys(engines) : [requested];
if (names.some((name) => !(name in engines))) {
  console.error(`Unknown browser: ${requested}`);
  process.exit(1);
}

for (const name of names) {
  const browser = await engines[name as keyof typeof engines].launch();
  try {
    const page = await browser.newPage();
    await page.goto(target, { waitUntil: 'networkidle' });
    await page.addScriptTag({ content: axe.source });
    const results = await page.evaluate(async () => {
      const checker = (globalThis as unknown as { axe: typeof axe }).axe;
      const report = await checker.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
        },
      });
      return {
        passes: report.passes.length,
        incomplete: report.incomplete.map((rule) => ({
          id: rule.id,
          help: rule.help,
          targets: rule.nodes.map((node) => node.target.join(' > ')),
        })),
        violations: report.violations.map((rule) => ({
          id: rule.id,
          impact: rule.impact,
          help: rule.help,
          targets: rule.nodes.map((node) => node.target.join(' > ')),
        })),
      };
    });

    console.log(
      `${name} ${browser.version()}: ${results.passes} rules passed; ${results.incomplete.length} need manual review; ` +
        `${results.violations.length} violations.`,
    );
    for (const item of results.incomplete) {
      console.log(`  review: ${item.id} — ${item.help}`);
      for (const target of item.targets) console.log(`    ${target}`);
    }
    for (const violation of results.violations) {
      console.error(`${violation.impact}: ${violation.id} — ${violation.help}`);
      for (const target of violation.targets) console.error(`  ${target}`);
    }
    if (results.violations.length > 0) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
