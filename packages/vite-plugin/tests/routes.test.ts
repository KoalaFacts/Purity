import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { purity } from '../src/index.ts';
import {
  buildRouteManifest,
  fileToRoute,
  generateRouteManifestSource,
  sortRoutes,
} from '../src/routes.ts';

// Tests for ADR 0019 — file-system routing manifest. Pure unit tests for
// the filename-to-pattern derivation + sorting + codegen, plus a couple of
// integration tests for the Vite plugin glue (resolveId / load) using
// real tmpdir directories.

const EXTS = ['.ts', '.tsx', '.js', '.jsx'];

describe('fileToRoute — filename → pattern grammar', () => {
  it('maps index.ts at the root to /', () => {
    expect(fileToRoute('index.ts', EXTS)).toEqual({ pattern: '/', filePath: 'index.ts' });
  });

  it('maps about.ts to /about', () => {
    expect(fileToRoute('about.ts', EXTS)).toEqual({ pattern: '/about', filePath: 'about.ts' });
  });

  it('maps users/index.ts to /users', () => {
    expect(fileToRoute('users/index.ts', EXTS)).toEqual({
      pattern: '/users',
      filePath: 'users/index.ts',
    });
  });

  it('maps users/[id].ts to /users/:id', () => {
    expect(fileToRoute('users/[id].ts', EXTS)).toEqual({
      pattern: '/users/:id',
      filePath: 'users/[id].ts',
    });
  });

  it('maps blog/[...slug].ts to /blog/* (splat)', () => {
    expect(fileToRoute('blog/[...slug].ts', EXTS)).toEqual({
      pattern: '/blog/*',
      filePath: 'blog/[...slug].ts',
    });
  });

  it('handles multiple dynamic segments', () => {
    expect(fileToRoute('orgs/[org]/users/[id].ts', EXTS)).toEqual({
      pattern: '/orgs/:org/users/:id',
      filePath: 'orgs/[org]/users/[id].ts',
    });
  });

  it('accepts every configured extension', () => {
    for (const ext of EXTS) {
      const r = fileToRoute(`page${ext}`, EXTS);
      expect(r?.pattern).toBe('/page');
    }
  });

  it('rejects files with non-matching extensions', () => {
    expect(fileToRoute('page.md', EXTS)).toBeNull();
    expect(fileToRoute('styles.css', EXTS)).toBeNull();
  });

  it('rejects files in any underscore-prefixed segment (reserved)', () => {
    expect(fileToRoute('_layout.ts', EXTS)).toBeNull();
    expect(fileToRoute('_404.ts', EXTS)).toBeNull();
    expect(fileToRoute('users/_helpers.ts', EXTS)).toBeNull();
    expect(fileToRoute('_admin/users.ts', EXTS)).toBeNull();
  });

  it('rejects splat segments that are not the last segment', () => {
    expect(fileToRoute('blog/[...slug]/comments.ts', EXTS)).toBeNull();
  });

  it('rejects empty bracket names', () => {
    expect(fileToRoute('users/[].ts', EXTS)).toBeNull();
  });

  it('treats `index` only as a directory marker when it is the leaf', () => {
    // `index/about.ts` keeps `index` as a literal segment.
    expect(fileToRoute('index/about.ts', EXTS)?.pattern).toBe('/index/about');
  });
});

describe('sortRoutes — most-specific first', () => {
  it('sorts literal-only routes before dynamic routes at the same depth', () => {
    const sorted = sortRoutes([
      { pattern: '/users/:id', filePath: 'users/[id].ts' },
      { pattern: '/users/me', filePath: 'users/me.ts' },
    ]);
    expect(sorted.map((e) => e.pattern)).toEqual(['/users/me', '/users/:id']);
  });

  it('sorts deeper literal routes before shorter ones', () => {
    const sorted = sortRoutes([
      { pattern: '/about', filePath: 'about.ts' },
      { pattern: '/about/team', filePath: 'about/team.ts' },
    ]);
    expect(sorted.map((e) => e.pattern)).toEqual(['/about/team', '/about']);
  });

  it('places splat routes last', () => {
    const sorted = sortRoutes([
      { pattern: '/blog/*', filePath: 'blog/[...slug].ts' },
      { pattern: '/blog/:year', filePath: 'blog/[year].ts' },
      { pattern: '/blog/index', filePath: 'blog/index/page.ts' },
    ]);
    expect(sorted[sorted.length - 1].pattern).toBe('/blog/*');
  });

  it('is stable — alphabetical on the final tiebreaker', () => {
    const sorted = sortRoutes([
      { pattern: '/zebra', filePath: 'zebra.ts' },
      { pattern: '/alpha', filePath: 'alpha.ts' },
      { pattern: '/middle', filePath: 'middle.ts' },
    ]);
    expect(sorted.map((e) => e.pattern)).toEqual(['/alpha', '/middle', '/zebra']);
  });
});

