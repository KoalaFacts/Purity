import { state } from '@purityjs/core';
import { isSSRHtml, markSSRHtml } from '@purityjs/core/compiler';
import { describe, expect, it } from 'vitest';
import { html, renderToString } from '../src/index.ts';

describe('html`` SSR tag', () => {
  it('returns a branded SSR HTML wrapper', () => {
    const out = html`<div></div>`;
    expect(isSSRHtml(out)).toBe(true);
    expect(out.__purity_ssr_html__).toBe('<div></div>');
  });

  it('renders static content', () => {
    expect(html`<p>hello</p>`.__purity_ssr_html__).toBe('<p>hello</p>');
  });

  it('renders reactive expressions with hydration markers', () => {
    expect(html`<p>${'x'}</p>`.__purity_ssr_html__).toBe('<p><!--[-->x<!--]--></p>');
  });

  it('escapes interpolated text', () => {
    expect(html`<p>${'<script>'}</p>`.__purity_ssr_html__).toBe(
      '<p><!--[-->&lt;script&gt;<!--]--></p>',
    );
  });

  it('unwraps signal accessors', () => {
    const count = state(7);
    expect(html`<p>${() => count()}</p>`.__purity_ssr_html__).toBe('<p><!--[-->7<!--]--></p>');
  });

  it('concatenates nested html`` results raw', () => {
    const inner = html`<span>x</span>`;
    expect(html`<div>${inner}</div>`.__purity_ssr_html__).toBe(
      '<div><!--[--><span>x</span><!--]--></div>',
    );
  });

  it('renders dynamic attributes', () => {
    expect(html`<a href=${'/x'} class=${null}>go</a>`.__purity_ssr_html__).toBe(
      '<a href="/x">go</a>',
    );
  });

  it('caches the compiled factory across calls with the same template', () => {
    const factory = (n: number) => html`<p>${n}</p>`.__purity_ssr_html__;
    expect(factory(1)).toBe('<p><!--[-->1<!--]--></p>');
    expect(factory(2)).toBe('<p><!--[-->2<!--]--></p>');
    expect(factory(3)).toBe('<p><!--[-->3<!--]--></p>');
  });
});

describe('renderToString', () => {
  it('renders a static component', async () => {
    const out = await renderToString(() => html`<h1>Hi</h1>`);
    expect(out).toBe('<h1>Hi</h1>');
  });

  it('renders a component with reactive bindings', async () => {
    const count = state(3);
    const App = () => html`<p>Count: ${() => count()}</p>`;
    const out = await renderToString(App);
    expect(out).toBe('<p>Count: <!--[-->3<!--]--></p>');
  });

  it('prepends the doctype option', async () => {
    const out = await renderToString(
      () =>
        html`<html>
          <body></body>
        </html>`,
      {
        doctype: '<!doctype html>',
      },
    );
    expect(out).toBe('<!doctype html><html><body></body></html>');
  });

  it('accepts a component returning a plain string and escapes it', async () => {
    const out = await renderToString(() => '<x>');
    expect(out).toBe('&lt;x&gt;');
  });

  it('accepts a component returning a branded SSR HTML wrapper', async () => {
    const out = await renderToString(() => markSSRHtml('<raw></raw>'));
    expect(out).toBe('<raw></raw>');
  });

  it('accepts a component returning an array', async () => {
    const out = await renderToString(() => [
      html`<header></header>`,
      html`<main></main>`,
      html`<footer></footer>`,
    ]);
    expect(out).toBe('<header></header><main></main><footer></footer>');
  });

  it('handles null / undefined / false returns gracefully', async () => {
    expect(await renderToString(() => null)).toBe('');
    expect(await renderToString(() => undefined)).toBe('');
    expect(await renderToString(() => false)).toBe('');
  });

  it('captures signal values at render time (no live subscription)', async () => {
    const name = state('Alice');
    const App = () => html`<p>Hi ${() => name()}</p>`;
    const first = await renderToString(App);
    name('Bob');
    const second = await renderToString(App);
    expect(first).toBe('<p>Hi <!--[-->Alice<!--]--></p>');
    expect(second).toBe('<p>Hi <!--[-->Bob<!--]--></p>');
  });

  it('returns a Promise', () => {
    const r = renderToString(() => html`<p>x</p>`);
    expect(r).toBeInstanceOf(Promise);
  });
});

describe('renderToString — full document shell', () => {
  it('builds a full HTML document', async () => {
    const title = state('Welcome');
    const App = () => html`
      <html lang="en">
        <head>
          <title>${() => title()}</title>
        </head>
        <body>
          <h1>${() => title()}</h1>
        </body>
      </html>
    `;
    const out = await renderToString(App, { doctype: '<!doctype html>' });
    expect(out).toContain('<!doctype html>');
    expect(out).toContain('<title><!--[-->Welcome<!--]--></title>');
    expect(out).toContain('<h1><!--[-->Welcome<!--]--></h1>');
  });
});
