// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { html, hydrate, state } from '../src/index.ts';

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  unmount = undefined;
  document.body.replaceChildren();
});
function fixture(markup: string) {
  const host = document.createElement('div');
  host.innerHTML = markup;
  document.body.appendChild(host);
  return host;
}

describe('hydrate arrays of templates', () => {
  it('preserves array data identity and shape in recreated element properties', () => {
    const host = fixture('<main><!--[--><section><div></div></section><!--]--></main>');
    const payload = [['x']];
    unmount = hydrate(
      host,
      () => html`<main>${[html`<section><div .payload=${payload}></div></section>`]}</main>`,
    ).unmount;
    expect((host.querySelector('div') as HTMLElement & { payload: unknown }).payload).toBe(payload);
    expect(payload).toEqual([['x']]);
  });

  it('materialises template arrays inside a recreated array item', async () => {
    const host = fixture(
      '<main><!--[--><section><button>one</button><button>two</button></section><!--]--></main>',
    );
    const label = state('one');
    let clicks = 0;
    unmount = hydrate(
      host,
      () =>
        html`<main>${[
          html`<section>${[
            html`<button @click=${() => clicks++}>${() => label()}</button>`,
            html`<button>two</button>`,
          ]}</section>`,
        ]}</main>`,
    ).unmount;
    expect(host.querySelectorAll('section button')).toHaveLength(2);
    expect(host.textContent).toBe('onetwo');
    host.querySelector('button')!.click();
    expect(clicks).toBe(1);
    label('updated');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(host.textContent).toBe('updatedtwo');
  });

  it('flattens nested mixed arrays when recreating an item and ignores cyclic repeats', () => {
    const host = fixture(
      '<main><!--[--><section>prefix<span>middle</span>0suffix</section><!--]--></main>',
    );
    const nested: unknown[] = ['prefix', [html`<span>middle</span>`, null, false, [0]], 'suffix'];
    nested.push(nested);
    unmount = hydrate(
      host,
      () => html`<main>${[html`<section>${nested}</section>`]}</main>`,
    ).unmount;
    expect(host.textContent).toBe('prefixmiddle0suffix');
    expect(host.querySelectorAll('span')).toHaveLength(1);
  });

  it('materialises deferred templates instead of stringifying them', () => {
    const host = fixture(
      '<main><!--[--><button>First</button><button>Second</button><!--]--></main>',
    );
    let clicks = 0;
    const result = hydrate(
      host,
      () =>
        html`<main>${[
          html`<button @click=${() => clicks++}>First</button>`,
          html`<button @click=${() => clicks++}>Second</button>`,
        ]}</main>`,
    );
    unmount = result.unmount;
    expect(host.textContent).toBe('FirstSecond');
    expect(host.querySelectorAll('button')).toHaveLength(2);
    host.querySelector('button')!.click();
    expect(clicks).toBe(1);
  });

  it('preserves empty-value semantics and nested array order', () => {
    const host = fixture('<main><!--[-->prefix<span>Middle</span>0suffix<!--]--></main>');
    unmount = hydrate(
      host,
      () =>
        html`<main>${[
          'prefix',
          null,
          false,
          undefined,
          [html`<span>Middle</span>`, 0],
          'suffix',
        ]}</main>`,
    ).unmount;
    expect(host.textContent).toBe('prefixMiddle0suffix');
    expect(host.querySelector('span')?.textContent).toBe('Middle');
  });

  it('materialises nested template values and keeps reactive text live', async () => {
    const host = fixture(
      '<main><!--[--><section><span><!--[-->one<!--]--></span></section><!--]--></main>',
    );
    const value = state('one');
    unmount = hydrate(
      host,
      () => html`<main>${[html`<section>${html`<span>${() => value()}</span>`}</section>`]}</main>`,
    ).unmount;
    expect(host.querySelector('span')?.textContent).toBe('one');
    value('two');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(host.querySelector('span')?.textContent).toBe('two');
  });
});