describe('buildRouteManifest', () => {
  it('builds + sorts a typical pages tree', () => {
    const files = [
      'index.ts',
      'about.ts',
      'users/index.ts',
      'users/me.ts',
      'users/[id].ts',
      'blog/[...slug].ts',
      '_layout.ts', // reserved — dropped
      'README.md', // wrong ext — dropped
    ];
    const manifest = buildRouteManifest(files, EXTS);
    expect(manifest.map((e) => e.pattern)).toEqual([
      '/users/me',
      '/about',
      '/users',
      '/users/:id',
      '/',
      '/blog/*',
    ]);
  });

  it('reports + drops conflicts deterministically', () => {
    const conflicts: Array<[string, string, string]> = [];
    const manifest = buildRouteManifest(
      // Both files map to /users — alphabetic tiebreaker keeps `users.ts`.
      ['users.ts', 'users/index.ts'],
      EXTS,
      (pattern, kept, dropped) => conflicts.push([pattern, kept, dropped]),
    );
    expect(manifest.map((e) => e.filePath)).toEqual(['users.ts']);
    expect(conflicts).toEqual([['/users', 'users.ts', 'users/index.ts']]);
  });

  it('returns an empty manifest for an empty file list', () => {
    expect(buildRouteManifest([], EXTS)).toEqual([]);
  });
});

describe('generateRouteManifestSource', () => {
  it('emits an array of entries with import functions', () => {
    const src = generateRouteManifestSource(
      [
        { pattern: '/', filePath: 'index.ts' },
        { pattern: '/users/:id', filePath: 'users/[id].ts' },
      ],
      (rel) => `/abs/pages/${rel}`,
    );
    expect(src).toContain('pattern: "/"');
    expect(src).toContain('filePath: "index.ts"');
    expect(src).toContain('import("/abs/pages/index.ts")');
    expect(src).toContain('pattern: "/users/:id"');
    expect(src).toContain('import("/abs/pages/users/[id].ts")');
  });

  it('escapes patterns with quotes via JSON.stringify', () => {
    const src = generateRouteManifestSource(
      [{ pattern: "/weird'path", filePath: "weird'path.ts" }],
      (rel) => `/abs/${rel}`,
    );
    // Single quotes inside double-quoted JSON strings need no escaping —
    // the emitted source is still parseable JS.
    expect(src).toContain(`pattern: "/weird'path"`);
    expect(src).toContain(`filePath: "weird'path.ts"`);
  });
});

