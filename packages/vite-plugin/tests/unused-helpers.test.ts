// @vitest-environment jsdom
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build, type Plugin } from 'vite';
import { describe, expect, it } from 'vite-plus/test';
import { purity } from '../src/index.ts';

const entry = resolve(
  import.meta.dirname,
  '../../../benchmark/bundle-size/unused-helpers-fixture.ts',
);

async function bundle(
  source: string,
  hydratable: boolean,
): Promise<{ code: string; modules: string[] }> {
  const fixture: Plugin = {
    name: 'unused-helpers-fixture',
    resolveId(id) {
      return id === entry ? entry : null;
    },
    load(id) {
      return id === entry ? source : null;
    },
  };
  const built = await build({
    configFile: false,
    logLevel: 'silent',
    mode: 'production',
    resolve: { conditions: ['module', 'browser', 'production'] },
    plugins: [fixture, purity({ hydratable })],
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
  return {
    code: chunks[0].code,
    modules: Object.entries(chunks[0].modules)
      .filter(([, info]) => info.renderedLength > 0)
      .map(([path]) => path.replaceAll('\\', '/')),
  };
}

async function load(code: string): Promise<any> {
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

describe('AOT helper imports when generated identifiers collide', () => {
  it.each([false, true])(
    'does not retain unused URL and template helpers when hydratable=%s',
    async (hydratable) => {
      const source = `import { html } from '@purityjs/core/jit';
        export function make(handler) { return html\`<button @click=\${handler}>go</button>\`; }`;
      const { code: normal } = await bundle(source, hydratable);
      const { code: collided } = await bundle(`// __purity_user_comment\n${source}`, hydratable);

      expect(collided).not.toContain('Unsafe URL binding');
      expect(gzipSync(collided, { level: 9 }).length).toBeLessThanOrEqual(
        gzipSync(normal, { level: 9 }).length + 64,
      );
    },
    30000,
  );

  it('preserves URL validation and complex template cloning with a user binding collision', async () => {
    const { code } = await bundle(
      `import { html } from '@purityjs/core/jit';
       const __purity_tmpl__ = 'user value';
       export const user = __purity_tmpl__;
       export function make(url) { return html\`<section><a href=\${url}><span>go</span></a><p>tail</p></section>\`; }`,
      false,
    );
    const module = await load(code);
    expect(module.user).toBe('user value');
    const first = module.make('/safe') as HTMLElement;
    const second = module.make('/other') as HTMLElement;
    expect(first.querySelector('a')?.getAttribute('href')).toBe('/safe');
    expect(second.querySelector('a')?.getAttribute('href')).toBe('/other');
    expect(first).not.toBe(second);
    expect(() => module.make('javascript:alert(1)')).toThrow(/Unsafe URL binding/);
  }, 30000);

  it('hydrates existing complex DOM when an escaped user identifier collides', async () => {
    const { code } = await bundle(
      `import { html } from '@purityjs/core/jit';
       import { hydrate } from '@purityjs/core';
       const __purity\\u005ftmpl__ = 'user value';
       export const user = __purity\\u005ftmpl__;
       export function start(root, url) { return hydrate(root, () => html\`<section><a href=\${url}><span>go</span></a><p>tail</p></section>\`); }`,
      true,
    );
    const module = await load(code);
    const root = document.createElement('div');
    root.innerHTML = '<section><a href="/safe"><span>go</span></a><p>tail</p></section>';
    const anchor = root.querySelector('a');
    const result = module.start(root, '/safe');
    expect(module.user).toBe('user value');
    expect(root.querySelector('a')).toBe(anchor);
    expect(anchor?.getAttribute('href')).toBe('/safe');
    result.unmount();
  }, 30000);
});

describe('AOT templates without reactive bindings', () => {
  it.each(['_w', '__purity_url__'])(
    'does not treat static text %s as a runtime helper reference',
    async (text) => {
      const source = `import { html } from '@purityjs/core/jit';
        export function make() { return html\`<p>${text}</p>\`; }`;
      const { code, modules } = await bundle(source, false);
      expect(modules.some((path) => path.includes('/packages/signals/'))).toBe(false);
      expect(modules.some((path) => path.includes('/csr-runtime/'))).toBe(false);
      const app = await load(code);
      const root = document.createElement('div');
      root.append(app.make());
      expect(root.textContent).toBe(text);
    },
    30000,
  );

  it.each([
    ['static', 'html`<p>Hello</p>`'],
    ['event', 'html`<button @click=${handler}>Tap</button>`'],
  ])(
    'does not include signals for an isolated %s template',
    async (_kind, view) => {
      const source = `import { html } from '@purityjs/core/jit';
      export function make(handler) { return ${view}; }`;
      const { code, modules } = await bundle(source, false);
      expect(modules.some((path) => path.includes('/packages/signals/'))).toBe(false);
      const app = await load(code);
      let clicks = 0;
      const node = app.make(() => clicks++) as Node;
      const root = document.createElement('div');
      root.append(node);
      root.querySelector('button')?.click();
      expect(clicks).toBe(_kind === 'event' ? 1 : 0);
      expect(root.textContent).toBe(_kind === 'event' ? 'Tap' : 'Hello');
    },
    30000,
  );

  it('retains reactive updates when a template actually uses a signal', async () => {
    const { code, modules } = await bundle(
      `import { html } from '@purityjs/core/jit';
       import { state } from '@purityjs/core';
       const value = state('before');
       export function setValue(next) { value(next); }
       export function make() { return html\`<p>\${() => value()}</p>\`; }`,
      false,
    );
    expect(modules.some((path) => path.includes('/packages/signals/'))).toBe(true);
    const app = await load(code);
    const root = document.createElement('div');
    root.append(app.make());
    expect(root.textContent).toBe('before');
    app.setValue('after');
    await Promise.resolve();
    expect(root.textContent).toBe('after');
  }, 30000);
});
