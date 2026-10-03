import { describe, expect, it } from 'vite-plus/test';
import { purity } from '../src/index.ts';
import { build } from 'vite';

// Tests for the *.server.{ts,js,tsx,jsx} client-bundle strip — ADR 0018.

describe('server-module strip — default behavior', () => {
  const plugin = purity();

  function transform(code: string, id: string, ssr = false): unknown {
    return plugin.transform(code, id, { ssr });
  }

  it('replaces *.server.ts content in client builds', () => {
    const code = `
      import { serverAction } from '@purityjs/core';
      import { db } from './secret-db.ts';
      export const saveTodo = serverAction('/api/save', async (req) => {
        await db.insert({ text: 'secret' });
        return new Response('ok');
      });
    `;
    const result = transform(code, '/app/save-todo.server.ts');
    expect(result).not.toBeNull();
    expect((result as { code: string }).code).toMatch(/Server-only module stripped/);
    expect((result as { code: string }).code).toContain('export {};');
    // Ensure the secret import + handler body are gone.
    expect((result as { code: string }).code).not.toContain('secret-db');
    expect((result as { code: string }).code).not.toContain("'secret'");
  });

  it('passes through *.server.ts in SSR builds (handler bodies stay on the server)', () => {
    const code = `
      import { serverAction } from '@purityjs/core';
      export const saveTodo = serverAction('/api/save', async () => new Response('ok'));
    `;
    // SSR build: no html`` either, so transform returns null (unchanged).
    const result = transform(code, '/app/save-todo.server.ts', true);
    expect(result).toBeNull();
  });

  it('matches all four extensions: .server.ts, .server.js, .server.tsx, .server.jsx', () => {
    const code = 'export const x = 1;';
    for (const ext of ['ts', 'js', 'tsx', 'jsx']) {
      const result = transform(code, `/app/x.server.${ext}`);
      expect(result, `*.server.${ext} should be stripped`).not.toBeNull();
      expect((result as { code: string }).code).toContain('export {};');
    }
  });

  it('does NOT strip files that merely contain "server" in the path', () => {
    // Common false-positive guards.
    const code = 'export const x = 1;';
    expect(transform(code, '/app/server/index.ts')).toBeNull();
    expect(transform(code, '/app/myserver.ts')).toBeNull();
    expect(transform(code, '/app/server-utils.ts')).toBeNull();
  });

  it('preserves Vite query-string suffixes (e.g. ?worker, ?import)', () => {
    const code = 'export const x = 1;';
    const result = transform(code, '/app/save-todo.server.ts?import');
    expect(result).not.toBeNull();
    expect((result as { code: string }).code).toContain('export {};');
  });

  it('enforces the boundary before skipping framework or consumer paths', () => {
    const code = `import { foo } from 'x';`;
    for (const id of [
      '/node_modules/@purityjs/ssr/dist/server-action.server.ts',
      '/consumer/packages/core/auth.server.ts',
      '/consumer/packages/ssr/auth.server.ts',
      '/consumer/packages/vite-plugin/auth.server.ts',
      '/node_modules/@purityjs/consumer/auth.server.ts',
    ]) {
      expect((transform(code, id) as { code: string }).code).toContain('export {};');
    }
  });
});

describe('server-only production output boundary', () => {
  const marker = 'PURITY_SYNTHETIC_SERVER_SOURCE';
  async function bundle(path: string, query = '', ssr = false, enabled = true) {
    const entry = '/purity-security-fixture/main.js';
    const server = `/purity-security-fixture/${path}.server.ts`;
    const files = new Map([
      [entry, `import ${JSON.stringify(server + query)}; console.log('client');`],
      [server + query, `globalThis.__serverMarker = ${JSON.stringify(marker)};`],
    ]);
    return build({
      configFile: false,
      logLevel: 'silent',
      plugins: [
        purity({ stripServerModules: enabled }),
        {
          name: 'security-fixture',
          resolveId: (id) =>
            id.replaceAll('\\', '/').endsWith('/purity-security-fixture/main.js')
              ? entry
              : files.has(id)
                ? id
                : null,
          load: (id) => files.get(id) ?? null,
        },
      ],
      build: {
        write: false,
        minify: false,
        ssr: ssr ? entry : false,
        rolldownOptions: { input: entry },
      },
    });
  }

  it.each([
    'safe/auth',
    'packages/core/auth',
    'packages/ssr/auth',
    'packages/vite-plugin/auth',
    'node_modules/@purityjs/consumer/auth',
  ])('excludes server source from all chunks and assets for %s', async (path) => {
    const result = await bundle(path);
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it.each(['?url', '?raw', '?worker', '?sharedworker', '?worker&inline', '?import&url', '?%75rl'])(
    'rejects %s before asset emission',
    async (query) => {
      await expect(bundle('safe/auth', query)).rejects.toThrow(/Server-only modules cannot/);
    },
  );

  it('preserves server source in SSR builds and explicit opt-outs', async () => {
    expect(JSON.stringify(await bundle('safe/auth', '', true))).toContain(marker);
    expect(JSON.stringify(await bundle('safe/auth', '', false, false))).toContain(marker);
  });
});

describe('server-module strip — opt out', () => {
  it('respects stripServerModules: false', () => {
    const plugin = purity({ stripServerModules: false });
    const code = `
      import { serverAction } from '@purityjs/core';
      export const x = serverAction('/api/x', async () => new Response('ok'));
    `;
    const result = plugin.transform(code, '/app/x.server.ts', { ssr: false });
    // No html``, so the existing template transform also returns null.
    // Either way, the strip didn't kick in — code is preserved.
    if (result !== null) {
      expect((result as { code: string }).code).not.toContain('Server-only module stripped');
    }
  });
});

describe('server-module strip — composes with html`` compilation', () => {
  const plugin = purity();

  it('strips even when the file also contains html`` calls', () => {
    // A *.server.ts file might still have `html``` (string-builder via the
    // SSR plugin path). On the client build we strip first, so the html``
    // never gets compiled.
    const code = `
      import { html } from '@purityjs/core';
      import { serverAction } from '@purityjs/core';
      export const x = serverAction('/api/x', async () => {
        return new Response(html\`<p>hello</p>\`.toString());
      });
    `;
    const result = plugin.transform(code, '/app/x.server.ts', { ssr: false });
    expect(result).not.toBeNull();
    expect((result as { code: string }).code).toContain('export {};');
    expect((result as { code: string }).code).not.toContain('html`');
  });

  it('does not interfere with non-server.ts files', () => {
    const code = `
      import { html } from '@purityjs/core';
      const el = html\`<div>Hello</div>\`;
    `;
    const result = plugin.transform(code, '/app/component.ts', { ssr: false });
    // Existing template compilation kicked in.
    expect(result).not.toBeNull();
    expect((result as { code: string }).code).not.toContain('Server-only module stripped');
    expect((result as { code: string }).code).toContain('document.createElement');
  });
});
