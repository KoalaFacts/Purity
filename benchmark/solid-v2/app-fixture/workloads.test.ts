// Node DOM checks of actual built rc.18 modules; not browser or timing evidence.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { SourceTextModule } from 'node:vm';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const dist = resolve(import.meta.dirname, 'dist-workloads');
async function load(scene: string) {
  assert.ok(existsSync(resolve(dist, `${scene}.html`)), `Missing built ${scene} workload`);
  const html = readFileSync(resolve(dist, `${scene}.html`), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://fixture.invalid/' });
  const context = dom.getInternalVMContext();
  // jsdom does not load preload links; these fetches do not drive fixture state.
  dom.window.fetch = async () => new Response();
  const modules = new Map<string, SourceTextModule>();
  const module = (file: string): SourceTextModule => {
    assert.ok(file.startsWith(dist + '/'), 'Module escaped built fixture');
    if (!modules.has(file)) {
      modules.set(
        file,
        new SourceTextModule(readFileSync(file, 'utf8'), { context, identifier: file }),
      );
    }
    return modules.get(file)!;
  };
  const script = dom.window.document.querySelector('script[type="module"]')!;
  const entry = module(resolve(dist, script.getAttribute('src')!.replace(/^\//, '')));
  await entry.link((specifier, parent) => module(resolve(dirname(parent.identifier), specifier)));
  await entry.evaluate();
  const settle = () => new Promise<void>((done) => setTimeout(done, 0));
  await settle();
  const doc = dom.window.document;
  const click = async (selector: string) => {
    const element = doc.querySelector<HTMLElement>(selector);
    assert.ok(element, `Missing action ${selector}`);
    element.click();
    await settle();
  };
  return { dom, doc, click, settle };
}

test('rc18 rows retain nodes on label writes, preserve data sequence and reset on reload', async () => {
  const { dom, doc, click } = await load('rows');
  try {
    await click('#run-10');
    const labels = () => Array.from(doc.querySelectorAll('.lbl'), (n) => n.textContent);
    assert.deepEqual(labels(), [
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
    await click('#add-10');
    const nodes = [...doc.querySelectorAll('tbody tr')];
    await click('tbody tr:first-child .lbl');
    await click('#update');
    assert.deepEqual([...doc.querySelectorAll('tbody tr')], nodes);
    assert.equal(labels()[0], 'expensive blue car !!!');
    assert.equal(doc.querySelectorAll('tr.danger').length, 1);
    await click('tbody tr:nth-child(2) .remove');
    assert.equal(doc.querySelectorAll('tbody tr').length, 19);
    await click('#run');
    const beforeSwap = [...doc.querySelectorAll('tbody tr')];
    await click('#swaprows');
    assert.equal(doc.querySelectorAll('tbody tr')[1], beforeSwap[998]);
    await click('#add');
    await click('#clear');
    assert.equal(doc.querySelectorAll('tbody tr').length, 0);
    await click('#run');
    assert.equal(doc.querySelector('tbody tr td')!.textContent, '2021');
  } finally {
    dom.window.close();
  }
  const reloaded = await load('rows');
  try {
    await reloaded.click('#run-10');
    assert.equal(reloaded.doc.querySelector('tbody tr td')!.textContent, '1');
    assert.equal(reloaded.doc.querySelector('.lbl')!.textContent, 'expensive blue car');
  } finally {
    reloaded.dom.window.close();
  }
});

test('rc18 binding clears user input and owns fresh fields when numeric IDs repeat', async () => {
  const { dom, doc, click, settle } = await load('binding');
  try {
    await click('#create-100');
    const inputs = () => [...doc.querySelectorAll<HTMLInputElement>('#container input')];
    assert.equal(inputs().length, 100);
    assert.deepEqual(
      inputs().map((n) => [...n.labels!].map((l) => l.textContent)),
      Array.from({ length: 100 }, (_, i) => [`Field ${i + 1}:`]),
    );
    for (const phase of ['created', 'updated', 'cleared', 'recreated']) {
      if (phase === 'recreated') {
        const old = inputs()[0];
        await click('#create-100');
        assert.notEqual(inputs()[0], old);
      }
      if (phase === 'updated' || phase === 'recreated') {
        await click('#update-all');
        assert.deepEqual(
          inputs().map((n) => n.value),
          Array.from({ length: 100 }, (_, i) => `updated-${i + 1}`),
        );
      }
      const first = inputs()[0];
      first.value = `typed-${phase}`;
      first.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      await settle();
      await click('#clear-all');
      assert.deepEqual(
        inputs().map((n) => n.value),
        Array(100).fill(''),
      );
    }
    await click('#read-all');
    assert.equal(doc.querySelector('#result')!.textContent, 'Read 100 fields');
  } finally {
    dom.window.close();
  }
});
