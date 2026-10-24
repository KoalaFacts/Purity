#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, firefox, webkit, type BrowserType } from 'playwright';
import { build, preview } from 'vite';

const benchmarkRoot = resolve(import.meta.dirname, '..');
const configFile = resolve(benchmarkRoot, 'vite.config.ts');

async function checkBrowser(browserType: BrowserType, url: string): Promise<void> {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url);

    await page.getByRole('button', { name: 'Create 10,000 virtual rows' }).click();
    const virtual = page.locator('#virtual-viewport');
    await page.waitForFunction(() =>
      document.querySelector('#virtual-viewport .row')?.textContent?.includes('Row 0'),
    );
    const initialCount = await virtual.locator('.row').count();
    assert.ok(initialCount > 0 && initialCount < 100, `Initial virtual row count: ${initialCount}`);

    await virtual.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll'));
    });
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('#virtual-viewport .row')).some((row) =>
        row.textContent?.includes('Row 9999'),
      ),
    );
    const bottomCount = await virtual.locator('.row').count();
    assert.ok(bottomCount > 0 && bottomCount < 100, `Bottom virtual row count: ${bottomCount}`);

    await page.getByRole('button', { name: 'Clear' }).click();
    await page.getByRole('button', { name: 'Create 10,000 regular rows' }).click();
    const regular = page.locator('#full-viewport');
    await page.waitForFunction(
      () => document.querySelectorAll('#full-viewport .row').length === 10_000,
    );
    assert.equal(await regular.locator('.row').count(), 10_000);

    await page.getByRole('button', { name: 'Create 10,000 shadow rows' }).click();
    const shadow = page.locator('#shadow-viewport');
    const shadowRows = shadow.locator('.row');
    await page.waitForFunction(() =>
      document.querySelector('#shadow-viewport > div')?.shadowRoot?.querySelector('.row'),
    );
    assert.ok((await shadowRows.count()) < 100);
    await shadow.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll'));
    });
    await page.waitForFunction(() =>
      Array.from(
        document.querySelector('#shadow-viewport > div')?.shadowRoot?.querySelectorAll('.row') ??
          [],
      ).some((row) => row.textContent?.includes('Row 9999')),
    );
    assert.ok((await shadowRows.count()) < 100);

    // This fixture is part of the production Vite build, not a dev-only
    // evaluation of source modules. Assert exact multi-root order and identity
    // in each engine, including the native moveBefore-capable engines.
    const multi = await browser.newPage();
    try {
      const errors: string[] = [];
      multi.on('pageerror', (error) => errors.push(error.message));
      await multi.goto(url.replace('/virtual.html', '/multi-root.html'));
      await multi.locator('#multi-root input[data-key="C"]').waitFor();
      const nativeMoveBefore = await multi.evaluate(
        () => typeof Element.prototype.moveBefore === 'function',
      );
      await multi.evaluate(() => {
        const originals = [...document.querySelectorAll('#multi-root > b, #multi-root > input')];
        (window as Window & { __multiRootOriginals?: Element[] }).__multiRootOriginals = originals;
        const input = document.querySelector<HTMLInputElement>(
          '#multi-root input[data-key="C"]',
        )!;
        input.value = 'typed-C';
        input.focus();
        input.setSelectionRange(1, 4);
      });
      const check = async (keys: string[], requireAllOriginals: boolean) => {
        const actual = await multi.evaluate(() => {
          const nodes = [...document.querySelectorAll('#multi-root > b, #multi-root > input')];
          const originals = (window as Window & { __multiRootOriginals?: Element[] })
            .__multiRootOriginals!;
          const focusedInput = document.querySelector<HTMLInputElement>(
            '#multi-root input[data-key="C"]',
          )!;
          return {
            sequence: nodes.map((node) => `${node.tagName}:${node.getAttribute('data-key')}`),
            retained: originals.filter((node) => nodes.includes(node)).length,
            typedValue: focusedInput.value,
            focus: document.activeElement === focusedInput,
            selection: [focusedInput.selectionStart, focusedInput.selectionEnd],
          };
        });
        assert.deepEqual(
          actual.sequence,
          keys.flatMap((key) => [`B:${key}`, `INPUT:${key}`]),
          `${browserType.name()}: multi-root child order`,
        );
        if (requireAllOriginals) {
          assert.equal(actual.retained, 6, 'reorder must preserve every original element');
        }
        assert.equal(actual.typedValue, 'typed-C', 'reorder must preserve user-edited input value');
        if (nativeMoveBefore) {
          assert.equal(actual.focus, true, 'native moveBefore must retain input focus');
          assert.deepEqual(actual.selection, [1, 4], 'native moveBefore must retain selection');
        }
      };
      for (const [button, order, original] of [
        ['rotate', ['C', 'A', 'B'], true],
        ['reverse', ['B', 'A', 'C'], true],
        ['insert', ['X', 'B', 'C', 'A', 'Y'], false],
      ] as const) {
        await multi.locator(`#${button}`).evaluate((element: HTMLElement) => element.click());
        await multi.waitForFunction(
          (expected) =>
            document.querySelector('#multi-root > b')?.getAttribute('data-key') === expected,
          order[0],
        );
        await check([...order], original);
      }
      assert.deepEqual(errors, [], `${browserType.name()}: multi-root page errors`);
      console.log(
        JSON.stringify({
          engine: browserType.name(),
          browserVersion: browser.version(),
          nativeMoveBefore,
          multiRootReorder: 'passed',
        }),
      );
    } finally {
      await multi.close();
    }

    console.log(
      `${browserType.name()}: ${initialCount} initial and ${bottomCount} bottom virtual rows; 10,000 regular rows; shadow scroll reached Row 9999`,
    );
  } finally {
    await browser.close();
  }
}

await build({ root: benchmarkRoot, configFile });
const server = await preview({
  root: benchmarkRoot,
  configFile,
  preview: { host: '127.0.0.1', port: 0, strictPort: false },
});
try {
  const address = server.httpServer.address() as AddressInfo | null;
  assert.ok(address, 'Preview server did not start');
  const url = `http://127.0.0.1:${address.port}/Purity/apps/purity/virtual.html`;
  for (const browserType of [chromium, firefox, webkit]) {
    await checkBrowser(browserType, url);
  }
} finally {
  await new Promise<void>((resolve, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : resolve()));
  });
}
