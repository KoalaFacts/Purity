// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { mount, state, watch } from '@purityjs/core';
import { flattenValue, swapSlot } from '@purityjs/core/runtime';
import { purity, type PurityPluginOptions } from '../src/index.ts';

const disposers: Array<() => void> = [];
afterEach(() => {
  while (disposers.length) disposers.pop()!();
  document.body.replaceChildren();
});

const source = "import { html } from '@purityjs/core/jit'; export const make = (value) => html`<section><p>${value}</p></section>`;";

function compile(code = source, options?: PurityPluginOptions) {
  const result = purity(options).transform(code, 'consumer.ts');
  if (!result) throw new Error('Expected compiled output');
  return result.code;
}

function execute(code: string): (...values: any[]) => Node {
  const compiled = compile(code);
  const body = compiled.replace(/^\s*import .+$/gm, '').replace(/\bexport /g, '');
  return new Function('__purity_watch__', '__purity_fl__', '__purity_sw__', `${body}\nreturn make;`)(watch, flattenValue, swapSlot);
}

function render(view: () => Node) {
  const host = document.createElement('main');
  document.body.append(host);
  disposers.push(mount(view, host).unmount);
  return host;
}

describe('client-first AOT build contract', () => {
  it('default client output omits hydration walkers and mode selection', () => {
    const code = compile();
    expect(code).not.toContain('_hydrate');
    expect(code).not.toContain('renderCompiledTemplate');
    expect(code).toContain('watch as __purity_watch__');
    expect(code).toContain('__purity_tpl_0([value], __purity_watch__)');
  });

  it('generates hydration only when explicitly requested', () => {
    const code = compile(source, { hydratable: true } as PurityPluginOptions);
    expect(code).toContain('_hydrate');
    expect(code).toContain('renderCompiledTemplate');
    expect(code).not.toContain('watch as __purity_watch__');
  });

  it('defaults to strict AOT instead of silently retaining a malformed template', () => {
    expect(() => compile("import { html } from '@purityjs/core/jit'; export const make = () => html`<p>broken;")).toThrow(/strictAot/);
  });

  it('allows an intentional runtime fallback only with strictAot false', () => {
    const plugin = purity({ strictAot: false });
    expect(() => plugin.transform("import { html } from '@purityjs/core/jit'; const view = html`<p>broken;", 'broken.ts')).not.toThrow();
  });

  it('removes walkers from all nested client templates', () => {
    const code = compile("import { html } from '@purityjs/core/jit'; export const make = (value) => html`<section>${[html`<p>${value}</p>`, html`<span>tail</span>`]}</section>`;");
    expect(code).not.toContain('_hydrate');
    expect(code).not.toContain('renderCompiledTemplate');
    expect((code.match(/const __purity_tpl_/g) ?? []).length).toBe(3);
  });

  it('keeps injected watch names collision-safe', () => {
    const code = compile("import { html } from '@purityjs/core/jit'; const __purity_watch__ = 'user'; export const make = () => html`<p>${__purity_watch__}</p>`;");
    expect(code).toContain('watch as __purity0_watch__');
    expect(code).toContain('[__purity_watch__], __purity0_watch__)');
  });

  it('runs nested reactive DOM and events without runtime code generation', async () => {
    const make = execute("import { html } from '@purityjs/core/jit'; export const make = (value, click) => html`<section>${[html`<button @click=${click}>${value}</button>`, html`<span>tail</span>`]}</section>`;");
    const count = state(1);
    const originalFunction = globalThis.Function;
    let host: HTMLElement;
    try {
      globalThis.Function = (() => { throw new Error('Unexpected runtime code generation'); }) as FunctionConstructor;
      host = render(() => make(count, () => count((n) => n + 1)));
      expect(host.querySelector('button')!.textContent).toBe('1');
      host.querySelector('button')!.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(host.querySelector('button')!.textContent).toBe('2');
      expect(host.querySelector('span')!.textContent).toBe('tail');
    } finally {
      globalThis.Function = originalFunction;
    }
  });

  it('keeps two-way form binding and owner disposal', async () => {
    const make = execute("import { html } from '@purityjs/core/jit'; export const make = (value, text) => html`<section><input ::value=${value} /><p>${text}</p></section>`;");
    const value = state('Ada');
    let reads = 0;
    const host = render(() => make(value, () => { reads++; return value(); }));
    const input = host.querySelector('input')!;
    expect(input.value).toBe('Ada');
    input.value = 'Grace';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(value()).toBe('Grace');
    expect(host.querySelector('p')!.textContent).toBe('Grace');
    value('Lin');
    await Promise.resolve();
    await Promise.resolve();
    expect(input.value).toBe('Lin');
    disposers.pop()!();
    const before = reads;
    value('After disposal');
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).toBe(before);
    expect(host.childNodes.length).toBe(0);
  });

  it.each(['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,<script></script>'])('retains URL safety for %s', (url) => {
    const make = execute("import { html } from '@purityjs/core/jit'; export const make = (url) => html`<a href=${url}>go</a>`;");
    expect(() => make(url)).toThrow('Unsafe URL binding');
  });

  it('coerces URL values once and creates independent instances', () => {
    const make = execute("import { html } from '@purityjs/core/jit'; export const make = (url) => html`<a href=${url}>go</a>`;");
    let calls = 0;
    const url = { toString() { calls++; return calls === 1 ? '/safe' : 'javascript:alert(1)'; } };
    const first = make(url) as HTMLElement;
    const second = make('/other') as HTMLElement;
    expect(first.getAttribute('href')).toBe('/safe');
    expect(second.getAttribute('href')).toBe('/other');
    expect(first).not.toBe(second);
    expect(calls).toBe(1);
  });

  it.each([false, true])('preserves explicit server output with hydratable=%s', (hydratable) => {
    const plugin = purity({ hydratable } as PurityPluginOptions);
    const result = plugin.transform(source, 'consumer.ts', { ssr: true });
    expect(result?.code).toContain('ssrHelpers');
    expect(result?.code).not.toContain('document.createElement');
    expect(result?.code).not.toContain('watch as __purity_watch__');
  });
});
