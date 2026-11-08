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

for (const mode of ['dom', 'hydrate'] as const) {
  describe(`per-binding first-write memo (${mode})`, () => {
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

      const node = render(['<x-data .items=', ' title=', '></x-data>'], values, mode, (effect) => {
        rerun = effect;
        effect();
      });

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

    it.each(['.items', ':items'])('retries a failed %s property setter', (kind) => {
      let value = 'first';
      let rerun: () => void = () => {};
      const node = render(
        ['<x-data ' + kind + '=', '></x-data>'],
        [() => value],
        mode,
        (effect) => {
          rerun = effect;
          effect();
        },
      );
      expect((node as HTMLElement & { items?: unknown }).items).toBe('first');

      let attempts = 0;
      let completed = 'first';
      Object.defineProperty(node, 'items', {
        configurable: true,
        get: () => completed,
        set: (next: string) => {
          attempts++;
          if (attempts === 1) throw new Error('transient setter failure');
          completed = next;
        },
      });

      value = 'second';
      expect(() => rerun()).toThrow('transient setter failure');
      expect(completed).toBe('first');
      expect(() => rerun()).not.toThrow();
      expect(completed).toBe('second');
      expect(attempts).toBe(2);
      rerun();
      expect(attempts).toBe(2);
    });

    it('retries a failed dynamic attribute write', () => {
      let value = 'first';
      let rerun: () => void = () => {};
      const node = render(['<x-data data-items=', '></x-data>'], [() => value], mode, (effect) => {
        rerun = effect;
        effect();
      });
      expect(node.getAttribute('data-items')).toBe('first');

      const originalSet = node.setAttribute.bind(node);
      let attempts = 0;
      node.setAttribute = (name, next) => {
        if (name === 'data-items' && ++attempts === 1) {
          throw new Error('transient attribute failure');
        }
        originalSet(name, next);
      };

      value = 'second';
      expect(() => rerun()).toThrow('transient attribute failure');
      expect(node.getAttribute('data-items')).toBe('first');
      expect(() => rerun()).not.toThrow();
      expect(node.getAttribute('data-items')).toBe('second');
      expect(attempts).toBe(2);
      rerun();
      expect(attempts).toBe(2);
    });

    it.each(['.href', ':href', 'href'])('rejects repeated unsafe %s URLs', (kind) => {
      let value: unknown = '/safe';
      let rerun: () => void = () => {};
      const factory = compile(['<a ' + kind + '=', '></a>'], mode);
      const root = document.createElement('div');
      root.innerHTML = '<a href="/server"></a>';
      const values = [() => value];
      const watch = (effect: () => void) => {
        rerun = effect;
        effect();
      };
      const node =
        mode === 'dom'
          ? factory(values, watch)
          : (factory(values, watch, root), root.firstElementChild as HTMLElement);
      expect(node.getAttribute('href')).toBe('/safe');

      value = 'javascript:alert(1)';
      expect(() => rerun()).toThrow('[Purity] Unsafe URL binding');
      expect(() => rerun()).toThrow('[Purity] Unsafe URL binding');
      expect(node.getAttribute('href')).toBe('/safe');
    });

    it.each(['.href', ':href'])('memoizes the original %s URL input', (kind) => {
      let value: unknown = '/safe';
      let rerun: () => void = () => {};
      const factory = compile(['<a ' + kind + '=', '></a>'], mode);
      const root = document.createElement('div');
      root.innerHTML = '<a href="/server"></a>';
      const values = [() => value];
      const watch = (effect: () => void) => {
        rerun = effect;
        effect();
      };
      const node =
        mode === 'dom'
          ? factory(values, watch)
          : (factory(values, watch, root), root.firstElementChild as HTMLElement);
      expect(node.getAttribute('href')).toBe('/safe');

      let conversions = 0;
      value = {
        toString: () => {
          conversions++;
          return '/next';
        },
      };
      rerun();
      expect(node.getAttribute('href')).toBe('/next');
      expect(conversions).toBe(1);
      rerun();
      expect(conversions).toBe(1);
    });
  });
}
