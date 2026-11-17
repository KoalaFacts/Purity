import { describe, expect, it } from 'vite-plus/test';
import { state, watch } from '@purityjs/signals';
import { mount, onDispose } from '../src/component.ts';
import { each } from '../src/control.ts';
import { html } from '../src/compiler/compile.ts';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

interface Row {
  id: number;
  label: string;
}

// SV2-008: each() hands the row renderer a current-position accessor as its
// third argument, so ordinal labels and position-based actions stay correct
// after a keyed reorder without re-rendering the row.
function renderRows(rows: ReturnType<typeof state<Row[]>>, log?: string[]) {
  const host = document.createElement('ul');
  const { unmount: dispose } = mount(() => {
    const frag = each(
      rows,
      (row, _index, position) => {
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
    );
    return frag as DocumentFragment;
  }, host);
  return { host, dispose };
}

const texts = (host: Element) => [...host.querySelectorAll('span')].map((s) => s.textContent);

describe('each() current position (SV2-008)', () => {
  it('updates the position of retained rows on prepend, reverse and same-ID replace', async () => {
    const rows = state<Row[]>([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
    ]);
    const { host } = renderRows(rows);
    await tick();
    expect(texts(host)).toEqual(['1. a', '2. b', '3. c']);
    const [li1, li2, li3] = [...host.querySelectorAll('li')];
    host.querySelectorAll('input')[1].value = 'typed in b';

    // Prepend: every retained row is in the trimmed tail and shifts by one.
    rows([{ id: 0, label: 'z' }, ...rows()]);
    await tick();
    expect(texts(host)).toEqual(['1. z', '2. a', '3. b', '4. c']);
    expect([...host.querySelectorAll('li')].slice(1)).toEqual([li1, li2, li3]);

    // Reverse.
    rows([...rows()].reverse());
    await tick();
    expect(texts(host)).toEqual(['1. c', '2. b', '3. a', '4. z']);
    expect(host.querySelectorAll('li')[0]).toBe(li3);
    expect(host.querySelectorAll('input')[1].value).toBe('typed in b');

    // Replace every object with a new one carrying the same id.
    rows(rows().map((r) => ({ ...r, label: r.label.toUpperCase() })));
    await tick();
    expect(texts(host)).toEqual(['1. C', '2. B', '3. A', '4. Z']);
    expect(host.querySelectorAll('li')[0]).toBe(li3);
    expect(host.querySelectorAll('input')[1].value).toBe('typed in b');
  });

  it('returns the current position when first read after reorders (lazy accessor)', async () => {
    const rows = state<Row[]>([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ]);
    const host = document.createElement('div');
    const positions = new Map<number, () => number>();
    mount(
      () =>
        each(
          rows,
          (row, _i, position) => {
            positions.set(row().id, position);
            return document.createElement('p');
          },
          (row) => row.id,
        ) as DocumentFragment,
      host,
    );
    rows([{ id: 3, label: 'c' }, { id: 2, label: 'b' }, ...rows().slice(0, 1)]);
    await tick();
    expect(positions.get(1)!()).toBe(2);
    expect(positions.get(2)!()).toBe(1);
    expect(positions.get(3)!()).toBe(0);
  });

  it('position-based actions use the current index', async () => {
    const rows = state<Row[]>([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
    ]);
    const { host } = renderRows(rows);
    await tick();
    const removeAt = (i: number) => rows(rows().filter((_, j) => j !== i));
    const at = (li: Element) => (li as HTMLLIElement & { at: () => number }).at();
    const liC = host.querySelectorAll('li')[2];
    rows([rows()[2], rows()[0], rows()[1]]); // c, a, b
    await tick();
    removeAt(at(liC)); // must remove c (now at 0), not b (its creation index 2)
    await tick();
    expect(texts(host)).toEqual(['1. a', '2. b']);
  });

  it('a removed row releases its position watcher once and is not updated again', async () => {
    const rows = state<Row[]>([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ]);
    const log: string[] = [];
    const { host, dispose } = renderRows(rows, log);
    await tick();
    const removed = host.querySelectorAll('span')[0];
    rows([{ id: 2, label: 'b' }]);
    await tick();
    expect(log).toEqual(['dispose 1']);
    expect(removed.textContent).toBe('1. a');
    rows([{ id: 9, label: 'x' }, ...rows()]);
    await tick();
    expect(removed.textContent).toBe('1. a');
    expect(texts(host)).toEqual(['1. x', '2. b']);
    dispose();
    expect(log.sort()).toEqual(['dispose 1', 'dispose 2', 'dispose 9']);
  });

  it('works with html templates (JIT) and keeps the creation-time index argument', async () => {
    const rows = state([10, 20]);
    const seen: number[] = [];
    const host = document.createElement('div');
    mount(
      () =>
        html`<ol>
          ${each(rows, (n, index, position) => {
            seen.push(index);
            return html`<li>${() => `${position()}:${n()}`}</li>`;
          })}
        </ol>`,
      host,
    );
    await tick();
    rows([5, 10, 20]);
    await tick();
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '0:5',
      '1:10',
      '2:20',
    ]);
    expect(seen).toEqual([0, 1, 0]);
  });
});

describe('each() current position after hydration (SV2-008)', () => {
  it('adopted SSR rows receive their current position on a later reorder', async () => {
    const { defaultEachHydrationAdapter } = await import('../src/control.ts');
    const { inflateDeferredEach } = await import('../src/control/hydrate.ts');
    const { disposeScope, popContext, pushContext } = await import('@purityjs/signals');
    const host = document.createElement('div');
    host.innerHTML = '<!--e--><!--er:1--><i>0</i><!--/er--><!--er:2--><i>1</i><!--/er--><!--/e-->';
    const close = document.createComment('slot-end');
    host.appendChild(close);
    const items = state([1, 2]);
    const owner = { disposers: null };
    pushContext(owner);
    try {
      inflateDeferredEach(
        {
          __purity_deferred_each__: true,
          adapter: defaultEachHydrationAdapter,
          listAccessor: items,
          keyFn: (item: number) => item,
          mapFn: (_item, _index, position) => {
            const row = document.createElement('i');
            watch(() => {
              row.textContent = String(position());
            });
            return row;
          },
        },
        Array.from(host.childNodes).slice(0, -1),
        close,
      );
    } finally {
      popContext();
    }
    try {
      await tick();
      const before = [...host.querySelectorAll('i')];
      expect(before.map((i) => i.textContent)).toEqual(['0', '1']);
      items([3, 2, 1]);
      await tick();
      const after = [...host.querySelectorAll('i')];
      expect(after.map((i) => i.textContent)).toEqual(['0', '1', '2']);
      expect(after[1]).toBe(before[1]);
      expect(after[2]).toBe(before[0]);
    } finally {
      disposeScope(owner);
    }
  });
});
