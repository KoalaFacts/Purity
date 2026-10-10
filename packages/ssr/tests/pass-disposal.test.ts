import { component, compute, state, watch } from '@purityjs/core';
import { describe, expect, it } from 'vite-plus/test';
import { html, renderToString } from '../src/index.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

// Watches created while a request renders belong to that render pass. Before
// passes owned their reactive work, every request left a watcher subscribed
// to module-level state on the server.
describe('SSR render pass disposal', () => {
  it('stops watchers created during a render once the render finishes', async () => {
    const shared = state(0);
    let runs = 0;
    const App = () => {
      watch(() => {
        runs++;
        shared();
      });
      return html`<p>ok</p>`;
    };
    for (let i = 0; i < 5; i++) await renderToString(App);
    expect(runs).toBe(5);

    runs = 0;
    shared(1);
    await tick();
    expect(runs).toBe(0);
  });

  it('stops watchers created inside a custom component rendered on the server', async () => {
    const shared = state(0);
    let runs = 0;
    component('ssr-owned-watch', () => {
      watch(() => {
        runs++;
        shared();
      });
      return html`<span>c</span>`;
    });
    const App = () => html`<div><ssr-owned-watch></ssr-owned-watch></div>`;
    for (let i = 0; i < 3; i++) await renderToString(App);
    expect(runs).toBe(3);

    runs = 0;
    shared(1);
    await tick();
    expect(runs).toBe(0);
  });

  it('still renders values derived during the pass', async () => {
    const shared = state(2);
    const App = () => {
      const doubled = compute(() => shared() * 2);
      return html`<p>${() => doubled()}</p>`;
    };
    expect(await renderToString(App)).toContain('4');
  });
});
