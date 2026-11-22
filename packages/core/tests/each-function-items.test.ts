import { describe, expect, it } from 'vite-plus/test';
import { state } from '@purityjs/signals';
import { mount } from '../src/component.ts';
import { each } from '../src/control.ts';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

// each() keeps a row's item in a signal. A row whose item is itself a
// function (a handler, a factory, an accessor) must receive the new function
// as its value on update — never have it invoked as a state updater.
describe('each() with function-valued items', () => {
  it('stores the new function as the row item instead of calling it', async () => {
    let calls = 0;
    const first = () => 'first';
    const second = () => {
      calls++;
      return 'second';
    };
    const items = state<Array<() => string>>([first]);
    const seen: Array<() => string> = [];
    const host = document.createElement('div');
    const { unmount } = mount(() => {
      return each(
        items,
        (item) => {
          const span = document.createElement('span');
          seen.push(item());
          span.textContent = item()();
          return span;
        },
        (_item, index) => index,
      ) as DocumentFragment;
    }, host);

    items([second]);
    await tick();

    expect(calls).toBe(0);
    expect(seen[0]).toBe(first);
    unmount();
  });

  it('a reactive read of the row item sees the replaced function', async () => {
    const a = () => 'a';
    const b = () => 'b';
    const items = state<Array<() => string>>([a]);
    let rowItem: (() => () => string) | undefined;
    const host = document.createElement('div');
    const { unmount } = mount(() => {
      return each(
        items,
        (item) => {
          rowItem = item;
          return document.createElement('span');
        },
        (_item, index) => index,
      ) as DocumentFragment;
    }, host);

    items([b]);
    await tick();

    expect(rowItem?.()).toBe(b);
    expect(rowItem?.()()).toBe('b');
    unmount();
  });
});
