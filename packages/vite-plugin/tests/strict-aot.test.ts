import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { build } from 'vite';
import { purity } from '../src/index.ts';
import { renderToString } from '../../ssr/src/render-to-string.ts';

const core = resolve(import.meta.dirname, '../../core/src');
const aliases = [
  {
    find: '@purityjs/ssr/runtime',
    replacement: resolve(import.meta.dirname, '../../ssr/src/runtime.ts'),
  },
  { find: '@purityjs/core/csr-runtime', replacement: join(core, 'runtime/csr-runtime.ts') },
  { find: '@purityjs/core/ssr-bridge', replacement: join(core, 'ssr-bridge.ts') },
  { find: '@purityjs/ssr', replacement: resolve(import.meta.dirname, '../../ssr/src/html.ts') },
  { find: '@purityjs/core/jit', replacement: join(core, 'compiler/jit.ts') },
  { find: '@purityjs/core/runtime', replacement: join(core, 'compiler/runtime.ts') },
];

describe('strict AOT diagnostics', () => {
  const source =
    "import { html } from '@purityjs/core/jit';\n    const bad = html`<my:component/>`;";

  it('fails real code generation with the source location and a repair hint', () => {
    expect(() =>
      purity({ hydratable: true, strictAot: false, ...{ strictAot: true } }).transform(
        source,
        '/app/view.ts',
      ),
    ).toThrow(/\/app\/view\.ts:2:17.*failed to compile html``.*Invalid[\s\S]*strictAot/);
  });

  it('rejects a module parse failure with location information', () => {
    expect(() =>
      purity({ hydratable: true, strictAot: false, ...{ strictAot: true } }).transform(
        "import { html } from '@purityjs/core/jit';\nconst bad = html`<p>unfinished;",
        '/app/view.ts',
      ),
    ).toThrow(/\/app\/view\.ts:\d+:\d+.*could not parse[\s\S]*strictAot/);
  });

  it('rejects a nested real code generation failure', () => {
    expect(() =>
      purity({ hydratable: true, strictAot: false, ...{ strictAot: true } }).transform(
        "import { html } from '@purityjs/core/jit';\nconst view = html`<div>${html`<my:component/>`}</div>`;",
        '/app/view.ts',
      ),
    ).toThrow(/view\.ts:2:.*failed to compile html``/);
  });

  it('adds source diagnostics to existing fatal template errors', () => {
    expect(() =>
      purity({ hydratable: true, strictAot: false, ...{ strictAot: true } }).transform(
        "import { html } from '@purityjs/core/jit';\nconst bad = html`<button onclick=${handler}>go</button>`;",
        '/app/view.ts',
      ),
    ).toThrow(/\/app\/view\.ts:2:13.*Unsafe dynamic binding/);
  });

  it('reports original source coordinates after ordinary list import specialization', () => {
    const source = [
      "import { each, state } from '@purityjs/core';",
      "import { html } from '@purityjs/core/jit';",
      'const rows = each([1, 2], value => value);',
      'const count = state(0);',
      'const view = html`<my:component/>`;',
    ].join('\n');
    expect(() =>
      purity({ hydratable: true, strictAot: false, ...{ strictAot: true } }).transform(
        source,
        '/app/view.ts',
      ),
    ).toThrow(/view\.ts:5:14.*Invalid tag name/);
  });

  it('also fails SSR compilation when a template cannot compile', () => {
    // A JavaScript parse error is a compilation failure in either target.
    expect(() =>
      purity({ hydratable: true, strictAot: false, ...{ strictAot: true } }).transform(
        'const view = html`<p>unfinished;',
        '/app/view.ts',
        {
          ssr: true,
        },
      ),
    ).toThrow(/could not parse/);
  });
});

