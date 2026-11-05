import fc from 'fast-check';
import { describe, expect, it, vi } from 'vite-plus/test';
import { state } from '@purityjs/signals';
import { mount, onDispose } from '../src/component.ts';
import { each, list, when } from '../src/control.ts';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const firstOccurrence = (ids: number[]) => [...new Set(ids)];

// CQ-01: keyed reconcile trims the common head/tail and diffs only the changed
// window; CQ-02: owner node lists are rewritten only when rows change.
describe('each() keyed reconcile — window diff (CQ-01)', () => {
  it('computes each key exactly once per reconcile', async () => {
    const items = state([1, 2, 3, 4, 5]);
    let keyCalls = 0;
    const host = document.createElement('ul');
    host.appendChild(
      each(
        items,
        (item) => {
          const li = document.createElement('li');
          li.textContent = String(item());
          return li;
        },
        (item) => {
          keyCalls++;
          return item;
        },
      ) as DocumentFragment,
    );
    expect(keyCalls).toBe(5);
    for (const next of [
      [1, 2, 3, 4, 5],
      [5, 2, 3, 4, 1],
      [5, 2, 9, 3, 4, 1],
      [2, 9, 3],
    ]) {
      keyCalls = 0;
      items(next);
      await tick();
      expect(keyCalls).toBe(next.length);
      expect(host.textContent).toBe(next.join(''));
    }
  });

  it('moves only the two swapped rows of a 1,000-row list', async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => i);
    const items = state(ids);
    const host = document.createElement('ul');
    host.appendChild(
      each(items, (item) => {
        const li = document.createElement('li');
        li.textContent = String(item());
        return li;
      }) as DocumentFragment,
    );
    const before = Array.from(host.children);
    const observer = new MutationObserver(() => {});
    observer.observe(host, { childList: true });
    const swapped = ids.slice();
    swapped[1] = 998;
    swapped[998] = 1;
    items(swapped);
    await tick();
    const records = observer.takeRecords();
    observer.disconnect();
    const removed = records.reduce((n, r) => n + r.removedNodes.length, 0);
    expect(removed).toBeLessThanOrEqual(2);
    const after = Array.from(host.children);
    expect(after[1]).toBe(before[998]);
    expect(after[998]).toBe(before[1]);
    expect(after.filter((node, i) => node !== before[i])).toHaveLength(2);
  });

  it('inserts into the middle without moving the surrounding rows', async () => {
    const items = state([1, 2, 3, 4]);
    const host = document.createElement('ul');
    host.appendChild(
      each(items, (item) => {
        const li = document.createElement('li');
        li.textContent = String(item());
        return li;
      }) as DocumentFragment,
    );
    const [one, two, three, four] = Array.from(host.children);
    const observer = new MutationObserver(() => {});
    observer.observe(host, { childList: true });
    items([1, 2, 7, 8, 3, 4]);
    await tick();
    const records = observer.takeRecords();
    observer.disconnect();
    expect(records.reduce((n, r) => n + r.removedNodes.length, 0)).toBe(0);
    expect(host.textContent).toBe('127834');
    expect(Array.from(host.children).filter((n) => [one, two, three, four].includes(n))).toEqual([
      one,
      two,
      three,
      four,
    ]);
  });

  for (const api of ['each()', 'list()'] as const) {
    it(`${api} keeps first-occurrence order, row identity and disposal for random key sequences`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await fc.assert(
          fc.asyncProperty(
            fc.array(fc.array(fc.integer({ min: 0, max: 7 }), { maxLength: 10 }), {
              minLength: 1,
              maxLength: 8,
            }),
            async (sequence) => {
              const items = state<number[]>([]);
              const live = new Map<number, number>();
              const host = document.createElement('ul');
              const result = mount(() => {
                if (api === 'list()') return list<number>('li', items, (id) => String(id));
                return each(items, (item) => {
                  const id = item();
                  live.set(id, (live.get(id) ?? 0) + 1);
                  onDispose(() => live.set(id, live.get(id)! - 1));
                  const li = document.createElement('li');
                  li.textContent = String(id);
                  return li;
                }) as DocumentFragment;
              }, host);
              let previous = new Map<string, Element>();
              for (const ids of sequence) {
                items(ids);
                await tick();
                const expected = firstOccurrence(ids).map(String);
                const rows = Array.from(host.querySelectorAll('li'));
                expect(rows.map((li) => li.textContent)).toEqual(expected);
                const current = new Map(rows.map((li) => [li.textContent!, li]));
                for (const [key, node] of current) {
                  if (previous.has(key)) expect(node).toBe(previous.get(key));
                }
                if (api === 'each()') {
                  for (const [id, count] of live) {
                    expect(count).toBe(current.has(String(id)) ? 1 : 0);
                  }
                }
                previous = current;
              }
              result.unmount();
              for (const count of live.values()) expect(count).toBe(0);
            },
          ),
          { numRuns: 150 },
        );
      } finally {
        warn.mockRestore();
      }
    });
  }
});

