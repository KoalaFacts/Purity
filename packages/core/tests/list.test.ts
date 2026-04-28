import { describe, expect, it } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { mount } from '../src/component.ts';
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

  it('supports style, attrs, and events accessors', () => {
    const clicks: number[] = [];
    const container = document.createElement('div');
    container.appendChild(
      list('button', () => items1k.slice(0, 3), {
        text: (item) => item.text,
        style: (item) => `color: hsl(${item.id * 30}, 50%, 50%)`,
        attrs: { 'data-id': (item) => String(item.id) },
        events: { click: (item) => () => clicks.push(item.id) },
        key: (item) => item.id,
      }),
    );
    const btns = container.querySelectorAll('button');
    expect(btns[0].getAttribute('style')).toContain('color:');
    expect(btns[1].getAttribute('data-id')).toBe('1');
    btns[2].click();
    expect(clicks).toEqual([2]);
  });

  it('updates accessors in place on key match', async () => {
    const items = state([{ id: 1, text: 'A' }]);
    const container = document.createElement('div');
    container.appendChild(
      list('div', () => items(), {
        text: (i) => i.text,
        class: (i) => `c-${i.id}`,
        style: (i) => `padding: ${i.id}px`,
        attrs: { 'data-x': (i) => String(i.id) },
        key: (i) => i.id,
      }),
    );
    await tick();
    const div = container.querySelector('div')!;

    items([{ id: 1, text: 'B' }]);
    await tick();
    expect(div.textContent).toBe('B');
    expect(container.querySelector('div')).toBe(div);
  });

  it('clears all items via Range', async () => {
    const items = state(items1k.slice(0, 5));
    const container = document.createElement('div');
    container.appendChild(
      list('li', () => items(), {
        text: (i) => i.text,
        key: (i) => i.id,
      }),
    );
    await tick();
    expect(container.querySelectorAll('li').length).toBe(5);

    items([]);
    await tick();
    expect(container.querySelectorAll('li').length).toBe(0);
  });

  it('replaces all items (no key reuse)', async () => {
    const items = state([
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ]);
    const container = document.createElement('div');
    container.appendChild(
      list('li', () => items(), {
        text: (i) => i.text,
        key: (i) => i.id,
      }),
    );
    await tick();

    items([
      { id: 3, text: 'C' },
      { id: 4, text: 'D' },
    ]);
    await tick();
    const lis = container.querySelectorAll('li');
    expect([...lis].map((l) => l.textContent)).toEqual(['C', 'D']);
  });

  it('reorders via LIS path', async () => {
    const items = state([1, 2, 3, 4, 5].map((i) => ({ id: i, text: `i${i}` })));
    const container = document.createElement('div');
    container.appendChild(
      list('li', () => items(), {
        text: (i) => i.text,
        key: (i) => i.id,
      }),
    );
    await tick();

    items([
      { id: 5, text: 'i5' },
      { id: 4, text: 'i4' },
      { id: 3, text: 'i3' },
      { id: 2, text: 'i2' },
      { id: 1, text: 'i1' },
    ]);
    await tick();
    expect([...container.querySelectorAll('li')].map((l) => l.textContent)).toEqual([
      'i5',
      'i4',
      'i3',
      'i2',
      'i1',
    ]);
  });

  it('removes some items while keeping others', async () => {
    const items = state([1, 2, 3, 4, 5].map((i) => ({ id: i, text: `i${i}` })));
    const container = document.createElement('div');
    container.appendChild(
      list('li', () => items(), {
        text: (i) => i.text,
        key: (i) => i.id,
      }),
    );
    await tick();

    items([
      { id: 1, text: 'i1' },
      { id: 3, text: 'i3' },
      { id: 5, text: 'i5' },
    ]);
    await tick();
    expect([...container.querySelectorAll('li')].map((l) => l.textContent)).toEqual([
      'i1',
      'i3',
      'i5',
    ]);
  });

  it('list() without an explicit key function uses item identity', async () => {
    const items = state(['A', 'B', 'C']);
    const c = document.createElement('div');
    c.appendChild(
      list(
        'li',
        () => items(),
        (i) => i,
      ),
    );
    await tick();
    expect(c.querySelectorAll('li').length).toBe(3);

    items(['A', 'B', 'D']);
    await tick();
    expect([...c.querySelectorAll('li')].map((l) => l.textContent)).toEqual(['A', 'B', 'D']);
  });

  it('list() with options-object but no key uses item identity', async () => {
    const items = state(['A', 'B']);
    const c = document.createElement('div');
    c.appendChild(
      list('li', () => items(), {
        text: (i) => i,
      }),
    );
    await tick();
    expect(c.querySelectorAll('li').length).toBe(2);
  });

  it('list() with array passed directly (not function)', () => {
    const c = document.createElement('div');
    c.appendChild(
      list('li', items1k.slice(0, 4), {
        text: (i) => i.text,
        key: (i) => i.id,
      }),
    );
    expect(c.querySelectorAll('li').length).toBe(4);
  });

  it('list() prepends new items via prepend fast path', async () => {
    const items = state([
      { id: 'C', text: 'C' },
      { id: 'D', text: 'D' },
    ]);
    const c = document.createElement('div');
    c.appendChild(
      list('li', () => items(), {
        text: (i) => i.text,
        key: (i) => i.id,
      }),
    );
    await tick();
    const beforeC = c.querySelectorAll('li')[0];

    items([
      { id: 'A', text: 'A' },
      { id: 'B', text: 'B' },
      { id: 'C', text: 'C' },
      { id: 'D', text: 'D' },
    ]);
    await tick();
    const lis = c.querySelectorAll('li');
    expect([...lis].map((l) => l.textContent)).toEqual(['A', 'B', 'C', 'D']);
    // Existing C node preserved
    expect(lis[2]).toBe(beforeC);
  });

  it('list() interleaved insertion falls through to LIS', async () => {
    // prev=[A,B,C], new=[X,A,Y,B,C] — neither append nor prepend matches.
    const items = state([
      { id: 'A', text: 'A' },
      { id: 'B', text: 'B' },
      { id: 'C', text: 'C' },
    ]);
    const c = document.createElement('div');
    c.appendChild(
      list('li', () => items(), {
        text: (i) => i.text,
        key: (i) => i.id,
      }),
    );
    await tick();

    items([
      { id: 'X', text: 'X' },
      { id: 'A', text: 'A' },
      { id: 'Y', text: 'Y' },
      { id: 'B', text: 'B' },
      { id: 'C', text: 'C' },
    ]);
    await tick();
    expect([...c.querySelectorAll('li')].map((l) => l.textContent)).toEqual([
      'X',
      'A',
      'Y',
      'B',
      'C',
    ]);
  });

  it('disposes when wrapped in mount', async () => {
    const items = state([{ id: 1, text: 'A' }]);
    const container = document.createElement('div');
    const { unmount } = mount(
      () =>
        list('li', () => items(), {
          text: (i) => i.text,
          key: (i) => i.id,
        }),
      container,
    );
    await tick();
    expect(container.querySelectorAll('li').length).toBe(1);

    unmount();
    items([
      { id: 1, text: 'A' },
      { id: 2, text: 'B' },
    ]);
    await tick();
    expect(container.querySelectorAll('li').length).toBe(0);
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
