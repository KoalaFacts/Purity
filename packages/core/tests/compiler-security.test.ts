import { describe, expect, it } from 'vite-plus/test';
import { generate, generateHydrate, generateSSR } from '../src/compiler/codegen.ts';
import { parse } from '../src/compiler/parser.ts';
import { ssrHelpers } from '../src/compiler/ssr-runtime.ts';

const immediate = (fn: () => void) => fn();
const factory = (code: string) => new Function(`return ${code}`)();

describe('executable template bindings', () => {
  it.each(['onclick', '?onclick', '.srcdoc'])(
    'rejects custom-element %s before SSR dispatch',
    (name) => {
      const ast = parse([`<x-widget ${name}=`, '></x-widget>']);
      expect(() => generateSSR(ast)).toThrow(/Unsafe dynamic binding/);
    },
  );

  it('rejects unsafe custom-element attributes during SSR fallback', () => {
    const ast = parse(['<x-widget href=', '></x-widget>']);
    expect(() => factory(generateSSR(ast))([() => 'javascript:attack()'], ssrHelpers)).toThrow(
      /Unsafe URL binding/,
    );
    expect(factory(generateSSR(ast))(['/safe'], ssrHelpers).__purity_ssr_html__).toContain(
      'href="/safe"',
    );
  });

  it.each(['data', 'href', 'src'])(
    'preserves custom-element %s property objects in DOM, hydration and SSR',
    (name) => {
      for (const binding of [`.${name}`, `:${name}`, `::${name}`]) {
        const ast = parse([`<my-chart ${binding}=`, '></my-chart>']);
        const data = { rows: [1, 2] };
        const value = binding.startsWith('.') ? data : () => data;
        const node = factory(generate(ast))([value], immediate);
        expect(node[name]).toBe(data);
        const root = document.createElement('div');
        root.innerHTML = '<my-chart></my-chart>';
        factory(generateHydrate(ast))([value], immediate, root);
        expect((root.firstChild as any)[name]).toBe(data);
        let received: unknown;
        factory(generateSSR(ast))([value], {
          ...ssrHelpers,
          element: (_tag: string, attrs: Record<string, unknown>) => {
            received = attrs[name];
            return '';
          },
        });
        expect(typeof received === 'function' ? received() : received).toBe(data);
      }
    },
  );

  it('rejects attribute names that could escape generated code or script tags', () => {
    for (const name of ['x</script><script>attack()</script>', 'x";attack();"', 'x.y']) {
      const ast = parse(['<input ::value=', '>']);
      const element = ast.children[0];
      if (element.type !== 'element') throw new Error('Expected input AST');
      element.attributes[0].name = name;
      for (const compile of [generate, generateHydrate, generateSSR]) {
        expect(() => compile(ast)).toThrow(/Invalid attribute name/);
      }
    }
  });
  it.each([
    'onclick',
    'onerror',
    'ONCLICK',
    ':onclick',
    '.onclick',
    '::onclick',
    '?onclick',
    'srcdoc',
    '.srcdoc',
  ])('rejects dynamic %s in DOM, hydration, and SSR compilation', (name) => {
    const ast = parse([`<button ${name}=`, '>go</button>']);
    for (const compile of [generate, generateHydrate, generateSSR]) {
      expect(() => compile(ast)).toThrow(/Unsafe dynamic binding/);
    }
  });

  it.each([
    'javascript:attack()',
    'JaVaScRiPt:attack()',
    ' \tjava\nscript:attack()',
    '\u0000javascript:attack()',
    'vbscript:attack()',
    'data:text/html,<script>attack()</script>',
    'data:image/svg+xml,<svg onload="attack()"/>',
  ])('rejects unsafe URL %s in all renderers', (url) => {
    for (const binding of ['href', ':href', '.href', '::href']) {
      const ast = parse([`<a ${binding}=`, '>go</a>']);
      const value = () => url;
      expect(() => factory(generate(ast))([value], immediate)).toThrow(/Unsafe URL binding/);
      expect(() => factory(generateSSR(ast))([value], ssrHelpers)).toThrow(/Unsafe URL binding/);
      const root = document.createElement('div');
      root.innerHTML = '<a href="/safe">go</a>';
      expect(() => factory(generateHydrate(ast))([value], immediate, root)).toThrow(
        /Unsafe URL binding/,
      );
      expect(root.querySelector('a')!.getAttribute('href')).toBe('/safe');
    }
  });

  it.each([
    '/relative?q=x',
    '#section',
    'https://example.test/path',
    'mailto:reader@example.test',
    'tel:+1234',
    'data:image/png;base64,aGVsbG8=',
  ])('preserves allowed URL %s', (url) => {
    const ast = parse(['<a href=', '>go</a>']);
    const node = factory(generate(ast))([url], immediate) as DocumentFragment;
    expect((node as unknown as HTMLAnchorElement).getAttribute('href')).toBe(url);
    expect(factory(generateSSR(ast))([url], ssrHelpers).__purity_ssr_html__).toContain(url);
  });

  it('checks complex templates and reactive updates before changing the DOM', () => {
    const ast = parse(['<section><a href=', '>go</a></section>']);
    let value = '/safe';
    let update!: () => void;
    const root = factory(generate(ast))([() => value], (fn: () => void) => {
      update = fn;
      fn();
    }) as DocumentFragment;
    value = 'javascript:attack()';
    expect(() => update()).toThrow(/Unsafe URL binding/);
    expect(root.querySelector('a')!.getAttribute('href')).toBe('/safe');
  });

  it('coerces a URL object only once', () => {
    let calls = 0;
    const value = { toString: () => (++calls === 1 ? '/safe' : 'javascript:attack()') };
    const ast = parse(['<a href=', '>go</a>']);
    const root = factory(generate(ast))([value], immediate) as DocumentFragment;
    expect((root as unknown as HTMLAnchorElement).getAttribute('href')).toBe('/safe');
    expect(calls).toBe(1);
  });

  it('keeps @event listeners and ordinary attribute text working', () => {
    const ast = parse(['<button @click=', ' title=', '>go</button>']);
    let clicks = 0;
    const root = factory(generate(ast))(
      [() => clicks++, 'javascript:plain text'],
      immediate,
    ) as DocumentFragment;
    const button = root as unknown as HTMLButtonElement;
    button.click();
    expect(clicks).toBe(1);
    expect(button.title).toBe('javascript:plain text');
  });
});
