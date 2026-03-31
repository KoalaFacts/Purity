import { describe, expect, it } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { each, list } from '../src/control.ts';
import { state } from '../src/signals.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

const items1k = Array.from({ length: 1000 }, (_, i) => ({ id: i, text: `Item ${i}` }));
const items5k = Array.from({ length: 5000 }, (_, i) => ({ id: i, text: `Item ${i}` }));

describe('list() correctness', () => {
  it('renders 1000 items', () => {
    const container = document.createElement('div');
    container.appendChild(
      list(
        'li',
        () => items1k,
        (item) => item.text,
        (item) => item.id,
      ),
    );
    expect(container.querySelectorAll('li').length).toBe(1000);
    expect(container.querySelector('li')!.textContent).toBe('Item 0');
  });

  it('updates in place when keys match', async () => {
    const items = state(items1k);
    const container = document.createElement('div');
    container.appendChild(
      list(
        'li',
        () => items(),
        (item) => item.text,
        (item) => item.id,
      ),
    );
    await tick();

    items(Array.from({ length: 1000 }, (_, i) => ({ id: i, text: `Updated ${i}` })));
    await tick();

    expect(container.querySelector('li')!.textContent).toBe('Updated 0');
  });

  it('appends new items', async () => {
    const items = state(items1k.slice(0, 5));
    const container = document.createElement('div');
    container.appendChild(
      list(
        'li',
        () => items(),
        (item) => item.text,
        (item) => item.id,
      ),
    );
    await tick();
    expect(container.querySelectorAll('li').length).toBe(5);

    items([...items(), { id: 5, text: 'New' }]);
    await tick();
    expect(container.querySelectorAll('li').length).toBe(6);
  });

  it('removes items', async () => {
    const items = state(items1k.slice(0, 5));
    const container = document.createElement('div');
    container.appendChild(
      list(
        'li',
        () => items(),
        (item) => item.text,
        (item) => item.id,
      ),
    );
    await tick();

    items([items()[0], items()[4]]);
    await tick();
    expect(container.querySelectorAll('li').length).toBe(2);
  });

  it('supports options object', () => {
    const container = document.createElement('div');
    container.appendChild(
      list('div', () => items1k.slice(0, 3), {
        text: (item) => item.text,
        class: (item) => `item-${item.id}`,
        key: (item) => item.id,
      }),
    );
    expect(container.querySelectorAll('div').length).toBe(3);
    expect(container.querySelector('div')!.className).toBe('item-0');
    expect(container.querySelector('div')!.textContent).toBe('Item 0');
  });
});

describe('list() vs each() benchmark', () => {
  it('INITIAL 1000: list() vs each()', () => {
    // Warmup
    html`<li>${'x'}</li>`;
    list(
      'li',
      () => [{ id: 0, text: 'x' }],
      (i) => i.text,
      (i) => i.id,
    );

    let start = performance.now();
    list(
      'li',
      () => items1k,
      (item) => item.text,
      (item) => item.id,
    );
    const listTime = performance.now() - start;

    start = performance.now();
    each(
      () => items1k,
      (item) => html`<li>${item.text}</li>`,
      (item) => item.id,
    );
    const eachTime = performance.now() - start;

    console.log(`  list() 1000:  ${listTime.toFixed(2)}ms`);
    console.log(`  each() 1000:  ${eachTime.toFixed(2)}ms`);
    console.log(`  Speedup:      ${(eachTime / listTime).toFixed(1)}x`);
  });

  it('INITIAL 5000: list() vs each()', () => {
    let start = performance.now();
    list(
      'li',
      () => items5k,
      (item) => item.text,
      (item) => item.id,
    );
    const listTime = performance.now() - start;

    start = performance.now();
    each(
      () => items5k,
      (item) => html`<li>${item.text}</li>`,
      (item) => item.id,
    );
    const eachTime = performance.now() - start;

    console.log(`  list() 5000:  ${listTime.toFixed(2)}ms`);
    console.log(`  each() 5000:  ${eachTime.toFixed(2)}ms`);
    console.log(`  Speedup:      ${(eachTime / listTime).toFixed(1)}x`);
  });

  it('UPDATE 1000 in place: list() vs each()', async () => {
    const listItems = state(items1k);
    const eachItems = state(items1k);

    const c1 = document.createElement('div');
    c1.appendChild(
      list(
        'li',
        () => listItems(),
        (i) => i.text,
        (i) => i.id,
      ),
    );

    const c2 = document.createElement('div');
    c2.appendChild(
      each(
        () => eachItems(),
        (i) => html`<li>${i.text}</li>`,
        (i) => i.id,
      ),
    );

    await tick();

    const updated = Array.from({ length: 1000 }, (_, i) => ({ id: i, text: `U${i}` }));

    let start = performance.now();
    listItems(updated);
    await tick();
    const listTime = performance.now() - start;

    start = performance.now();
    eachItems(updated);
    await tick();
    const eachTime = performance.now() - start;

    console.log(`  list() update: ${listTime.toFixed(2)}ms`);
    console.log(`  each() update: ${eachTime.toFixed(2)}ms`);
  });

  it('RAW createElement baseline', () => {
    const start = performance.now();
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 1000; i++) {
      const li = document.createElement('li');
      li.appendChild(document.createTextNode(items1k[i].text));
      frag.appendChild(li);
    }
    console.log(`  raw createElement 1000: ${(performance.now() - start).toFixed(2)}ms`);
  });
});
