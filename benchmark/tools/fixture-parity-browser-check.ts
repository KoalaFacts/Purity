import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Page } from 'playwright';
import { preview } from 'vite';
import { browserEngines } from './browser-engines.ts';

const output = resolve(import.meta.dirname, '../dist/fixture-parity');
await mkdir(output, { recursive: true });
const server = await preview({
  configFile: false,
  root: resolve(import.meta.dirname, '..'),
  base: '/Purity/',
  preview: { host: '127.0.0.1', port: 0, open: false },
});

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

// DOM representation differences (comments, split text nodes, formatting
// whitespace and CSS serialization) are not semantic element differences.
async function snapshot(page: Page): Promise<string> {
  return JSON.stringify(
    await page.locator('#main').evaluate((root) => {
      type SemanticNode = {
        tag: string;
        attrs: string[][];
        children: (SemanticNode | string)[];
        value?: string;
      };
      const visit = (element: Element): SemanticNode => {
        const children: (SemanticNode | string)[] = [];
        let text = '';
        const flush = () => {
          const value = text.replace(/\s+/g, ' ').trim();
          if (value) children.push(value);
          text = '';
        };
        for (const child of element.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
          else if (child instanceof Element) {
            flush();
            children.push(visit(child));
          }
        }
        flush();
        const attrs = Array.from(element.attributes, ({ name, value }) => [
          name,
          name === 'style' ? (element as HTMLElement).style.cssText : value,
        ]).sort(([a], [b]) => a.localeCompare(b));
        return {
          tag: element.localName,
          attrs,
          children,
          ...(element instanceof HTMLInputElement ? { value: element.value } : {}),
        };
      };
      return visit(root);
    }),
  );
}

try {
  for (const [engine, launcher] of browserEngines) {
    const browser = await launcher.launch();
    try {
      const pages = await Promise.all(['purity', 'solid'].map(() => browser.newPage()));
      const errors: string[] = [];
      pages.forEach((page) => page.on('pageerror', (error) => errors.push(error.message)));
      for (const scene of ['index', 'binding']) {
        for (const [index, framework] of ['purity', 'solid'].entries()) {
          await pages[index].goto(
            `${server.resolvedUrls!.local[0]}apps/${framework}/${scene}.html`,
          );
        }
        const actions =
          scene === 'index'
            ? [
                null,
                '#run-10',
                '#add-10',
                '#update',
                'tbody tr:first-child .lbl',
                'tbody tr:nth-child(2) .remove',
                '#run',
                '#swaprows',
                '#add',
                '#clear',
                '#run',
                '#runlots',
                '#clear',
                'reload',
                '#run-10',
              ]
            : [
                null,
                '#create-100',
                '#update-all',
                '#read-all',
                '#clear-all',
                '#create-100',
                '#update-all',
              ];
        let firstRunHashes: string[] | undefined;
        for (const [step, action] of actions.entries()) {
          for (const page of pages) {
            if (action === 'reload') await page.reload();
            else if (action)
              await page
                .locator(action)
                .first()
                .evaluate((element: HTMLElement) => element.click());
            await settle(page);
          }
          const snapshots = await Promise.all(pages.map(snapshot));
          const hashes = snapshots.map((value) => createHash('sha256').update(value).digest('hex'));
          for (const [index, framework] of ['purity', 'solid'].entries()) {
            await writeFile(
              `${output}/${engine}-${scene}-${step}-${framework}.json.gz`,
              gzipSync(snapshots[index]),
            );
          }
          if (scene === 'index') {
            const counts = [0, 10, 20, 20, 20, 19, 1000, 1000, 2000, 0, 1000, 10000, 0, 0, 10];
            for (const page of pages) {
              assert.equal(await page.locator('tbody tr').count(), counts[step]);
              assert.equal(
                await page.getByRole('link', { name: 'Remove row', exact: true }).count(),
                counts[step],
              );
              if (counts[step]) {
                const row = page.locator('tbody tr').first();
                const label = await row.locator('.lbl').textContent();
                assert.equal(
                  await row.getByRole('link', { name: label!, exact: true }).count(),
                  1,
                  'Selection link accessible name preserves its visible row label',
                );
              }
              if (action === '#run-10') {
                assert.deepEqual(await page.locator('tbody tr .lbl').allTextContents(), [
                  'expensive blue car',
                  'helpful green pizza',
                  'elegant orange mouse',
                  'clean red keyboard',
                  'short blue mouse',
                  'tall brown table',
                  'mushy green cookie',
                  'easy green cookie',
                  'angry brown sandwich',
                  'unsightly orange house',
                ]);
              }
              if (step === 10)
                assert.equal(
                  await page.locator('tbody tr:first-child td').first().textContent(),
                  '2021',
                );
              if (step === 4) assert.equal(await page.locator('tbody tr.danger').count(), 1);
            }
          }
          if (scene === 'index' && action === '#run-10') {
            if (firstRunHashes)
              assert.deepEqual(hashes, firstRunHashes, 'Reload resets seed and IDs');
            else firstRunHashes = hashes;
          }
          assert.equal(
            hashes[0],
            hashes[1],
            `${engine}/${scene}/${action ?? 'initial'}: semantic DOM differs; see ${output}`,
          );
          assert.deepEqual(errors, [], `${engine}/${scene}: page errors`);
          console.log(JSON.stringify({ engine, scene, step, action, semanticSHA256: hashes[0] }));
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise<void>((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
}
