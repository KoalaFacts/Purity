import { afterEach, describe, expect, it } from 'vite-plus/test';
import type { ElementNode, FragmentNode } from '../src/compiler/ast.ts';
import {
  generate,
  generateHydrate,
  generateHydrateLinked,
  generateLinked,
  generateSSR,
} from '../src/compiler/codegen.ts';
import { parse } from '../src/compiler/parser.ts';
import { flattenValue, swapSlot } from '../src/compiler/value-helpers.ts';
import { ssrHelpers } from '../src/compiler/ssr-runtime.ts';
import { state, watch } from '../src/signals.ts';

const stops: (() => void)[] = [];
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const track = (fn: () => void) => {
  const stop = watch(fn);
  stops.push(stop);
  return stop;
};

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function fixture(kind: 'url' | 'group', count = 8): FragmentNode {
  return {
    type: 'fragment',
    children: Array.from({ length: count }, (_, index): ElementNode => ({
      type: 'element',
      tag: kind === 'url' ? 'a' : 'input',
      isVoid: kind === 'group',
      children: [],
      attributes:
        kind === 'url'
          ? [{ kind: 'dynamic', name: 'href', index }]
          : [
              { kind: 'static', name: 'type', value: index % 2 ? 'checkbox' : 'radio' },
              { kind: 'static', name: 'value', value: `v${index}` },
              { kind: 'bind', name: 'group', index },
            ],
    })),
  };
}

function render(
  ast: FragmentNode,
  values: unknown[],
  hydrate: boolean,
  markup = '',
  linked = false,
) {
  const root = document.createElement('div');
  // Only trusted generated source is evaluated. Production AOT evaluates no code strings.
  if (hydrate) {
    root.innerHTML = markup;
    const prior = Array.from(root.childNodes);
    const source = linked ? generateHydrateLinked(ast) : generateHydrate(ast);
    const factory = new Function('__purity_fl__', '__purity_sw__', `return ${source}`)(
      flattenValue,
      swapSlot,
    );
    factory(values, track, root);
    expect(Array.from(root.childNodes)).toEqual(prior);
  } else {
    const source = linked ? generateLinked(ast) : generate(ast);
    const factory = new Function('__purity_fl__', '__purity_sw__', `return ${source}`)(
      flattenValue,
      swapSlot,
    );
    root.appendChild(factory(values, track));
  }
  return root;
}

