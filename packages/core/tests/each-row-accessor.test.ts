import { describe, expect, it } from 'vite-plus/test';
import { state, watch } from '@purityjs/signals';
import { each } from '../src/control.ts';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

// CQ-05: each() rows hold their item in a bare reader signal (no get/set/peek
// closures). The row reader is `() => T`; an update stores the new item as a
// value, never as an updater callback.
describe('each() row item accessor (CQ-05)', () => {
  it('stores function items as values on update instead of calling them as updaters', async () => {
    const first = () => 'first';
    const second = () => 'second';
    const items = state<Array<() => string>>([first]);
    const seen: string[] = [];
    const host = document.createElement('div');
    host.appendChild(
      each(
        items,
        (item) => {
          const span = document.createElement('span');
          watch(() => {
            span.textContent = item()();
          });
          return span;
        },
        () => 'row',
      ) as DocumentFragment,
    );
    await tick();
    seen.push(host.textContent!);

    items([second]);
    await tick();
    seen.push(host.textContent!);

    expect(seen).toEqual(['first', 'second']);
  });

  it('row reader tracks updates and skips equal writes', async () => {
    const items = state([{ id: 1, label: 'a' }]);
    let runs = 0;
    const host = document.createElement('div');
    host.appendChild(
      each(
        items,
        (item) => {
          const span = document.createElement('span');
          watch(() => {
            runs++;
            span.textContent = item().label;
          });
          return span;
        },
        (row) => row.id,
      ) as DocumentFragment,
    );
    await tick();
    const row = items()[0];
    items([row]);
    await tick();
    expect(runs).toBe(1);

    items([{ id: 1, label: 'b' }]);
    await tick();
    expect(runs).toBe(2);
    expect(host.textContent).toBe('b');
  });

  it('row reader has no own get/set/peek properties', () => {
    let reader: (() => number) | undefined;
    each([1], (item) => {
      reader = item;
      return document.createTextNode('');
    });
    expect(typeof reader).toBe('function');
    expect(Object.keys(reader!)).toEqual([]);
  });
});