describe('purity({ routes }) — Vite plugin integration', () => {
  function makeTmpPages(layout: Record<string, string>): { root: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), 'purity-routes-'));
    for (const [rel, content] of Object.entries(layout)) {
      const abs = join(root, rel);
      mkdirSync(abs.replace(/\/[^/]+$/, ''), { recursive: true });
      writeFileSync(abs, content);
    }
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  it('exposes the virtual module + emits a sorted manifest', () => {
    const { root, cleanup } = makeTmpPages({
      'pages/index.ts': '// home',
      'pages/about.ts': '// about',
      'pages/users/[id].ts': '// user detail',
      'pages/users/me.ts': '// me',
    });
    try {
      const plugin = purity({ routes: { dir: 'pages' } });
      // Simulate Vite's lifecycle: configResolved → resolveId → load.
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      const resolved = (plugin as { resolveId: (s: string) => string | null }).resolveId(
        'purity:routes',
      );
      expect(resolved).toBe('\0purity:routes');
      const src = (plugin as { load: (id: string) => string | null }).load(resolved as string);
      expect(src).toContain('pattern: "/users/me"');
      expect(src).toContain('pattern: "/users/:id"');
      // Order: literal /users/me before dynamic /users/:id; / last among the
      // literal-depth-1 routes.
      const meIdx = (src as string).indexOf('"/users/me"');
      const idIdx = (src as string).indexOf('"/users/:id"');
      const homeIdx = (src as string).indexOf('"/"');
      expect(meIdx).toBeLessThan(idIdx);
      expect(meIdx).toBeLessThan(homeIdx);
    } finally {
      cleanup();
    }
  });

  it('returns an empty manifest when the routes dir does not exist', () => {
    const { root, cleanup } = makeTmpPages({});
    try {
      const plugin = purity({ routes: { dir: 'pages' } });
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      const resolved = (plugin as { resolveId: (s: string) => string | null }).resolveId(
        'purity:routes',
      ) as string;
      const src = (plugin as { load: (id: string) => string | null }).load(resolved) as string;
      expect(src).toContain('export const routes = [');
      expect(src).toContain('];');
      // No entries between the brackets.
      expect(src.match(/pattern:/g)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('honors `routes: true` shorthand (defaults to pages/)', () => {
    const { root, cleanup } = makeTmpPages({ 'pages/index.ts': '// home' });
    try {
      const plugin = purity({ routes: true });
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      const resolved = (plugin as { resolveId: (s: string) => string | null }).resolveId(
        'purity:routes',
      ) as string;
      const src = (plugin as { load: (id: string) => string | null }).load(resolved) as string;
      expect(src).toContain('pattern: "/"');
    } finally {
      cleanup();
    }
  });

  it('does not register the virtual module when routes option is omitted', () => {
    const plugin = purity();
    const resolved = (plugin as { resolveId: (s: string) => string | null }).resolveId(
      'purity:routes',
    );
    expect(resolved).toBeNull();
  });

  it('honors a custom virtualId', () => {
    const { root, cleanup } = makeTmpPages({ 'pages/index.ts': '// home' });
    try {
      const plugin = purity({ routes: { dir: 'pages', virtualId: 'my:routes' } });
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      expect(
        (plugin as { resolveId: (s: string) => string | null }).resolveId('purity:routes'),
      ).toBeNull();
      expect((plugin as { resolveId: (s: string) => string | null }).resolveId('my:routes')).toBe(
        '\0my:routes',
      );
    } finally {
      cleanup();
    }
  });

  it('invalidates the manifest when a file under the routes dir changes', () => {
    const { root, cleanup } = makeTmpPages({ 'pages/index.ts': '// home' });
    try {
      const plugin = purity({ routes: { dir: 'pages' } });
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      const invalidated: string[] = [];
      const fakeMod = { id: '\0purity:routes' };
      const ctx = {
        file: join(root, 'pages/new.ts'),
        server: {
          moduleGraph: {
            getModuleById: (id: string) => (id === '\0purity:routes' ? fakeMod : null),
            invalidateModule: (m: { id: string }) => invalidated.push(m.id),
          },
        },
      };
      (plugin as { handleHotUpdate: (c: typeof ctx) => void }).handleHotUpdate(ctx);
      expect(invalidated).toEqual(['\0purity:routes']);
    } finally {
      cleanup();
    }
  });

  it('does not invalidate for files outside the routes dir', () => {
    const { root, cleanup } = makeTmpPages({ 'pages/index.ts': '// home' });
    try {
      const plugin = purity({ routes: { dir: 'pages' } });
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      const invalidated: string[] = [];
      const ctx = {
        file: join(root, 'src/main.ts'),
        server: {
          moduleGraph: {
            getModuleById: () => ({ id: '\0purity:routes' }),
            invalidateModule: (m: { id: string }) => invalidated.push(m.id),
          },
        },
      };
      (plugin as { handleHotUpdate: (c: typeof ctx) => void }).handleHotUpdate(ctx);
      expect(invalidated).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
