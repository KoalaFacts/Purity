import { describe, expect, it } from 'vite-plus/test';
import { onDispose } from '../src/component.ts';
import { each, list } from '../src/control.ts';
import { state } from '../src/signals.ts';

const tick = () => new Promise((resolve) => queueMicrotask(resolve));

describe('SV2-015 shared cold-path row detachment', () => {
  it('detaches every root and disposes each scope once across removal modes', async () => {
    const items = state([1, 2, 3]);
    const rows = new Map<number, Node[]>();
    const disposed: number[] = [];
    const container = document.createElement('div');
    container.appendChild(
      each(
        () => items(),
        (item: () => number) => {
          const id = item();
          const fragment = document.createDocumentFragment();
          const first = document.createElement('b');
          const second = document.createElement('i');
          first.textContent = `${id}-first`;
          second.textContent = `${id}-second`;
          fragment.append(first, second);
          rows.set(id, [first, second]);
          onDispose(() => disposed.push(id));
          return fragment;
        },
        (id: number) => id,
      ),
    );
    await tick();

    const retained = rows.get(2)!;
    items([2, 4]);
    await tick();
    expect(disposed).toEqual([1, 3]);
    expect(rows.get(1)!.every((node) => node.parentNode === null)).toBe(true);
    expect(rows.get(3)!.every((node) => node.parentNode === null)).toBe(true);
    expect(retained.every((node) => node.parentNode === container)).toBe(true);
    expect([...container.querySelectorAll('b,i')].map((node) => node.textContent)).toEqual([
      '2-first',
      '2-second',
      '4-first',
      '4-second',
    ]);

    items([]);
    await tick();
    expect(disposed).toEqual([1, 3, 2, 4]);
    const detached = [...rows.values()].every((nodes) =>
      nodes.every((node) => node.parentNode === null),
    );
    expect(detached).toBe(true);
    items([]);
    await tick();
    expect(disposed).toEqual([1, 3, 2, 4]);
  });

  it('removes list event closures on both selective removal and bulk clear', async () => {
    const items = state([{ id: 1 }, { id: 2 }]);
    const calls: number[] = [];
    const container = document.createElement('div');
    container.appendChild(
      list('button', () => items(), {
        text: (item) => String(item.id),
        key: (item) => item.id,
        events: {
          click: (item) => () => calls.push(item.id),
        },
      }),
    );
    await tick();

    const first = container.querySelectorAll('button')[0];
    const second = container.querySelectorAll('button')[1];
    items([{ id: 2 }]);
    await tick();
    expect(first.parentNode).toBeNull();
    expect(second.parentNode).toBe(container);
    first.dispatchEvent(new Event('click'));
    second.dispatchEvent(new Event('click'));
    expect(calls).toEqual([2]);

    items([]);
    await tick();
    expect(second.parentNode).toBeNull();
    second.dispatchEvent(new Event('click'));
    expect(calls).toEqual([2]);
  });
});
