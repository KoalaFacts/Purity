// End-to-end: actually run `vite build` against a tmpdir fixture with the
// plugin installed. Catches plugin-API mismatches the unit tests can't —
// e.g. enforce: 'pre' interaction, sourcemap chaining, ESM/CJS shape, etc.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { build } from 'vite';
import { purity } from '../src/index.ts';

describe('vite build pipeline', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'purity-vite-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('excludes the opted-in DevTools client from production HTML and JavaScript', async () => {
    writeFileSync(
      join(dir, 'index.html'),
      '<html><body><script type="module" src="/entry.ts"></script></body></html>',
    );
    writeFileSync(join(dir, 'entry.ts'), 'document.body.dataset.app = "production";');
    const result = await build({
      root: dir,
      configFile: false,
      logLevel: 'error',
      plugins: [purity({ devtools: true })],
      build: { write: false },
    });
    const output = (Array.isArray(result) ? result[0] : result).output;
    expect(output.some((item) => item.fileName === 'index.html')).toBe(true);
    for (const item of output) {
      const content = item.type === 'chunk' ? item.code : String(item.source);
      expect(content).not.toContain('purity-devtools');
      expect(content).not.toContain('Purity DevTools');
      expect(content).not.toContain('Filter reactive nodes');
    }
  }, 30000);

  it('builds a fixture using the plugin and emits compiled DOM calls', async () => {
    writeFileSync(
      join(dir, 'entry.ts'),
      `import { html } from '@purityjs/core';\n` +
        `export const make = (label: string) => html\`<p class="x">\${label}</p>\`;\n`,
    );

    const result = (await build({
      root: dir,
      logLevel: 'error',
      build: {
        write: false,
        sourcemap: true,
        lib: {
          entry: join(dir, 'entry.ts'),
          formats: ['es'],
          fileName: 'out',
        },
        rolldownOptions: { external: [/^@purityjs\//] },
      },
      plugins: [purity()],
    })) as Array<{ output: Array<{ fileName: string; code?: string; source?: string }> }>;

    const outputs = Array.isArray(result) ? result[0].output : (result as any).output;
    // Find the JS chunk: rolldown may use .js or .mjs depending on version.
    const js = outputs.find(
      (o: any) => typeof o.code === 'string' && /\.(m?js|cjs)$/.test(o.fileName),
    );
    if (!js) {
      // Surface what we got for debugging when the shape changes.
      throw new Error(
        `no JS chunk in output: ${JSON.stringify(outputs.map((o: any) => o.fileName))}`,
      );
    }
    const code = (js as { code: string }).code;

    // Plugin compiled the html`` template into direct DOM creation.
    expect(code).toContain('createElement');
    // The original html`` literal is gone.
    expect(code).not.toContain('html`');
    // The client bundle calls the precompiled hydration-aware runtime.
    expect(code).toMatch(/from\s*["']@purityjs\/core\/compiler["']/);
  }, 30000);

  it('emits a usable .map alongside the bundled output', async () => {
    writeFileSync(
      join(dir, 'entry.ts'),
      `import { html } from '@purityjs/core';\n` +
        `export const greet = () => html\`<h1>hello</h1>\`;\n`,
    );

    const result = (await build({
      root: dir,
      logLevel: 'error',
      build: {
        write: false,
        sourcemap: true,
        lib: {
          entry: join(dir, 'entry.ts'),
          formats: ['es'],
          fileName: 'out',
        },
        rolldownOptions: { external: [/^@purityjs\//] },
      },
      plugins: [purity()],
    })) as Array<{ output: Array<any> }>;

    const outputs = Array.isArray(result) ? result[0].output : (result as any).output;
    const map = outputs.find(
      (o: any) => o.fileName.endsWith('.map') || (o.map && typeof o.map === 'object'),
    );
    // Either Vite emitted a sibling `.map` chunk, or the JS chunk has an
    // inline `.map` property — both indicate sourcemap chaining worked.
    const jsChunk = outputs.find((o: any) => o.fileName.endsWith('.js'));
    const hasMap = map !== undefined || (jsChunk && jsChunk.map);
    expect(hasMap).toBe(true);
  }, 30000);
});