describe('each() inside a when() branch — owner node list (CQ-02)', () => {
  it('keeps the branch node list in row order across reorders and re-shows', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uniqueArray(fc.integer({ min: 0, max: 9 }), { maxLength: 8 }), {
          minLength: 1,
          maxLength: 6,
        }),
        async (sequence) => {
          const items = state<number[]>([0, 1, 2]);
          const show = state(true);
          const host = document.createElement('div');
          const result = mount(
            () =>
              when(
                () => show(),
                () => {
                  const fragment = document.createDocumentFragment();
                  const head = document.createElement('h1');
                  head.textContent = 'H';
                  fragment.appendChild(head);
                  fragment.appendChild(
                    each(items, (item) => {
                      const span = document.createElement('span');
                      span.textContent = String(item());
                      return span;
                    }) as DocumentFragment,
                  );
                  const foot = document.createElement('footer');
                  foot.textContent = 'F';
                  fragment.appendChild(foot);
                  return fragment;
                },
              ) as DocumentFragment,
            host,
          );
          for (const ids of sequence) {
            items(ids);
            await tick();
            expect(host.textContent).toBe(`H${ids.join('')}F`);
            show(false);
            await tick();
            expect(host.textContent).toBe('');
            show(true);
            await tick();
            expect(host.textContent).toBe(`H${ids.join('')}F`);
          }
          result.unmount();
          expect(host.textContent).toBe('');
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('each() nested as a row root of another each() — row node list (CQ-02)', () => {
  it('moves outer rows together with their reordered inner rows', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            outer: fc.uniqueArray(fc.integer({ min: 0, max: 3 }), { maxLength: 4 }),
            inner: fc.uniqueArray(fc.integer({ min: 0, max: 5 }), { maxLength: 5 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        async (steps) => {
          const outer = state<number[]>([0, 1, 2]);
          const inner = state<number[]>([0, 1]);
          const host = document.createElement('div');
          const result = mount(
            () =>
              each(outer, (group) => {
                const g = group();
                // The row root is the inner each() itself, so the outer row's
                // node list must follow every inner reconcile.
                return each(inner, (item) => {
                  const b = document.createElement('b');
                  b.textContent = `${g}${item()}`;
                  return b;
                }) as DocumentFragment;
              }) as DocumentFragment,
            host,
          );
          const render = () =>
            outer()
              .map((g) =>
                inner()
                  .map((i) => `${g}${i}`)
                  .join(''),
              )
              .join('');
          for (const step of steps) {
            inner(step.inner);
            await tick();
            expect(host.textContent).toBe(render());
            outer(step.outer);
            await tick();
            expect(host.textContent).toBe(render());
          }
          result.unmount();
          expect(host.textContent).toBe('');
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('each() window anchor with empty rows in the retained tail', () => {
  for (const suffix of [['E'], ['E', 'C']]) {
    it(`keeps a changed row before an empty tail row and a trailing sibling (tail ${suffix.join(',')})`, async () => {
      const items = state(['A', 'B', ...suffix]);
      const host = document.createElement('div');
      const app = mount(() => {
        const fragment = document.createDocumentFragment();
        fragment.appendChild(
          each(items, (item) => {
            if (item() === 'E') return document.createDocumentFragment();
            const row = document.createElement('span');
            row.textContent = item();
            return row;
          }) as DocumentFragment,
        );
        const footer = document.createElement('footer');
        footer.textContent = 'FOOT';
        fragment.appendChild(footer);
        return fragment;
      }, host);
      try {
        items(['A', 'X', ...suffix]);
        await tick();
        expect(host.textContent).toBe(`AX${suffix.includes('C') ? 'C' : ''}FOOT`);
        expect(host.lastChild?.nodeName).toBe('FOOTER');
      } finally {
        app.unmount();
      }
    });
  }
});

describe('each() with rows that render no nodes', () => {
  it('keeps order before a trailing sibling for random key sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uniqueArray(fc.integer({ min: 0, max: 9 }), { maxLength: 9 }), {
          minLength: 1,
          maxLength: 8,
        }),
        async (sequence) => {
          const items = state<number[]>([]);
          const host = document.createElement('div');
          const app = mount(() => {
            const fragment = document.createDocumentFragment();
            fragment.appendChild(
              each(items, (item) => {
                // Even ids render an empty fragment.
                if (item() % 2 === 0) return document.createDocumentFragment();
                const row = document.createElement('span');
                row.textContent = String(item());
                return row;
              }) as DocumentFragment,
            );
            const footer = document.createElement('footer');
            footer.textContent = 'F';
            fragment.appendChild(footer);
            return fragment;
          }, host);
          for (const ids of sequence) {
            items(ids);
            await tick();
            expect(host.textContent).toBe(`${ids.filter((id) => id % 2 === 1).join('')}F`);
          }
          app.unmount();
        },
      ),
      { numRuns: 150 },
    );
  });
});
