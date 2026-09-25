#!/usr/bin/env node
// Browser-observable accessibility checks. No screen-reader result is inferred.
// Usage: npm run a11y:matrix -- http://localhost:5173/Purity/

import assert from 'node:assert/strict';
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';

const base = process.argv[2];
if (!base) {
  console.error('Usage: npm run a11y:matrix -- <benchmark-base-url>');
  process.exit(1);
}

type Metrics = Record<string, string | number | boolean>;
type CaseResult = {
  browser: string;
  version: string;
  scenario: string;
  status: 'passed' | 'failed';
  metrics?: Metrics;
  error?: string;
};

const results: CaseResult[] = [];

async function check(
  browser: Browser,
  browserName: string,
  scenario: string,
  run: () => Promise<Metrics>,
): Promise<void> {
  try {
    results.push({
      browser: browserName,
      version: browser.version(),
      scenario,
      status: 'passed',
      metrics: await run(),
    });
  } catch (error) {
    results.push({
      browser: browserName,
      version: browser.version(),
      scenario,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function openComplex(
  browser: Browser,
  options?: Parameters<Browser['newPage']>[0],
): Promise<Page> {
  const page = await browser.newPage(options);
  await page.goto(new URL('a11y/complex.html', base).href, { waitUntil: 'networkidle' });
  return page;
}

async function geometry(page: Page): Promise<{
  viewportCssPx: number;
  horizontalOverflowPx: number;
  shadowControlsOutsideViewport: number;
}> {
  return page.evaluate(() => ({
    viewportCssPx: document.documentElement.clientWidth,
    horizontalOverflowPx: Math.max(
      0,
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
    shadowControlsOutsideViewport: [...document.querySelectorAll('*')]
      .flatMap((host) => [...(host.shadowRoot?.querySelectorAll('input, select, textarea') ?? [])])
      .filter((control) => {
        const rect = control.getBoundingClientRect();
        return rect.left < 0 || rect.right > document.documentElement.clientWidth;
      }).length,
  }));
}

for (const [browserName, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  try {
    await check(browser, browserName, 'reflow-320-css-px', async () => {
      const page = await openComplex(browser, { viewport: { width: 320, height: 800 } });
      try {
        const size = await geometry(page);
        assert.equal(size.horizontalOverflowPx, 0);
        assert.equal(size.shadowControlsOutsideViewport, 0);
        assert.equal(await page.getByRole('textbox', { name: 'Email (required)' }).count(), 1);
        return size;
      } finally {
        await page.close();
      }
    });

    await check(browser, browserName, 'text-resize-200-percent-proxy', async () => {
      const page = await openComplex(browser, { viewport: { width: 320, height: 800 } });
      try {
        const before = await page.locator('p-named-field').evaluate((host) => {
          const root = host.shadowRoot!;
          return {
            label: parseFloat(getComputedStyle(root.querySelector('label')!).fontSize),
            input: parseFloat(getComputedStyle(root.querySelector('input')!).fontSize),
          };
        });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%';
        });
        const after = await page.locator('p-named-field').evaluate((host) => {
          const root = host.shadowRoot!;
          return {
            label: parseFloat(getComputedStyle(root.querySelector('label')!).fontSize),
            input: parseFloat(getComputedStyle(root.querySelector('input')!).fontSize),
          };
        });
        const size = await geometry(page);
        const labelScale = after.label / before.label;
        const inputScale = after.input / before.input;
        assert.ok(labelScale >= 1.95 && inputScale >= 1.95);
        assert.equal(size.horizontalOverflowPx, 0);
        assert.equal(size.shadowControlsOutsideViewport, 0);
        return { ...size, labelScale, inputScale };
      } finally {
        await page.close();
      }
    });

    await check(browser, browserName, 'forced-colors-focus', async () => {
      const page = await openComplex(browser, {
        viewport: { width: 320, height: 800 },
        forcedColors: 'active',
      });
      try {
        await page.keyboard.press('Tab');
        const state = await page.locator('p-named-field').evaluate((host) => {
          const input = host.shadowRoot!.querySelector('input')!;
          const style = getComputedStyle(input);
          const rect = input.getBoundingClientRect();
          return {
            forcedColorsActive: matchMedia('(forced-colors: active)').matches,
            focusInsideControl: host.shadowRoot!.activeElement === input,
            focusOutlineStyle: style.outlineStyle,
            focusOutlineWidthPx: parseFloat(style.outlineWidth),
            focusInViewport:
              rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight,
          };
        });
        const size = await geometry(page);
        assert.equal(state.forcedColorsActive, true);
        assert.equal(state.focusInsideControl, true);
        assert.notEqual(state.focusOutlineStyle, 'none');
        assert.ok(state.focusOutlineWidthPx > 0);
        assert.equal(state.focusInViewport, true);
        assert.equal(size.horizontalOverflowPx, 0);
        assert.equal(size.shadowControlsOutsideViewport, 0);
        return { ...size, ...state };
      } finally {
        await page.close();
      }
    });

    await check(browser, browserName, 'select-computed-text-contrast', async () => {
      const page = await openComplex(browser);
      try {
        const colors = await page.locator('p-color-field select').evaluate((select) => {
          const style = getComputedStyle(select);
          return { foreground: style.color, background: style.backgroundColor };
        });
        const luminance = (css: string): number => {
          const channels = css
            .match(/\d+(?:\.\d+)?/g)
            ?.slice(0, 3)
            .map(Number);
          assert.equal(channels?.length, 3);
          const linear = channels!.map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        };
        const foreground = luminance(colors.foreground);
        const background = luminance(colors.background);
        const computedContrastRatio =
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        assert.ok(computedContrastRatio >= 4.5);
        return { computedContrastRatio: Number(computedContrastRatio.toFixed(2)) };
      } finally {
        await page.close();
      }
    });

    await check(browser, browserName, 'complex-invalid-and-errors', async () => {
      const page = await openComplex(browser);
      try {
        await page.getByRole('button', { name: 'Submit' }).click();
        const alert = page.getByRole('alert');
        const message = await alert.textContent();
        for (const name of ['email', 'age', 'agree']) assert.ok(message?.includes(name));
        assert.equal(
          await page
            .locator('p-email-field')
            .evaluate((host) => host.shadowRoot?.activeElement?.tagName),
          'INPUT',
        );
        await page.locator('p-age-field input').fill('17');
        assert.equal(
          await page
            .locator('p-age-field')
            .evaluate(
              (host: HTMLElement & { validity: ValidityState }) => host.validity.rangeUnderflow,
            ),
          true,
        );
        await page.locator('p-email-field input').fill('incorrect');
        assert.equal(
          await page
            .locator('p-email-field')
            .evaluate(
              (host: HTMLElement & { validity: ValidityState }) => host.validity.typeMismatch,
            ),
          true,
        );
        return {
          identifiedInvalidFields: 3,
          focusedFirstInvalid: true,
          rangeAndEmailConstraints: true,
        };
      } finally {
        await page.close();
      }
    });

    await check(browser, browserName, 'complex-mixed-submit-and-dynamic', async () => {
      const page = await openComplex(browser);
      try {
        await page.locator('p-named-field input').fill('Lin');
        await page.locator('p-email-field input').fill('lin@example.com');
        await page.locator('p-age-field input').fill('24');
        await page.locator('p-notes-field textarea').fill('Please email me.');
        await page.getByRole('radio', { name: 'Phone' }).check();
        await page.locator('p-color-field select').selectOption(['red', 'blue']);
        await page.locator('p-file-field input').setInputFiles({
          name: 'proof.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('proof'),
        });
        await page.locator('p-agree-field input').check();
        await page.getByRole('button', { name: 'Add reference' }).click();
        await page.locator('#dynamic-fields p-extra-field input').fill('REF-42');
        assert.deepEqual(
          await page
            .locator('form')
            .evaluate((form: HTMLFormElement) => new FormData(form).getAll('contact')),
          ['phone'],
        );
        await page.getByRole('button', { name: 'Submit' }).click();
        assert.equal(await page.getByRole('alert').textContent(), '');
        const entries = JSON.parse((await page.locator('#result').textContent()) ?? 'null') as [
          string,
          string,
        ][];
        assert.deepEqual(entries, [
          ['fullName', 'Lin'],
          ['email', 'lin@example.com'],
          ['age', '24'],
          ['notes', 'Please email me.'],
          ['contact', 'phone'],
          ['colors', 'red'],
          ['colors', 'blue'],
          ['attachment', 'proof.txt'],
          ['agree', 'on'],
          ['reference', 'REF-42'],
        ]);
        assert.equal(
          entries.some(([name]) => name === 'disabledReference'),
          false,
        );
        return {
          submittedValues: entries.length,
          disabledValuesSubmitted: 0,
          dynamicValuesSubmitted: 1,
          selectedRadioValues: 1,
        };
      } finally {
        await page.close();
      }
    });

    await check(browser, browserName, 'complex-reset-and-removal', async () => {
      const page = await openComplex(browser);
      try {
        await page.locator('p-named-field input').fill('Grace');
        await page.locator('p-email-field input').fill('grace@example.com');
        await page.locator('p-age-field input').fill('30');
        await page.locator('p-agree-field input').check();
        await page.getByRole('radio', { name: 'Phone' }).check();
        await page.getByRole('button', { name: 'Add reference' }).click();
        await page.locator('#dynamic-fields p-extra-field input').fill('TEMP');
        await page.getByRole('button', { name: 'Reset' }).click();
        const state = await page.locator('form').evaluate((form: HTMLFormElement) => {
          const data = new FormData(form);
          return {
            name: data.get('fullName'),
            email: data.get('email'),
            age: data.get('age'),
            agreementPresent: data.has('agree'),
            reference: data.get('reference'),
            contact: data.getAll('contact'),
          };
        });
        assert.deepEqual(state, {
          name: 'Ada',
          email: '',
          age: '',
          agreementPresent: false,
          reference: '',
          contact: ['email'],
        });
        await page.locator('#dynamic-fields p-extra-field').evaluate((host) => host.remove());
        assert.equal(
          await page
            .locator('form')
            .evaluate((form: HTMLFormElement) => new FormData(form).has('reference')),
          false,
        );
        return { resetFields: 6, removedDynamicValueOmitted: true };
      } finally {
        await page.close();
      }
    });
  } finally {
    await browser.close();
  }
}

const passed = results.filter((result) => result.status === 'passed').length;
const failed = results.length - passed;
for (const result of results) {
  console.log(`${result.status.toUpperCase()} ${result.browser} ${result.scenario}`);
  if (result.error) console.error(`  ${result.error}`);
}
console.log(JSON.stringify({ passed, failed, results }, null, 2));
if (failed) process.exitCode = 1;
