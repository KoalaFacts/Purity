// @vitest-environment jsdom
import { describe, expect, it } from 'vite-plus/test';
import { generate, generateHydrate, parse } from '../src/index.ts';

type Mode = 'dom' | 'hydrate';
type Factory = (
  values: unknown[],
  watch: (effect: () => void) => void,
  root?: HTMLElement,
) => HTMLElement;

const immediate = (effect: () => void) => effect();

function compile(strings: string[], mode: Mode): Factory {
  const ast = parse(strings);
  const generated = mode === 'dom' ? generate(ast) : generateHydrate(ast);
  return new Function(`return (${generated});`)() as Factory;
}

function render(
  strings: string[],
  values: unknown[],
  mode: Mode,
  watch: (effect: () => void) => void = immediate,
): HTMLElement {
  const factory = compile(strings, mode);
  if (mode === 'dom') return factory(values, watch);
  const root = document.createElement('div');
  root.innerHTML = '<x-data data-items="from-server"></x-data>';
  factory(values, watch, root);
  return root.firstElementChild as HTMLElement;
}

describe.each<Mode>(['dom', 'hydrate'])('per-binding first-write memo (%s)', (mode) => {
  for (const kind of ['.items', ':items', 'data-items']) {
    it(`writes ${kind} when the accessor returns the public values array`, () => {
      const values: unknown[] = [];
      values.push(() => values);
      const node = render([`<x-data ${kind}=`, '></x-data>'], values, mode);

      if (kind === 'data-items') {
        expect(node.getAttribute('data-items')).toBe(String(values));
      } else {
        expect((node as HTMLElement & { items?: unknown }).items).toBe(values);
      }
    });
  }

  it('does not reapply a property when an unrelated sibling changes', () => {
    const values: unknown[] = [];
    let items: unknown = values;
    let title = 'first';
    let rerun: () => void = () => {
      throw new Error('watcher was not registered');
    };
    values.push(
      () => items,
      () => title,
    );

    const node = render(
      ['<x-data .items=', ' title=', '></x-data>'],
      values,
      mode,
      (effect) => {
        rerun = effect;
        effect();
      },
    );

    expect((node as HTMLElement & { items?: unknown }).items).toBe(values);
    let writes = 0;
    let current: unknown = values;
    Object.defineProperty(node, 'items', {
      configurable: true,
      get: () => current,
      set: (next) => {
        current = next;
        writes++;
      },
    });

    title = 'second';
    rerun();
    expect(node.getAttribute('title')).toBe('second');
    expect(writes).toBe(0);

    const replacement: unknown[] = [];
    items = replacement;
    rerun();
    expect(current).toBe(replacement);
    expect(writes).toBe(1);

    rerun();
    expect(writes).toBe(1);
  });

  it('keeps the existing repeated-NaN comparison behavior', () => {
    const values: unknown[] = [() => NaN];
    let rerun: () => void = () => {
      throw new Error('watcher was not registered');
    };
    const node = render(['<x-data .items=', '></x-data>'], values, mode, (effect) => {
      rerun = effect;
      effect();
    });
    expect(Number.isNaN((node as HTMLElement & { items?: unknown }).items)).toBe(true);

    let writes = 0;
    Object.defineProperty(node, 'items', {
      configurable: true,
      set: () => {
        writes++;
      },
    });
    rerun();
    expect(writes).toBe(1);
  });
});