describe('strict production client output', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'purity-strict-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function buildFixture(
    source: string,
    options: {
      skip?: boolean;
      external?: boolean;
      ssr?: boolean;
      strict?: boolean;
      format?: 'es' | 'cjs' | 'iife' | 'umd';
      mapped?: boolean;
      namedGlobals?: boolean;
      suppressWarnings?: boolean;
    } = {},
  ) {
    writeFileSync(join(dir, 'entry.js'), source);
    return build({
      root: dir,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: options.external ? [] : aliases },
      plugins: [
        purity({
          hydratable: true,
          strictAot: false,
          ...{
            strictAot: options.strict !== false,
            include: options.skip ? ['.ts'] : undefined,
          },
        }),
        ...(options.suppressWarnings
          ? [
              {
                name: 'suppress-missing-globals',
                onLog(_level: string, log: { code?: string }) {
                  if (log.code === 'MISSING_GLOBAL_NAME') return false;
                },
              },
            ]
          : []),
      ],
      build: {
        write: false,
        minify: true,
        ssr: options.ssr ? join(dir, 'entry.js') : false,
        lib: {
          entry: join(dir, 'entry.js'),
          formats: [options.format ?? 'es'],
          name: 'Test',
          fileName: 'out',
        },
        rolldownOptions: {
          external: options.external ? [/^@purityjs\//] : [],
          output: {
            globals:
              options.namedGlobals === false
                ? undefined
                : { '@purityjs/core/jit': 'purityJit', '@purityjs/ssr': 'puritySSR' },
            paths: options.mapped ? { '@purityjs/core/jit': '/vendor/purity-jit.js' } : undefined,
          },
        },
      },
    });
  }

  it('builds fully compiled templates with the actual runtime bundled', async () => {
    const result = await buildFixture(
      "import { html } from '@purityjs/core/jit'; export const make = () => html`<button>ok</button>`;",
    );
    const output = (Array.isArray(result) ? result[0] : result).output;
    expect(
      output.some((item) => item.type === 'chunk' && item.code.includes('createElement')),
    ).toBe(true);
  });

  it('rejects a retained aliased JIT tag with its module and chunk', async () => {
    await expect(
      buildFixture(
        "import { html as template } from '@purityjs/core/jit'; export const make = () => template`<p>jit</p>`;",
      ),
    ).rejects.toThrow(/strictAot[\s\S]*runtime compil[\s\S]*out\.m?js[\s\S]*compile\.ts/);
  });

  it('rejects a skipped user module that retains runtime compilation', async () => {
    await expect(
      buildFixture(
        "import { html } from '@purityjs/core/jit'; export const make = () => html`<p>jit</p>`;",
        { skip: true },
      ),
    ).rejects.toThrow(/strictAot[\s\S]*runtime compil/);
  });

  it('ignores dead imports removed from emitted modules', async () => {
    await expect(
      buildFixture(
        "import { html as template } from '@purityjs/core/jit'; export const value = 42;",
      ),
    ).resolves.toBeDefined();
  });

  it('allows an unrelated application Function constructor', async () => {
    await expect(
      buildFixture(
        "import { html as template } from '@purityjs/core/jit'; export const evaluate = new Function('return 42');",
      ),
    ).resolves.toBeDefined();
  });

  it('rejects retained external JIT imports after tree shaking', async () => {
    await expect(
      buildFixture(
        "import { html as template } from '@purityjs/core/jit'; export const make = () => template`<p>jit</p>`;",
        { external: true },
      ),
    ).rejects.toThrow(/strictAot[\s\S]*@purityjs\/core\/jit/);
  });

  it.each(['cjs', 'iife', 'umd'] as const)(
    'rejects a live external JIT dependency in %s output',
    async (format) => {
      await expect(
        buildFixture(
          "import { html as template } from '@purityjs/core/jit'; export const make = () => template`<p>jit</p>`;",
          { external: true, format },
        ),
      ).rejects.toThrow(/strictAot[\s\S]*runtime compil/);
    },
  );

  it.each([
    "import * as jit from '@purityjs/core/jit'; export { jit };",
    "import * as jit from '@purityjs/core/jit'; export const run = () => consume(jit);",
  ])('rejects an escaping JIT namespace in IIFE output: %s', async (source) => {
    await expect(buildFixture(source, { external: true, format: 'iife' })).rejects.toThrow(
      /strictAot[\s\S]*runtime compil/,
    );
  });

  it('preserves the consumer global of a real external SSR helper in IIFE output', async () => {
    const source =
      "import { renderToString } from '@purityjs/ssr'; export const render = renderToString;";
    for (const strict of [false, true]) {
      const result = await buildFixture(source, {
        external: true,
        format: 'iife',
        strict,
      });
      const output = (Array.isArray(result) ? result[0] : result).output;
      const chunk = output.find((item) => item.type === 'chunk')!;
      const app = new Function('puritySSR', `${chunk.code}; return Test;`)({ renderToString });
      expect(app.render).toBe(renderToString);
    }
  });

  it('preserves helper-only IIFE output when minified inner locals shadow its namespace', async () => {
    const source =
      "import { renderToString } from '@purityjs/ssr'; export const render = renderToString; export const compute = (x) => { const a = x(); return () => a; }; export const record = { t: 42 };";
    for (const strict of [false, true]) {
      const result = await buildFixture(source, { external: true, format: 'iife', strict });
      const output = (Array.isArray(result) ? result[0] : result).output;
      const chunk = output.find((item) => item.type === 'chunk')!;
      const app = new Function('puritySSR', `${chunk.code}; return Test;`)({ renderToString });
      expect(app.render).toBe(renderToString);
      expect(app.record.t).toBe(42);
      expect(app.compute(() => 42)()).toBe(42);
    }
  });

  it.each([false, true])(
    'requires verifiable IIFE globals even when warnings are suppressed=%s',
    async (suppressWarnings) => {
      await expect(
        buildFixture(
          "import { html as template } from '@purityjs/core/jit'; export const make = () => template`<p>jit</p>`;",
          { external: true, format: 'iife', namedGlobals: false, suppressWarnings },
        ),
      ).rejects.toThrow(
        /strictAot.*cannot verify external binding[\s\S]*output\.globals[\s\S]*bundle/,
      );
    },
  );

  it('rejects a mapped live external JIT dependency', async () => {
    await expect(
      buildFixture(
        "import { html as template } from '@purityjs/core/jit'; export const make = () => template`<p>jit</p>`;",
        { external: true, mapped: true },
      ),
    ).rejects.toThrow(/strictAot[\s\S]*runtime compil/);
  });

  it('allows a dead external JIT import in IIFE output', async () => {
    await expect(
      buildFixture(
        "import { html as template } from '@purityjs/core/jit'; export const value = 42;",
        { external: true, format: 'iife' },
      ),
    ).resolves.toBeDefined();
  });

  it('allows a dead external JIT import', async () => {
    await expect(
      buildFixture(
        "import { html as template } from '@purityjs/core/jit'; export const value = 42;",
        { external: true },
      ),
    ).resolves.toBeDefined();
  });

  it('rejects the real published-style bundled JIT path', async () => {
    const packageDir = join(dir, 'linked-core');
    mkdirSync(packageDir);
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: '@purityjs/core', type: 'module' }),
    );
    await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        outDir: join(packageDir, 'dist'),
        minify: true,
        lib: { entry: join(core, 'compiler/jit.ts'), formats: ['es'], fileName: () => 'jit.js' },
      },
    });
    writeFileSync(
      join(dir, 'entry.js'),
      `import { html as template } from './linked-core/dist/jit.js'; export const make = () => template\`<p>jit</p>\`;`,
    );
    await expect(
      build({
        root: dir,
        configFile: false,
        logLevel: 'silent',
        plugins: [purity({ hydratable: true, strictAot: false, ...{ strictAot: true } })],
        build: {
          write: false,
          lib: { entry: join(dir, 'entry.js'), formats: ['es'], fileName: 'out' },
        },
      }),
    ).rejects.toThrow(/strictAot[\s\S]*runtime compil[\s\S]*linked-core/);
  }, 30000);

  it('preserves default production fallback behavior', async () => {
    await expect(
      buildFixture(
        "import { html as template } from '@purityjs/core/jit'; export const make = () => template`<p>jit</p>`;",
        { strict: false },
      ),
    ).resolves.toBeDefined();
  });

  it('rejects the SSR runtime compiler accidentally retained in a client build', async () => {
    await expect(
      buildFixture(
        "import { html as template } from '@purityjs/ssr'; export const make = () => template`<p>server</p>`;",
      ),
    ).rejects.toThrow(/strictAot[\s\S]*runtime compil[\s\S]*html\.ts/);
  });

  it('rejects external SSR html retained in a client build', async () => {
    await expect(
      buildFixture(
        "import { html as template } from '@purityjs/ssr'; export const make = () => template`<p>server</p>`;",
        { external: true },
      ),
    ).rejects.toThrow(/strictAot[\s\S]*@purityjs\/ssr/);
  });

  it('supports the real SSR runtime compiler in a server build', async () => {
    await expect(
      buildFixture(
        "import { html as template } from '@purityjs/ssr'; export const make = () => template`<p>server</p>`;",
        { ssr: true },
      ),
    ).resolves.toBeDefined();
  });

  it('allows server-only JIT/compiler support in an SSR build', async () => {
    await expect(
      buildFixture(
        "import { html as template } from '@purityjs/core/jit'; export const make = () => template`<p>server</p>`;",
        { ssr: true },
      ),
    ).resolves.toBeDefined();
  });
});
