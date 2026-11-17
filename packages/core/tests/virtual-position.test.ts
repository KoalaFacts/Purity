import { describe, expect, it } from 'vite-plus/test';
import { state, watch } from '@purityjs/signals';
import { mount, onDispose } from '../src/component.ts';
import { virtualEach } from '../src/virtual.ts';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

interface Row {
  id: number;
  label: string;
}

// SV2-008 slice 2: virtualEach() hands its row renderer the same current-position
// accessor as each(): the row's index in the full source list (not its index in
// the rendered window), updated on every reconcile without re-rendering the row.
function renderRows(rows: ReturnType<typeof state<Row[]>>, log?: string[]) {
  const host = document.createElement('ul');
  host.style.cssText = 'height:960px;overflow-y:auto';
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 960 });
  document.body.appendChild(host);
  let renders = 0;
  const { unmount } = mount(
    () =>
      virtualEach(
        rows,
        (row, _index, position) => {
          renders++;
          const li = document.createElement('li');
          const input = document.createElement('input');
          const span = document.createElement('span');
          li.append(span, input);
          watch(() => {
            span.textContent = `${position() + 1}. ${row().label}`;
          });
          onDispose(() => log?.push(`dispose ${row().id}`));
          (li as HTMLLIElement & { at?: () => number }).at = position;
          return li;
        },
        (row) => row.id,
      ) as DocumentFragment,
    host,
  );
  return {
    host,
    unmount: () => {
      unmount();
      host.remove();
    },
    renders: () => renders,
  };
}

const texts = (host: Element) => [...host.querySelectorAll('span')].map((s) => s.textContent);
const rowsOf = (n: number, from = 0): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: from + i, label: `r${from + i}` }));

describe('virtualEach() current position (SV2-008 slice 2)', () => {
  it('passes a position accessor that follows keyed prepend and reverse', async () => {
    const rows = state<Row[]>(rowsOf(3, 1));
    const { host, renders, unmount } = renderRows(rows);
    await tick();
    expect(texts(host)).toEqual(['1. r1', '2. r2', '3. r3']);
    const [li1, li2, li3] = [...host.querySelectorAll('li:not([data-purity-window-spacer])')];
    host.querySelectorAll('input')[1].value = 'typed';
    expect(renders()).toBe(3);

    // Same length: the window covers every row, so only positions change.
    rows([{ id: 0, label: 'r0' }, rows()[0], rows()[1]]);
    await tick();
    expect(texts(host)).toEqual(['1. r0', '2. r1', '3. r2']);
    const after = [...host.querySelectorAll('li:not([data-purity-window-spacer])')];
    expect(after.slice(1)).toEqual([li1, li2]);
    expect(li3.isConnected).toBe(false);

    rows([...rows()].reverse());
    await tick();
    expect(texts(host)).toEqual(['1. r2', '2. r1', '3. r0']);
    expect(host.querySelectorAll('input')[0].value).toBe('typed');
    expect(renders()).toBe(4);
    unmount();
  });

  it('updates retained rows to their new source index after rows before them are removed', async () => {
    const rows = state<Row[]>(rowsOf(100));
    const { host, unmount } = renderRows(rows);
    await tick();
    const first = host.querySelector('li:not([data-purity-window-spacer])') as HTMLLIElement & {
      at: () => number;
    };
    expect(first.at()).toBe(0);
    // Drop the first 70 rows: the retained rows keep their nodes and their
    // positions shift to their new source indices.
    const retained = [...host.querySelectorAll('li:not([data-purity-window-spacer])')].slice(
      30,
    ) as (HTMLLIElement & { at: () => number })[];
    const before = retained.map((li) => li.at());
    rows(rows().slice(10));
    await tick();
    expect(retained.map((li) => li.at())).toEqual(before.map((p) => p - 10));
    expect(texts(host)[0]).toBe('1. r10');
    unmount();
  });

  it('reports the source-list index, not the window index, after scrolling', async () => {
    // jsdom has no layout: stub the viewport, row and spacer boxes (24px rows).
    const settle = async () => {
      await new Promise<void>((r) => setTimeout(r, 80));
      await tick();
      await tick();
    };
    const items = state(Array.from({ length: 100 }, (_, i) => i));
    const host = document.createElement('ul');
    host.style.cssText = 'height:96px;overflow-y:auto';
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 96 });
    host.getBoundingClientRect = () => new DOMRect(0, 0, 200, 96);
    document.body.appendChild(host);
    const { unmount } = mount(
      () =>
        virtualEach(
          items,
          (item, _index, position) => {
            const li = document.createElement('li') as HTMLLIElement & { at?: () => number };
            li.textContent = String(item());
            li.at = position;
            li.getBoundingClientRect = () =>
              new DOMRect(0, position() * 24 - host.scrollTop, 200, 24);
            return li;
          },
          (item) => item,
        ) as DocumentFragment,
      host,
    );
    await tick();
    await tick();
    const top = host.querySelector<HTMLElement>('[data-purity-window-spacer]')!;
    top.getBoundingClientRect = () => new DOMRect(0, -host.scrollTop, 200, 0);
    host.scrollTop = 1200;
    host.dispatchEvent(new Event('scroll'));
    await settle();

    const rowsNow = () =>
      [...host.querySelectorAll('li:not([data-purity-window-spacer])')] as (HTMLLIElement & {
        at: () => number;
      })[];
    const first = rowsNow()[0];
    const value = Number(first.textContent);
    expect(value).toBeGreaterThan(30);
    expect(first.at()).toBe(value);

    // Prepend before the window: the visible row keeps its node and shifts by one.
    items([-1, ...items()]);
    await settle();
    expect(first.isConnected).toBe(true);
    expect(first.at()).toBe(value + 1);
    unmount();
    host.remove();
  });

  it('keeps the position lazy and stops updating removed rows', async () => {
    const log: string[] = [];
    const rows = state<Row[]>(rowsOf(3, 1));
    const { host, unmount } = renderRows(rows, log);
    await tick();
    const second = host.querySelectorAll(
      'li:not([data-purity-window-spacer])',
    )[1] as HTMLLIElement & {
      at: () => number;
    };
    rows([rows()[0], rows()[2]]);
    await tick();
    expect(log).toEqual(['dispose 2']);
    expect(texts(host)).toEqual(['1. r1', '2. r3']);
    rows([{ id: 9, label: 'r9' }, ...rows()]);
    await tick();
    expect(second.at()).toBe(1);
    unmount();
    expect(log.sort()).toEqual(['dispose 1', 'dispose 2', 'dispose 3', 'dispose 9']);
  });
});
