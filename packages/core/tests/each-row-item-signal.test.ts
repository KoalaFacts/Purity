import { describe, expect, it } from 'vite-plus/test';
import { state, watch } from '@purityjs/signals';
import { mount } from '../src/component.ts';
import { each } from '../src/control.ts';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

// CQ-05: an each() row keeps its item (and its lazily created position) in a
// bare item signal — one function object, no `get`/`set`/`peek` closures —
// while staying reactive for keyed updates and moves.
describe('each() row item signal', () => {
  it('hands the row a bare reader without state() property closures', () => {
    let rowItem: (() => unknown) | undefined;
    const host = document.createElement('div');
    const { unmount } = mount(
      () =>
        each(
          [1],
          (item) => {
            rowItem = item;
            return document.createElement('span');
          },
          (_item, index) => index,
        ) as DocumentFragment,
      host,
    );
    expect(typeof rowItem).toBe('function');
    expect(Object.keys(rowItem!)).toEqual([]);
    expect('get' in rowItem! || 'set' in rowItem! || 'peek' in rowItem!).toBe(false);
    unmount();
  });

  it('a reactive read of the row item tracks a same-key replacement', async () => {
    const items = state([{ id: 1, label: 'a' }]);
    const host = document.createElement('div');
    const { unmount } = mount(
      () =>
        each(
          items,
          (item) => {
            const span = document.createElement('span');
            watch(() => {
              span.textContent = item().label;
            });
            return span;
          },
          (item) => item.id,
        ) as DocumentFragment,
      host,
    );
    expect(host.textContent).toBe('a');
    items([{ id: 1, label: 'b' }]);
    await tick();
    expect(host.textContent).toBe('b');
    unmount();
  });

  it('the position reader tracks moves after its first read', async () => {
    const items = state(['x', 'y']);
    const positions = new Map<string, number>();
    const host = document.createElement('div');
    const { unmount } = mount(
      () =>
        each(
          items,
          (item, _index, position) => {
            const label = item();
            watch(() => {
              positions.set(label, position());
            });
            return document.createElement('span');
          },
          (item) => item,
        ) as DocumentFragment,
      host,
    );
    expect([positions.get('x'), positions.get('y')]).toEqual([0, 1]);
    items(['y', 'x']);
    await tick();
    expect([positions.get('x'), positions.get('y')]).toEqual([1, 0]);
    unmount();
  });
});
