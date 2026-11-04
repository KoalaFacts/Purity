import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build, type Plugin } from 'vite';
import { describe, expect, it } from 'vite-plus/test';
import { purity } from '../src/index.ts';

const entry = resolve(import.meta.dirname, '../../../benchmark/bundle-size/ssr-pruning-fixture.ts');

async function bundle(source: string): Promise<string> {
  const fixture: Plugin = {
    name: 'ssr-helper-pruning-fixture',
    resolveId: (id) => (id === entry ? entry : undefined),
    load: (id) => (id === entry ? source : undefined),
  };
  const output = await build({
    configFile: false,
    logLevel: 'silent',
    mode: 'production',
    resolve: { conditions: ['module', 'node', 'production'] },
    ssr: { noExternal: true },
    plugins: [fixture, purity()],
    build: {
      ssr: true,
      write: false,
      target: 'es2022',
      minify: true,
      sourcemap: false,
      rollupOptions: { input: entry, output: { entryFileNames: 'entry.js', codeSplitting: false } },
    },
  });
  if (Array.isArray(output) || !('output' in output)) throw new Error('Expected one output');
  const chunks = output.output.filter((part) => part.type === 'chunk');
  expect(chunks).toHaveLength(1);
  return chunks[0].code;
}

async function load(code: string): Promise<any> {
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

describe('production SSR helper pruning', () => {
  it('does not infer helper dependencies from static template text', () => {
    const source =
      "import { html } from '@purityjs/core/jit'; export const value = html`<p>_h.toHtml</p>`;";
    const result = purity().transform(source, 'fixture.ts', { ssr: true });
    expect(result?.code).toContain('markSSRHtml as __purity_ssr_mark__');
    expect(result?.code).not.toContain('valueToHtml as __purity_ssr_toHtml__');
  });

  it('renders a static AOT app without retaining the complete helpers bundle', async () => {
    const code = await bundle(`
      import { html } from '@purityjs/core/jit';
      import { renderToString } from '@purityjs/ssr';
      export function render() { return renderToString(() => html\`<p>Hello</p>\`); }
    `);
    expect(gzipSync(code, { level: 9 }).length).toBeLessThan(5150);
    const app = await load(code);
    expect(await app.render()).toBe('<p>Hello</p>');
  }, 30000);

  it('keeps escaping, nested values, registered components and raw-text slots', async () => {
    const code = await bundle(`
      // __purity_user_prefix and _h.toHtml are ordinary source text
      import { html } from '@purityjs/core/jit';
      import { component } from '@purityjs/core';
      import { renderToString } from '@purityjs/ssr';
      component('ssr-pruning-card', (_props, { default: body }) => html\`<textarea>\${body()}</textarea>\`);
      export function render(value, url) {
        return renderToString(() => html\`<main><a href=\${url} title=\${value}>\${html\`<strong>\${value}</strong>\`}</a><ssr-pruning-card><b>slot</b></ssr-pruning-card></main>\`);
      }
    `);
    const app = await load(code);
    const html = await app.render('<script>x</script>', '/safe');
    expect(html).toContain('title="&lt;script&gt;x&lt;/script&gt;"');
    expect(html).toContain('<strong><!--[-->&lt;script&gt;x&lt;/script&gt;<!--]--></strong>');
    expect(html).toContain(
      '<template shadowrootmode="open"><textarea>\nslot</textarea></template>',
    );
    expect(html).not.toContain('<script>');
    await expect(app.render('safe', 'javascript:alert(1)')).rejects.toThrow(/Unsafe URL binding/);
  }, 30000);

  it('protects AOT output from mutation of the public helper object', async () => {
    const code = await bundle(`
      import { html } from '@purityjs/core/jit';
      import { renderToString } from '@purityjs/ssr';
      import { ssrHelpers } from '@purityjs/ssr/runtime';
      export function poison() { ssrHelpers.toHtml = () => '<script>unsafe</script>'; }
      export function render(value) { return renderToString(() => html\`<p>\${value}</p>\`); }
    `);
    const app = await load(code);
    app.poison();
    expect(await app.render('<b>safe</b>')).toBe('<p><!--[-->&lt;b&gt;safe&lt;/b&gt;<!--]--></p>');
  }, 30000);
});
