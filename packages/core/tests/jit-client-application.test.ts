import { afterEach, describe, expect, it } from 'vite-plus/test';
import { mount } from '../src/component.ts';
import { html } from '../src/compiler/client.ts';
import { isDeferred, withHydration } from '../src/compiler/hydrate-runtime.ts';
import { html as fullHtml } from '../src/compiler/jit.ts';
import { state } from '../src/signals.ts';

const disposers: (() => void)[] = [];

function render(view: () => Node | DocumentFragment): HTMLElement {
  const host = document.createElement('main');
  document.body.append(host);
  const { unmount } = mount(view, host);
  disposers.push(unmount);
  return host;
}

afterEach(() => {
  while (disposers.length) disposers.pop()!();
  document.body.replaceChildren();
});

describe('client-only JIT application contracts', () => {
  it('shares subscriptions with a full-JIT child without a second signal graph', async () => {
    const count = state(0);
    const host = render(() => {
      const child = fullHtml`<strong>${count}</strong>`;
      return html`<section><span>${count}</span>${child}</section>`;
    });
    expect(host.querySelector('span')!.textContent).toBe('0');
    expect(host.querySelector('strong')!.textContent).toBe('0');
    count(3);
    await Promise.resolve();
    await Promise.resolve();
    expect(host.querySelector('span')!.textContent).toBe('3');
    expect(host.querySelector('strong')!.textContent).toBe('3');
  });

  it('preserves two-way form binding in both directions', async () => {
    const name = state('Ada');
    const host = render(() => html`<input ::value=${name} />`);
    const input = host.querySelector('input')!;
    expect(input.value).toBe('Ada');
    input.value = 'Grace';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(name()).toBe('Grace');
    name('Lin');
    await Promise.resolve();
    await Promise.resolve();
    expect(input.value).toBe('Lin');
  });

  it.each(['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,<script></script>'])(
    'retains URL safety for %s',
    (value) => {
      expect(() => html`<a href=${value}>Open</a>`).toThrow('Unsafe URL binding');
    },
  );

  it('coerces a URL once rather than validating a different string', () => {
    let reads = 0;
    const value = {
      toString() {
        reads++;
        return reads === 1 ? '/safe' : 'javascript:alert(1)';
      },
    };
    const host = render(() => html`<a href=${value}>Open</a>`);
    expect(host.querySelector('a')!.getAttribute('href')).toBe('/safe');
    expect(reads).toBe(1);
  });

  it('disposes bindings with their existing component owner', async () => {
    const count = state(0);
    let reads = 0;
    const text = () => {
      reads++;
      return count();
    };
    render(() => html`<p>${text}</p>`);
    count(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).toBe(2);
    disposers.pop()!();
    count(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(reads).toBe(2);
  });

  it('reuses a template call site without sharing nodes or captured values', () => {
    const view = (value: string) => html`<p>${value}</p>`;
    const first = render(() => view('first'));
    const second = render(() => view('second'));
    expect(first.textContent).toBe('first');
    expect(second.textContent).toBe('second');
    expect(first.querySelector('p')).not.toBe(second.querySelector('p'));
  });

  it('keeps the full-JIT hydration path usable after rejecting client-only rendering', () => {
    withHydration(() => {
      expect(() => html`<p>Client</p>`).toThrow('@purityjs/core/jit-client cannot hydrate');
      expect(isDeferred(fullHtml`<p>Hydrated</p>`)).toBe(true);
    });
    const host = render(() => html`<p>Client</p>`);
    expect(host.textContent).toBe('Client');
  });
});
