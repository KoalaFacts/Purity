import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium, firefox, webkit } from 'playwright';
import {
  generate,
  generateHydrate,
  isSSRHtml,
  markSSRHtml,
  parse,
  valueToHtml,
} from '@purityjs/core/compiler';
import { html, renderToStream, renderToString } from '@purityjs/ssr';

const payload = '<script>globalThis.__purityAttack=1</script>';
const forged = JSON.parse(JSON.stringify({ __purity_ssr_html__: payload }));
const markup = await renderToString(
  () => html`<main>${forged}${html`<strong>safe</strong>`}</main>`,
);
assert.ok(!markup.includes(payload));
const stream = await new Response(renderToStream(() => html`<main>${forged}</main>`)).text();
assert.ok(!stream.includes(payload));

// Both package formats must reject structural impersonation and retain their
// own explicitly trusted wrappers. Trust does not come from serialization.
const cjs = createRequire(import.meta.url)('@purityjs/core/compiler') as {
  isSSRHtml: typeof isSSRHtml;
  markSSRHtml: typeof markSSRHtml;
  valueToHtml: typeof valueToHtml;
};
for (const runtime of [{ isSSRHtml, markSSRHtml, valueToHtml }, cjs]) {
  assert.equal(runtime.isSSRHtml(forged), false);
  assert.equal(runtime.valueToHtml(forged), '[object Object]');
  assert.equal(
    runtime.valueToHtml(runtime.markSSRHtml('<strong>safe</strong>')),
    '<strong>safe</strong>',
  );
}

const ast = parse(['<a href=', '>go</a>']);
const client = generate(ast);
const hydrate = generateHydrate(ast);
for (const browserType of [chromium, firefox, webkit]) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(markup);
    assert.equal(
      await page.evaluate(() => (globalThis as { __purityAttack?: number }).__purityAttack),
      undefined,
    );
    assert.equal(await page.locator('strong').textContent(), 'safe');
    const result = await page.evaluate(
      ({ client, hydrate }) => {
        const immediate = (fn: () => void) => fn();
        const dom = new Function(`return ${client}`)();
        const adopt = new Function(`return ${hydrate}`)();
        let rejected = 0;
        for (const value of [
          'javascript:globalThis.__purityAttack=1',
          'java\nscript:globalThis.__purityAttack=1',
          'data:text/html,<script>attack()</script>',
        ]) {
          for (const render of [
            () => dom([value], immediate),
            () => {
              const root = document.createElement('div');
              root.innerHTML = '<a href="/safe">go</a>';
              adopt([value], immediate, root);
            },
          ]) {
            try {
              render();
            } catch (error) {
              if (error instanceof Error && error.message.includes('Unsafe URL binding'))
                rejected++;
              else throw error;
            }
          }
        }
        const root = dom(['/safe'], immediate) as DocumentFragment;
        return { rejected, safeHref: (root as unknown as HTMLAnchorElement).getAttribute('href') };
      },
      { client, hydrate },
    );
    assert.deepEqual(result, { rejected: 6, safeHref: '/safe' });
    console.log(
      `${browserType.name()}: forged SSR markup blocked; nested markup retained; unsafe DOM/hydration URLs rejected`,
    );
  } finally {
    await browser.close();
  }
}