describe('generated binding correctness across rendering paths', () => {
  for (const [mode, hydrate, linked] of [
    ['create', false, false],
    ['hydrate', true, false],
    ['linked create', false, true],
    ['linked hydrate', true, true],
  ] as const) {
    const run = (ast: FragmentNode, values: unknown[], hydration: boolean, markup = '') =>
      render(ast, values, hydration, markup, linked);

    it(`${mode} checks all eight URL sinks independently`, () => {
      const values = Array.from({ length: 8 }, (_, index) => `/safe-${index}`);
      const markup = '<a></a>'.repeat(8);
      const root = run(fixture('url'), values, hydrate, markup);
      expect(Array.from(root.children, (el) => el.getAttribute('href'))).toEqual(values);
      for (let index = 0; index < values.length; index++) {
        const unsafe = [...values];
        unsafe[index] = ' \tjava\nscript:alert(1)';
        expect(() => run(fixture('url'), unsafe, hydrate, markup)).toThrow(
          '[Purity] Unsafe URL binding',
        );
      }
    });

    it(`${mode} updates multiple grouped inputs without mutating prior values`, async () => {
      const selected = state(['v1', 'v5']);
      const previous = selected();
      const markup = Array.from(
        { length: 8 },
        (_, index) => `<input type="${index % 2 ? 'checkbox' : 'radio'}" value="v${index}">`,
      ).join('');
      const root = run(fixture('group'), Array(8).fill(selected), hydrate, markup);
      const boxes = Array.from(root.querySelectorAll<HTMLInputElement>('input')).filter(
        (input) => input.type === 'checkbox',
      );
      expect(boxes.map((input) => input.checked)).toEqual([true, false, true, false]);
      boxes[1]!.checked = true;
      boxes[1]!.dispatchEvent(new Event('change'));
      expect(selected()).toEqual(['v1', 'v5', 'v3']);
      expect(previous).toEqual(['v1', 'v5']);
      selected(['v7']);
      await tick();
      expect(boxes.map((input) => input.checked)).toEqual([false, false, false, true]);
    });

    it(`${mode} retains single coercion, reactive removal and watcher disposal`, async () => {
      let reads = 0;
      const value = state<unknown>({
        toString() {
          reads++;
          return '/safe';
        },
      });
      const root = run(fixture('url'), Array(8).fill(value), hydrate, '<a></a>'.repeat(8));
      expect(reads).toBe(8);
      expect(Array.from(root.children, (el) => el.getAttribute('href'))).toEqual(
        Array(8).fill('/safe'),
      );
      value(false);
      await tick();
      expect(Array.from(root.children, (el) => el.hasAttribute('href'))).toEqual(
        Array(8).fill(false),
      );
      value(true);
      await tick();
      expect(root.firstElementChild?.getAttribute('href')).toBe('');
      for (const stop of stops.splice(0)) stop();
      value('/after-disposal');
      await tick();
      expect(root.firstElementChild?.getAttribute('href')).toBe('');
    });

    it(`${mode} rejects executable URLs while allowing raster images`, () => {
      for (const value of [
        'javascript:alert(1)',
        ' \tjava\nscript:alert(1)',
        'vbscript:msgbox(1)',
        'data:text/html,x',
        'data:image/svg+xml;base64,x',
      ]) {
        expect(() => run(fixture('url', 1), [value], hydrate, '<a></a>')).toThrow(
          '[Purity] Unsafe URL binding',
        );
      }
      for (const value of ['/relative', 'https://example.test', 'data:image/png;base64,x']) {
        const root = run(fixture('url', 1), [value], hydrate, '<a></a>');
        expect(root.firstElementChild?.getAttribute('href')).toBe(value);
      }
      let reads = 0;
      const stateful = {
        toString() {
          return ++reads === 1 ? '/safe-once' : 'javascript:second-coercion';
        },
      };
      const root = run(fixture('url', 1), [stateful], hydrate, '<a></a>');
      expect(reads).toBe(1);
      expect(root.firstElementChild?.getAttribute('href')).toBe('/safe-once');
    });

    it(`${mode} preserves radio/checkbox semantics and retained snapshots`, async () => {
      const radio = state('v0');
      const initial = ['v1'];
      const group = state(initial);
      const root = run(
        fixture('group', 2),
        [radio, group],
        hydrate,
        '<input type="radio" value="v0"><input type="checkbox" value="v1">',
      );
      const [first, second] = root.querySelectorAll('input');
      expect(first.checked).toBe(true);
      expect(second.checked).toBe(true);
      second.checked = false;
      second.dispatchEvent(new Event('change'));
      expect(group()).toEqual([]);
      expect(initial).toEqual(['v1']);
      second.checked = true;
      second.dispatchEvent(new Event('change'));
      second.dispatchEvent(new Event('change'));
      expect(group()).toEqual(['v1']);
      radio('elsewhere');
      await tick();
      expect(first.checked).toBe(false);
      first.dispatchEvent(new Event('change'));
      expect(radio()).toBe('elsewhere');
      first.checked = true;
      first.dispatchEvent(new Event('change'));
      expect(radio()).toBe('v0');
    });

    it(`${mode} keeps the values-array receiver and live accessor replacement`, () => {
      const receivers: unknown[] = [];
      let selected: unknown = 'v0';
      const values: unknown[] = [
        function (this: unknown, ...args: unknown[]) {
          receivers.push(this);
          if (args.length) selected = args[0];
          return selected;
        },
      ];
      const root = run(fixture('group', 1), values, hydrate, '<input type="radio" value="v0">');
      const input = root.firstElementChild as HTMLInputElement;
      let replacement: unknown;
      values[0] = function (this: unknown, next: unknown) {
        receivers.push(this);
        replacement = next;
      };
      input.checked = true;
      input.dispatchEvent(new Event('change'));
      expect(replacement).toBe('v0');
      expect(receivers.every((receiver) => receiver === values)).toBe(true);
    });

    it(`${mode} keeps native URL checks but does not coerce custom-element props`, () => {
      const native = parse(['<a :href=', '></a>']);
      expect(() => run(native, ['javascript:bad'], hydrate, '<a></a>')).toThrow('Unsafe URL');
      const value = { toString: () => 'javascript:typed-data' };
      const custom = parse(['<test-link :href=', '></test-link>']);
      const root = run(custom, [value], hydrate, '<test-link></test-link>');
      expect((root.firstElementChild as HTMLElement & { href: unknown }).href).toBe(value);
    });
  }

  it('SSR validates every URL with one coercion and preserves escaping', () => {
    const factory = new Function(`return ${generateSSR(fixture('url'))}`)();
    let reads = 0;
    const value = {
      toString() {
        reads++;
        return '/safe?x=1&y=2';
      },
    };
    const result = factory(Array(8).fill(value), ssrHelpers);
    expect(reads).toBe(8);
    expect(result.__purity_ssr_html__).toBe('<a href="/safe?x=1&amp;y=2"></a>'.repeat(8));
    for (let index = 0; index < 8; index++) {
      const unsafe = Array(8).fill('/safe');
      unsafe[index] = () => 'javascript:bad';
      expect(() => factory(unsafe, ssrHelpers)).toThrow('Unsafe URL');
    }
  });
});
