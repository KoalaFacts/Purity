import { state } from '@purityjs/core';
import { isSSRHtml, markSSRHtml } from '@purityjs/core/compiler';
import { resource } from '@purityjs/core';
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
    expect(html`<a href=${'/x'} class=${undefined}>go</a>`.__purity_ssr_html__).toBe(
      '<a href="/x">go</a>',
    );
  });

  it('caches the compiled factory across calls with the same template', () => {
    const factory = (n: number) => html`<p>${n}</p>`.__purity_ssr_html__;
    expect(factory(1)).toBe('<p><!--[-->1<!--]--></p>');
    expect(factory(2)).toBe('<p><!--[-->2<!--]--></p>');
    expect(factory(3)).toBe('<p><!--[-->3<!--]--></p>');
  });

  it('keeps escaping even when the shared ssrHelpers bundle is mutated', async () => {
    // Audit-v2 regression: the runtime `html` tag used to forward the
    // live `ssrHelpers` object by reference into every compiled factory.
    // A consumer that swapped `ssrHelpers.esc` for the identity function
    // (intentionally or via a buggy plugin) could strip all XSS escaping
    // out of subsequent SSR renders. The entry point now snapshots and
    // freezes the helpers at module load, so post-load mutation cannot
    // alter what the compiled factory sees.
    const mod = await import('@purityjs/core/compiler');
    const realEsc = mod.ssrHelpers.esc;
    try {
      // Mutate the live export to a pass-through. If the html tag forwarded
      // by reference, the next render would emit raw `<script>` bytes.
      (mod.ssrHelpers as { esc: (s: string) => string }).esc = (s: string) => s;
      const out = html`<p>${'<script>alert(1)</script>'}</p>`.__purity_ssr_html__;
      expect(out).toBe('<p><!--[-->&lt;script&gt;alert(1)&lt;/script&gt;<!--]--></p>');
      expect(out).not.toContain('<script>');
    } finally {
      (mod.ssrHelpers as { esc: (s: string) => string }).esc = realEsc;
    }
  });

  it('keeps attribute escaping even when ssrHelpers.attr is mutated', async () => {
    const mod = await import('@purityjs/core/compiler');
    const realAttr = mod.ssrHelpers.attr;
    try {
      (mod.ssrHelpers as { attr: (s: string) => string }).attr = (s: string) => s;
      const out = html`<a href=${'"><script>alert(1)</script><a x="'}>x</a>`.__purity_ssr_html__;
      // Must NOT contain a literal `<script>` — the attribute escaper has
      // to neutralise the double quote that would close the attribute.
      expect(out).not.toContain('<script>');
      expect(out).not.toContain('"><script');
    } finally {
      (mod.ssrHelpers as { attr: (s: string) => string }).attr = realAttr;
    }
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

  it('rejects a doctype that smuggles markup', async () => {
    // doctype is concatenated verbatim — a hostile string like
    // `<!doctype html><script>alert(1)</script>` would emit unescaped
    // markup before the document. Reject anything that isn't a valid
    // `<!DOCTYPE …>` declaration before the render starts.
    const cases = [
      '<!doctype html><script>alert(1)</script>',
      '<script>alert(1)</script>',
      '<!doctype html><!doctype html>', // double
      'arbitrary text',
      '<', // unterminated
      '<!doctype>', // missing space + body
    ];
    for (const bad of cases) {
      await expect(renderToString(() => html`<html></html>`, { doctype: bad })).rejects.toThrow(
        /invalid doctype/i,
      );
    }
    // The legitimate uppercase form is accepted.
    const ok = await renderToString(() => html`<html></html>`, {
      doctype: '<!DOCTYPE html>',
    });
    expect(ok.startsWith('<!DOCTYPE html>')).toBe(true);
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

describe('renderToString — CSP nonce on resource-priming script', () => {
  it('emits the nonce attribute on the resources script when supplied', async () => {
    const App = () => {
      const r = resource(() => Promise.resolve('hi'));
      return html`<p>${() => r()}</p>`;
    };
    const out = await renderToString(App, { nonce: 'abc123' });
    expect(out).toContain('id="__purity_resources__"');
    expect(out).toContain('nonce="abc123"');
  });

  it('omits the nonce attribute by default (byte-for-byte output unchanged)', async () => {
    const out = await renderToString(() => html`<p>hi</p>`);
    expect(out).not.toContain('nonce=');
  });

  it('rejects nonces with characters outside the safe alphabet', async () => {
    await expect(renderToString(() => html`<p>x</p>`, { nonce: 'bad"value' })).rejects.toThrow(
      /invalid CSP nonce/,
    );
    await expect(renderToString(() => html`<p>x</p>`, { nonce: '<script>' })).rejects.toThrow(
      /invalid CSP nonce/,
    );
  });

  it('accepts standard base64 + URL-safe nonces', async () => {
    // Must not throw — just exercises the validator.
    await renderToString(() => html`<p>x</p>`, { nonce: 'AbCdEf+/=_-1234' });
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
