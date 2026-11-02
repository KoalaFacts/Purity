// @vitest-environment jsdom
import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';
import { describe, expect, it, vi } from 'vite-plus/test';
import { purity } from '../src/index.ts';

const root = resolve(import.meta.dirname, '../../..');
const entry = resolve(root, 'benchmark/bundle-size/aot-effect-test-fixture.ts');

// Core and signals aliases exercise the source changes without rebuilding the
// shared package artifacts while other measurements are in progress.
async function bundle(source: string, hydratable = false) {
  let transformed = '';
  const fixture: Plugin = {
    name: 'aot-effect-fixture',
    resolveId(id) {
      return id === entry ? entry : null;
    },
    load(id) {
      return id === entry ? source : null;
    },
  };
  const proof: Plugin = {
    name: 'aot-effect-transform-proof',
    enforce: 'post',
    transform(code, id) {
      if (resolve(id.split('?')[0]!) === entry) transformed = code;
    },
  };
  const built = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    mode: 'production',
    resolve: {
      conditions: ['module', 'browser', 'production'],
      alias: {
        '@purityjs/core/csr-runtime': resolve(root, 'packages/core/src/runtime/csr-runtime.ts'),
        '@purityjs/signals': resolve(root, 'packages/signals/src/index.ts'),
      },
    },
    plugins: [fixture, purity({ hydratable }), proof],
    build: {
      write: false,
      minify: true,
      target: 'es2022',
      rollupOptions: { input: entry, preserveEntrySignatures: 'strict' },
    },
  });
  const result = Array.isArray(built) ? built[0] : built;
  const chunks = result.output.filter((part) => part.type === 'chunk');
  expect(chunks).toHaveLength(1);
  expect(transformed).toContain('__purity_tpl_');
  expect(transformed).not.toContain('html`');
  return {
    transformed,
    code: chunks[0].code,
    app: await import(
      `data:text/javascript;base64,${Buffer.from(chunks[0].code).toString('base64')}`
    ),
  };
}

