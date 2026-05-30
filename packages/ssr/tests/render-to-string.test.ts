import { state } from '@purityjs/core';
import { isSSRHtml, markSSRHtml } from '@purityjs/core/compiler';
import { resource } from '@purityjs/core';
import { describe, expect, it } from 'vitest';
import { html, renderToString } from '../src/index.ts';

// queueMicrotask-as-promise — lets us yield to the renderToString await
// loop without a setTimeout dependency.
const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

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

describe('renderToString — audit-v2 AbortSignal + cleanup hardening', () => {
  it('rejects synchronously-aborted signals before invoking the component', async () => {
    // Pre-flight check: if the caller has already given up (client
    // disconnect arrived before the handler started rendering) there's
    // no point pushing a render context or invoking the user component.
    // Mirrors `fetch`'s pre-aborted-signal behaviour.
    const ac = new AbortController();
    ac.abort();
    let calls = 0;
    await expect(
      renderToString(
        () => {
          calls++;
          return html`<p>x</p>`;
        },
        { signal: ac.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(0);
  });

  it('rejects mid-await with the signal reason when the signal fires', async () => {
    // The abort race branch must win over the still-pending fetcher and
    // the global-timeout timer. Without the wiring, an HTTP-disconnect-
    // driven abort still holds the render slot for the full `timeout`
    // window while the pending fetch runs to completion.
    const ac = new AbortController();
    const promise = renderToString(
      () => {
        const r = resource(() => new Promise<string>(() => {}));
        return html`<p>${() => r() ?? ''}</p>`;
      },
      { signal: ac.signal, timeout: 30_000 },
    );
    // Yield so the renderToString pass has time to install its abort
    // listener before we fire abort.
    await tick();
    await new Promise((r) => setImmediate(r));
    ac.abort(new Error('client gone'));
    await expect(promise).rejects.toThrow('client gone');
  });

  it('detaches the abort listener once the render settles cleanly', async () => {
    // A long-lived AbortSignal (shared across many renders) shouldn't
    // accumulate one listener per renderToString call. The race-
    // resolution path must detach the listener on the happy path too,
    // not only when the abort branch fires.
    const ac = new AbortController();
    let added = 0;
    let removed = 0;
    const realAdd = ac.signal.addEventListener.bind(ac.signal);
    const realRemove = ac.signal.removeEventListener.bind(ac.signal);
    ac.signal.addEventListener = ((type: string, listener: unknown, opts?: unknown) => {
      if (type === 'abort') added++;
      return realAdd(type, listener as EventListener, opts as AddEventListenerOptions);
    }) as typeof ac.signal.addEventListener;
    ac.signal.removeEventListener = ((type: string, listener: unknown, opts?: unknown) => {
      if (type === 'abort') removed++;
      return realRemove(type, listener as EventListener, opts as EventListenerOptions);
    }) as typeof ac.signal.removeEventListener;
    const out = await renderToString(
      () => {
        const r = resource(() => Promise.resolve('ok'));
        return html`<p>${() => r() ?? ''}</p>`;
      },
      { signal: ac.signal },
    );
    expect(out).toContain('ok');
    expect(added).toBeGreaterThan(0);
    expect(removed).toBe(added);
  });

  it('pops the SSR context even when the user component throws synchronously', async () => {
    // If a synchronous throw inside valueToHtml(component()) escaped the
    // pass loop without popping the context, the next renderToString call
    // would inherit the stale frame on top of the stack. Two back-to-back
    // renders must each see a fresh, isolated context — the second one
    // resolves correctly only if the first one's stack frame was popped.
    await expect(
      renderToString(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const out = await renderToString(() => {
      const r = resource(() => Promise.resolve('clean'));
      return html`<p>${() => r() ?? ''}</p>`;
    });
    expect(out).toContain('clean');
  });

  it('does not surface an unhandled rejection when a resource fetcher rejects', async () => {
    // resource() folds fetcher rejections into resolve(undefined) + an
    // error() accessor, but the defensive `.then(ok, err)` on the
    // Promise.all race ensures that even if a rogue primitive ever
    // pushes a raw rejecting promise onto ctx.pendingPromises we don't
    // surface it as an unhandledRejection. Regression-proxy: a render
    // that exercises the rejection path completes cleanly without any
    // unhandled rejection during its run.
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      seen.push(reason);
    };
    const existing = process.listeners('unhandledRejection');
    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', onUnhandled);
    try {
      const out = await renderToString(() => {
        const r = resource<string>(() => Promise.reject(new Error('fetcher boom')));
        return html`<p>${() => (r.error() ? 'errored' : '...')}</p>`;
      });
      expect(out).toContain('errored');
      await tick();
      await new Promise((r) => setImmediate(r));
      expect(seen).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
      for (const l of existing) process.on('unhandledRejection', l);
    }
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
