import { eachSSR, listSSR, matchSSR, state, whenSSR } from '@purityjs/core';
import { describe, expect, it } from 'vitest';
import { html, renderToString } from '../src/index.ts';

describe('whenSSR + html', () => {
  it('renders the then branch', async () => {
    const ok = state(true);
    const out = await renderToString(
      () =>
        html`<div>
          ${whenSSR(
            () => ok(),
            () => html`<p>yes</p>`,
          )}
        </div>`,
    );
    expect(out).toBe('<div><!--[--><!--m:true--><p>yes</p><!--/m--><!--]--></div>');
  });

  it('renders the else branch', async () => {
    const ok = state(false);
    const out = await renderToString(
      () =>
        html`<div>
          ${whenSSR(
            () => ok(),
            () => html`<p>yes</p>`,
            () => html`<p>no</p>`,
          )}
        </div>`,
    );
    expect(out).toBe('<div><!--[--><!--m:false--><p>no</p><!--/m--><!--]--></div>');
  });
});

describe('matchSSR + html', () => {
  it('renders the matching case', async () => {
    const status = state<'loading' | 'ready' | 'error'>('ready');
    const out = await renderToString(
      () =>
        html`<section>
          ${matchSSR(() => status(), {
            loading: () => html`<p>...</p>`,
            ready: () => html`<p>OK</p>`,
            error: () => html`<p>!</p>`,
          })}
        </section>`,
    );
    expect(out).toBe('<section><!--[--><!--m:ready--><p>OK</p><!--/m--><!--]--></section>');
  });

  it('falls through to fallback', async () => {
    const out = await renderToString(
      () =>
        html`<section>
          ${matchSSR(
            () => 'unknown',
            { a: () => html`<p>A</p>` },
            () => html`<p>fallback</p>`,
          )}
        </section>`,
    );
    expect(out).toBe('<section><!--[--><!--m:unknown--><p>fallback</p><!--/m--><!--]--></section>');
  });
});

describe('eachSSR + html', () => {
  it('renders a list of items', async () => {
    const items = state(['a', 'b', 'c']);
    const out = await renderToString(
      () =>
        html`<ul>
          ${eachSSR(
            () => items(),
            (item) => html`<li>${() => item()}</li>`,
          )}
        </ul>`,
    );
    expect(out).toBe(
      '<ul><!--[--><!--e-->' +
        '<!--er:a--><li><!--[-->a<!--]--></li><!--/er-->' +
        '<!--er:b--><li><!--[-->b<!--]--></li><!--/er-->' +
        '<!--er:c--><li><!--[-->c<!--]--></li><!--/er-->' +
        '<!--/e--><!--]--></ul>',
    );
  });

  it('renders an empty list', async () => {
    const out = await renderToString(
      () =>
        html`<ul>
          ${eachSSR(
            () => [],
            (item) => html`<li>${() => item()}</li>`,
          )}
        </ul>`,
    );
    expect(out).toBe('<ul><!--[--><!--e--><!--/e--><!--]--></ul>');
  });

  it('renders objects with multiple bindings per row', async () => {
    interface Todo {
      id: number;
      text: string;
      done: boolean;
    }
    const todos = state<Todo[]>([
      { id: 1, text: 'Write tests', done: true },
      { id: 2, text: 'Ship SSR', done: false },
    ]);
    const out = await renderToString(
      () =>
        html`<ul>
          ${eachSSR(
            () => todos(),
            (todo) =>
              html`<li class=${() => (todo().done ? 'done' : '')}>${() => todo().text}</li>`,
            (todo) => todo.id,
          )}
        </ul>`,
    );
    expect(out).toContain('<li class="done"><!--[-->Write tests<!--]--></li>');
    // Empty-string dynamic attr renders as the bare-name boolean form —
    // semantically equivalent to `class=""` for the `class` attribute.
    expect(out).toContain('<li class><!--[-->Ship SSR<!--]--></li>');
  });
});

describe('listSSR + html', () => {
  it('renders a flat list', async () => {
    const out = await renderToString(
      () =>
        html`<ul>
          ${listSSR('li', ['x', 'y'], (s) => s)}
        </ul>`,
    );
    expect(out).toBe('<ul><!--[--><!--l--><li>x</li><li>y</li><!--/l--><!--]--></ul>');
  });

  it('escapes content and attributes', async () => {
    const out = await renderToString(
      () =>
        html`<ul>
          ${listSSR('li', [{ name: '<x>', cls: 'a"b' }], {
            text: (item) => item.name,
            class: (item) => item.cls,
          })}
        </ul>`,
    );
    expect(out).toContain('<li class="a&quot;b">&lt;x&gt;</li>');
  });
});
