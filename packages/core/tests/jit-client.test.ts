import { describe, expect, it } from 'vite-plus/test';
import { mount } from '../src/component.ts';
import { html } from '../src/compiler/client.ts';
import { enterHydration, exitHydration } from '../src/compiler/hydrate-runtime.ts';
import { state } from '../src/signals.ts';

describe('client-only JIT entry', () => {
  it('updates ordinary DOM bindings and event listeners without hydration', async () => {
    const app = document.createElement('div');
    const count = state(0);
    const root = mount(
      () => html`<button @click=${() => count((value) => value + 1)}>Count: ${count}</button>`,
      app,
    );
    try {
      const button = app.querySelector('button')!;
      expect(button.textContent).toBe('Count: 0');
      button.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(button.textContent).toBe('Count: 1');
    } finally {
      root.unmount();
    }
  });

  it('rejects URL script protocols just as the full JIT does', () => {
    expect(() => html`<a href=${'javascript:alert(1)'}>Link</a>`).toThrow(
      '[Purity] Unsafe URL binding',
    );
  });

  it('rejects hydration before it changes existing server-rendered nodes', () => {
    const app = document.createElement('div');
    app.innerHTML = '<p>Server markup</p>';
    const previous = app.firstChild;
    enterHydration();
    try {
      expect(() => html`<p>Client markup</p>`).toThrow(
        '[Purity] @purityjs/core/jit-client cannot hydrate',
      );
      expect(app.firstChild).toBe(previous);
      expect(app.textContent).toBe('Server markup');
    } finally {
      exitHydration();
    }
  });
});
