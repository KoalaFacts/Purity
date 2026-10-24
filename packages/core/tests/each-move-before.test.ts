import { afterAll, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

// control.ts captures native moveBefore support at module evaluation time. The
// shim models only its DOM placement contract, not focus/animation retention.
describe('each — multi-root LIS moves with moveBefore', () => {
  const previous = Object.getOwnPropertyDescriptor(Element.prototype, 'moveBefore');
  let nativeMoves = 0;
  let each: typeof import('../src/control.ts').each;
  let state: typeof import('../src/signals.ts').state;
  let watch: typeof import('../src/signals.ts').watch;
  let mount: typeof import('../src/component.ts').mount;
  let onDispose: typeof import('../src/component.ts').onDispose;

  beforeAll(async () => {
    Object.defineProperty(Element.prototype, 'moveBefore', {
      configurable: true,
      writable: true,
      value(this: Element, node: Node, reference: Node | null) {
        if (node.parentNode !== this || (reference && reference.parentNode !== this)) {
          throw new DOMException('Invalid moveBefore parent or reference', 'HierarchyRequestError');
        }
        nativeMoves++;
        this.insertBefore(node, reference);
      },
    });
    vi.resetModules();
    ({ each } = await import('../src/control.ts'));
    ({ state, watch } = await import('../src/signals.ts'));
    ({ mount, onDispose } = await import('../src/component.ts'));
  });

  afterAll(() => {
    if (previous) Object.defineProperty(Element.prototype, 'moveBefore', previous);
    else delete (Element.prototype as { moveBefore?: unknown }).moveBefore;
    vi.resetModules();
  });

  it('preserves the exact order and object identity of both roots on rotation and reversal', async () => {
    nativeMoves = 0;
    const keys = state(['A', 'B', 'C']);
    const nodes = new Map<string, Element>();
    const container = document.createElement('div');
    const { unmount } = mount(
      () =>
        each(
          () => keys(),
          (item) => {
            const key = item();
            const fragment = document.createDocumentFragment();
            for (const tag of ['b', 'i']) {
              const node = document.createElement(tag);
              node.dataset.key = key;
              node.textContent = key;
              nodes.set(`${tag.toUpperCase()}:${key}`, node);
              fragment.appendChild(node);
            }
            return fragment;
          },
          (item) => item,
        ),
      container,
    );
    const sequence = () =>
      [...container.querySelectorAll('b,i')].map(
        (node) => `${node.tagName}:${node.getAttribute('data-key')}`,
      );
    const verify = (order: string[]) => {
      const expected = order.flatMap((key) => [`B:${key}`, `I:${key}`]);
      expect(sequence()).toEqual(expected);
      for (const [index, key] of expected.entries()) {
        expect(container.querySelectorAll('b,i')[index]).toBe(nodes.get(key));
      }
    };

    await tick();
    verify(['A', 'B', 'C']);
    keys(['C', 'A', 'B']);
    await tick();
    verify(['C', 'A', 'B']);
    expect(nativeMoves).toBeGreaterThan(0);
    keys(['B', 'A', 'C']);
    await tick();
    verify(['B', 'A', 'C']);
    unmount();
  });

  it('keeps retained row watchers alive and disposes removed rows exactly once after mixed insertion', async () => {
    const keys = state(['A', 'B', 'C']);
    const dependency = state(0);
    const runs = new Map<string, number>();
    const disposed: string[] = [];
    const nodes = new Map<string, Element>();
    const container = document.createElement('div');
    const { unmount } = mount(
      () =>
        each(
          () => keys(),
          (item) => {
            const key = item();
            const fragment = document.createDocumentFragment();
            const b = document.createElement('b');
            const i = document.createElement('i');
            for (const node of [b, i]) {
              node.dataset.key = key;
              node.textContent = key;
              nodes.set(`${node.tagName}:${key}`, node);
              fragment.appendChild(node);
            }
            watch(() => {
              dependency();
              runs.set(key, (runs.get(key) ?? 0) + 1);
            });
            onDispose(() => disposed.push(key));
            return fragment;
          },
          (item) => item,
        ),
      container,
    );
    const verify = (order: string[]) => {
      const expected = order.flatMap((key) => [`B:${key}`, `I:${key}`]);
      const actual = [...container.querySelectorAll('b,i')];
      expect(actual.map((node) => `${node.tagName}:${node.getAttribute('data-key')}`)).toEqual(
        expected,
      );
      for (let index = 0; index < expected.length; index++) {
        expect(actual[index]).toBe(nodes.get(expected[index]));
      }
    };

    await tick();
    keys(['C', 'A', 'B']);
    await tick();
    verify(['C', 'A', 'B']);
    expect(disposed).toEqual([]);
    keys(['B', 'X', 'A', 'Y', 'C']);
    await tick();
    verify(['B', 'X', 'A', 'Y', 'C']);
    expect(disposed).toEqual([]);
    keys(['Y', 'C']);
    await tick();
    verify(['Y', 'C']);
    expect([...disposed].sort()).toEqual(['A', 'B', 'X']);
    const removedRuns = ['A', 'B', 'X'].map((key) => runs.get(key));
    const retainedRuns = ['Y', 'C'].map((key) => runs.get(key));
    dependency(1);
    await tick();
    expect(['A', 'B', 'X'].map((key) => runs.get(key))).toEqual(removedRuns);
    expect(['Y', 'C'].map((key) => runs.get(key))).toEqual(
      retainedRuns.map((count) => count! + 1),
    );
    unmount();
    expect([...disposed].sort()).toEqual(['A', 'B', 'C', 'X', 'Y']);
    dependency(2);
    await tick();
    expect(['Y', 'C'].map((key) => runs.get(key))).toEqual(
      retainedRuns.map((count) => count! + 1),
    );
  });
});