describe('production AOT template effects', () => {
  it('preserves the forms side-effect import in production bundles', async () => {
    const { app } = await bundle(`
      import '@purityjs/core/forms';
      import { component } from '@purityjs/core';
      import { html } from '@purityjs/core/jit';
      export const register = () => component('p-form-side-effect-proof', () => html\`<input />\`, { formAssociated: true });
    `);
    expect(() => app.register()).not.toThrow();
    expect(
      (
        customElements.get('p-form-side-effect-proof') as typeof HTMLElement & {
          formAssociated: boolean;
        }
      ).formAssociated,
    ).toBe(true);
  }, 30000);

  it('omits hydration diagnostics until explicitly imported and enabled', async () => {
    const view = `
      import { html } from '@purityjs/core/jit';
      import { hydrate } from '@purityjs/core';
      export const start = (root) => hydrate(root, () => html\`<p>Hi \${'world'}</p>\`);
    `;
    const plain = await bundle(view, true);
    expect(plain.code).not.toContain('Hydration mismatch');
    const diagnosed = await bundle(
      `import { enableHydrationWarnings } from '@purityjs/core/runtime';\n${view}\nexport const enable = enableHydrationWarnings;`,
      true,
    );
    expect(diagnosed.code).toContain('Hydration mismatch');
    const host = document.createElement('div');
    host.innerHTML = '<p>Hello <!--[-->world<!--]--></p>';
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      diagnosed.app.enable();
      const mounted = diagnosed.app.start(host);
      expect(warning).toHaveBeenCalled();
      expect(host.textContent).toBe('Hello world');
      mounted.unmount();
    } finally {
      warning.mockRestore();
    }
  }, 30000);

  it('updates a compiled effect after a computed is created at runtime', async () => {
    const { app } = await bundle(`
      import { html } from '@purityjs/core/jit';
      import { mount, state, compute } from '@purityjs/core';
      const value = state(1);
      const useDerived = state(false);
      let derived;
      export const set = value;
      export const enable = () => { derived = compute(() => value() * 2); useDerived(true); };
      export const start = (root) => mount(() => html\`<p>\${() => useDerived() ? derived() : value()}</p>\`, root);
    `);
    const host = document.createElement('div');
    const mounted = app.start(host);
    expect(host.textContent).toBe('1');
    app.enable();
    await Promise.resolve();
    expect(host.textContent).toBe('2');
    app.set(3);
    await Promise.resolve();
    expect(host.textContent).toBe('6');
    mounted.unmount();
  }, 30000);

  it('uses the internal effect for nested templates alongside public watch and disposal', async () => {
    const { transformed, app } = await bundle(`
      import { html } from '@purityjs/core/jit';
      import { mount, state, watch } from '@purityjs/core';
      const value = state(0);
      let reads = 0;
      const changes = [];
      const stop = watch(value, (next, previous) => { changes.push([previous, next]); });
      export const set = value;
      export const history = changes;
      export const readCount = () => reads;
      export const stopPublic = stop;
      export const start = (root) => mount(() => html\`<section>
        \${html\`<p>\${() => { reads++; return value(); }}</p>\`}
        \${html\`<span>static</span>\`}
        <button @click=\${() => value((x) => x + 1)}>go</button>
      </section>\`, root);
    `);
    expect(transformed).toMatch(/watchEffectInternal as __purity_watch__/);
    expect(transformed).toMatch(/from ["']@purityjs\/core\/csr-runtime["']/);
    expect(transformed).not.toMatch(/watch as __purity_watch__/);
    const host = document.createElement('div');
    const mounted = app.start(host);
    expect(host.querySelector('p')?.textContent).toBe('0');
    expect(host.querySelector('span')?.textContent).toBe('static');
    host.querySelector('button')!.click();
    await Promise.resolve();
    expect(host.querySelector('p')?.textContent).toBe('1');
    expect(app.history).toEqual([[0, 1]]);
    mounted.unmount();
    const before = app.readCount();
    app.set(2);
    await Promise.resolve();
    expect(app.readCount()).toBe(before);
    expect(app.history).toEqual([
      [0, 1],
      [1, 2],
    ]);
    app.stopPublic();
  }, 30000);

  it.each([
    ['static', 'html`<p>Hello</p>`'],
    ['event', 'html`<button @click=${handler}>Tap</button>`'],
  ])(
    'omits the effect for %s-only templates',
    async (kind, view) => {
      const { transformed, app } = await bundle(`
      import { html } from '@purityjs/core/jit';
      export function make(handler) { return ${view}; }
    `);
      expect(transformed).not.toContain('watchEffectInternal');
      const clicks: number[] = [];
      const element = app.make(() => clicks.push(1)) as HTMLElement;
      if (kind === 'event') element.click();
      expect(element.textContent).toBe(kind === 'event' ? 'Tap' : 'Hello');
      expect(clicks).toEqual(kind === 'event' ? [1] : []);
    },
    30000,
  );

  it('leaves hydratable templates on their existing render path', async () => {
    const { transformed, app } = await bundle(
      `
      import { html } from '@purityjs/core/jit';
      import { hydrate, state } from '@purityjs/core';
      export const value = state('before');
      export const start = (root) => hydrate(root, () => html\`<p>\${value}</p>\`);
    `,
      true,
    );
    expect(transformed).not.toContain('watchEffectInternal');
    expect(transformed).toContain('renderCompiledTemplate');
    const host = document.createElement('div');
    host.innerHTML = '<p><!--[-->before<!--]--></p>';
    const paragraph = host.querySelector('p');
    const mounted = app.start(host);
    expect(host.querySelector('p')).toBe(paragraph);
    app.value('after');
    await Promise.resolve();
    expect(host.querySelector('p')?.textContent).toBe('after');
    mounted.unmount();
  }, 30000);
});
