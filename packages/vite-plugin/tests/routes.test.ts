import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { purity } from '../src/index.ts';
import {
  attachLoaderInfo,
  buildRouteManifest,
  detectLoaderExport,
  errorDirOf,
  fileToRoute,
  generateRouteManifestSource,
  layoutChainFor,
  layoutDirOf,
  nearestErrorDir,
  notFoundFileOf,
  sortRoutes,
} from '../src/routes.ts';

// Tests for ADR 0019 — file-system routing manifest. Pure unit tests for
// the filename-to-pattern derivation + sorting + codegen, plus a couple of
// integration tests for the Vite plugin glue (resolveId / load) using
// real tmpdir directories.

const EXTS = ['.ts', '.tsx', '.js', '.jsx'];

describe('fileToRoute — filename → pattern grammar', () => {
  it('maps index.ts at the root to /', () => {
    expect(fileToRoute('index.ts', EXTS)).toEqual({
      pattern: '/',
      filePath: 'index.ts',
      layouts: [],
    });
  });

  it('maps about.ts to /about', () => {
    expect(fileToRoute('about.ts', EXTS)).toEqual({
      pattern: '/about',
      filePath: 'about.ts',
      layouts: [],
    });
  });

  it('maps users/index.ts to /users', () => {
    expect(fileToRoute('users/index.ts', EXTS)).toEqual({
      pattern: '/users',
      filePath: 'users/index.ts',
      layouts: [],
    });
  });

  it('maps users/[id].ts to /users/:id', () => {
    expect(fileToRoute('users/[id].ts', EXTS)).toEqual({
      pattern: '/users/:id',
      filePath: 'users/[id].ts',
      layouts: [],
    });
  });

  it('maps blog/[...slug].ts to /blog/* (splat)', () => {
    expect(fileToRoute('blog/[...slug].ts', EXTS)).toEqual({
      pattern: '/blog/*',
      filePath: 'blog/[...slug].ts',
      layouts: [],
    });
  });

  it('handles multiple dynamic segments', () => {
    expect(fileToRoute('orgs/[org]/users/[id].ts', EXTS)).toEqual({
      pattern: '/orgs/:org/users/:id',
      filePath: 'orgs/[org]/users/[id].ts',
      layouts: [],
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
      { pattern: '/users/:id', filePath: 'users/[id].ts', layouts: [] },
      { pattern: '/users/me', filePath: 'users/me.ts', layouts: [] },
    ]);
    expect(sorted.map((e) => e.pattern)).toEqual(['/users/me', '/users/:id']);
  });

  it('sorts deeper literal routes before shorter ones', () => {
    const sorted = sortRoutes([
      { pattern: '/about', filePath: 'about.ts', layouts: [] },
      { pattern: '/about/team', filePath: 'about/team.ts', layouts: [] },
    ]);
    expect(sorted.map((e) => e.pattern)).toEqual(['/about/team', '/about']);
  });

  it('places splat routes last', () => {
    const sorted = sortRoutes([
      { pattern: '/blog/*', filePath: 'blog/[...slug].ts', layouts: [] },
      { pattern: '/blog/:year', filePath: 'blog/[year].ts', layouts: [] },
      { pattern: '/blog/index', filePath: 'blog/index/page.ts', layouts: [] },
    ]);
    expect(sorted[sorted.length - 1].pattern).toBe('/blog/*');
  });

  it('is stable — alphabetical on the final tiebreaker', () => {
    const sorted = sortRoutes([
      { pattern: '/zebra', filePath: 'zebra.ts', layouts: [] },
      { pattern: '/alpha', filePath: 'alpha.ts', layouts: [] },
      { pattern: '/middle', filePath: 'middle.ts', layouts: [] },
    ]);
    expect(sorted.map((e) => e.pattern)).toEqual(['/alpha', '/middle', '/zebra']);
  });
});

describe('layoutDirOf — recognising _layout files', () => {
  it('detects a root _layout.ts (empty directory key)', () => {
    expect(layoutDirOf('_layout.ts', EXTS)).toBe('');
  });

  it('detects nested _layout files', () => {
    expect(layoutDirOf('users/_layout.ts', EXTS)).toBe('users');
    expect(layoutDirOf('admin/users/_layout.tsx', EXTS)).toBe('admin/users');
  });

  it('returns null for non-layout files', () => {
    expect(layoutDirOf('index.ts', EXTS)).toBeNull();
    expect(layoutDirOf('users/index.ts', EXTS)).toBeNull();
    expect(layoutDirOf('_layouts.ts', EXTS)).toBeNull();
    expect(layoutDirOf('users/_layout-helper.ts', EXTS)).toBeNull();
  });

  it('honors the configured extension list', () => {
    expect(layoutDirOf('_layout.svelte', EXTS)).toBeNull();
    expect(layoutDirOf('_layout.svelte', ['.svelte'])).toBe('');
  });
});

describe('layoutChainFor — root → leaf inheritance', () => {
  it('returns just the root layout for a route at the routes-dir root', () => {
    expect(layoutChainFor('', new Set(['']))).toEqual(['']);
  });

  it('returns the empty chain when no layouts exist', () => {
    expect(layoutChainFor('users', new Set())).toEqual([]);
  });

  it('walks up the directory chain root → leaf', () => {
    const chain = layoutChainFor('admin/users', new Set(['', 'admin', 'admin/users']));
    expect(chain).toEqual(['', 'admin', 'admin/users']);
  });

  it('skips intermediate directories without their own layout', () => {
    const chain = layoutChainFor('admin/users/edit', new Set(['', 'admin/users']));
    expect(chain).toEqual(['', 'admin/users']);
  });

  it('omits the root layout when there is no root _layout', () => {
    const chain = layoutChainFor('users/edit', new Set(['users']));
    expect(chain).toEqual(['users']);
  });
});

describe('errorDirOf — recognising _error files (ADR 0021)', () => {
  it('detects a root _error.ts (empty directory key)', () => {
    expect(errorDirOf('_error.ts', EXTS)).toBe('');
  });

  it('detects nested _error files', () => {
    expect(errorDirOf('admin/_error.tsx', EXTS)).toBe('admin');
    expect(errorDirOf('admin/users/_error.ts', EXTS)).toBe('admin/users');
  });

  it('returns null for non-error files', () => {
    expect(errorDirOf('index.ts', EXTS)).toBeNull();
    expect(errorDirOf('_layout.ts', EXTS)).toBeNull();
    expect(errorDirOf('_errors.ts', EXTS)).toBeNull();
    expect(errorDirOf('users/_error-handler.ts', EXTS)).toBeNull();
  });
});

describe('notFoundFileOf — recognising root _404 (ADR 0021)', () => {
  it('detects a root _404 with any allowed extension', () => {
    expect(notFoundFileOf('_404.ts', EXTS)).toBe('_404.ts');
    expect(notFoundFileOf('_404.tsx', EXTS)).toBe('_404.tsx');
  });

  it('returns null for nested _404 files (Phase 1: root-only)', () => {
    expect(notFoundFileOf('admin/_404.ts', EXTS)).toBeNull();
    expect(notFoundFileOf('users/[id]/_404.ts', EXTS)).toBeNull();
  });

  it('returns null for non-404 files', () => {
    expect(notFoundFileOf('_404.md', EXTS)).toBeNull();
    expect(notFoundFileOf('_500.ts', EXTS)).toBeNull();
    expect(notFoundFileOf('_404abc.ts', EXTS)).toBeNull();
  });
});

describe('nearestErrorDir — deepest-wins boundary resolution', () => {
  it('returns the route dir itself when it has its own _error', () => {
    expect(nearestErrorDir('admin/users', new Set(['admin/users']))).toBe('admin/users');
  });

  it('walks up one level when the route has no own _error', () => {
    expect(nearestErrorDir('admin/users/edit', new Set(['admin']))).toBe('admin');
  });

  it('falls back to the root _error', () => {
    expect(nearestErrorDir('admin/users', new Set(['']))).toBe('');
  });

  it('returns null when no _error is in the chain', () => {
    expect(nearestErrorDir('admin/users', new Set())).toBeNull();
    expect(nearestErrorDir('', new Set())).toBeNull();
  });

  it('prefers the deepest match in the chain', () => {
    expect(nearestErrorDir('admin/users/edit', new Set(['', 'admin', 'admin/users']))).toBe(
      'admin/users',
    );
  });

  it('handles a route at the routes-dir root', () => {
    expect(nearestErrorDir('', new Set(['']))).toBe('');
    expect(nearestErrorDir('', new Set(['admin']))).toBeNull();
  });
});

describe('detectLoaderExport — recognising named loader exports (ADR 0022)', () => {
  it('matches `export const loader = …`', () => {
    expect(detectLoaderExport('export const loader = async () => {}')).toBe(true);
  });

  it('matches `export let loader = …` and `export var loader = …`', () => {
    expect(detectLoaderExport('export let loader = () => 1')).toBe(true);
    expect(detectLoaderExport('export var loader = () => 1')).toBe(true);
  });

  it('matches `export function loader(...) { ... }`', () => {
    expect(detectLoaderExport('export function loader() { return {} }')).toBe(true);
  });

  it('matches `export async function loader(...)`', () => {
    expect(detectLoaderExport('export async function loader(ctx) { return {} }')).toBe(true);
  });

  it('matches a TypeScript-typed const export', () => {
    const src = 'export const loader: LoaderFn<{ id: string }> = async ({ params }) => params;';
    expect(detectLoaderExport(src)).toBe(true);
  });

  it('matches `export { loader }` (re-export, bare)', () => {
    expect(detectLoaderExport('export { loader };')).toBe(true);
  });

  it('matches `export { foo, loader, bar }` (re-export, mid-list)', () => {
    expect(detectLoaderExport('export { foo, loader, bar };')).toBe(true);
  });

  it('matches `export { foo as loader }` (re-export, renamed)', () => {
    expect(detectLoaderExport('export { foo as loader };')).toBe(true);
  });

  it('does not match identifiers that merely contain "loader"', () => {
    expect(detectLoaderExport('export const loaderFoo = () => 1')).toBe(false);
    expect(detectLoaderExport('export const fooLoader = () => 1')).toBe(false);
  });

  it('does not match other named exports', () => {
    expect(detectLoaderExport('export const action = () => 1')).toBe(false);
    expect(detectLoaderExport('export default function () {}')).toBe(false);
  });

  it('does not match commented-out lines (single-line)', () => {
    expect(detectLoaderExport('// export const loader = () => 1')).toBe(false);
    expect(detectLoaderExport('  // export const loader = () => 1')).toBe(false);
  });

  it('returns false for empty input or whitespace', () => {
    expect(detectLoaderExport('')).toBe(false);
    expect(detectLoaderExport('   \n   ')).toBe(false);
  });
});

describe('attachLoaderInfo — manifest enrichment (ADR 0022)', () => {
  it('sets hasLoader on routes whose source has a loader export', () => {
    const manifest = buildRouteManifest(['index.ts', 'about.ts'], EXTS);
    const sources: Record<string, string> = {
      'index.ts': 'export default function () {}\nexport const loader = async () => ({})',
      'about.ts': 'export default function () {}',
    };
    attachLoaderInfo(manifest, (rel) => sources[rel] ?? null);
    const byPattern = new Map(manifest.routes.map((e) => [e.pattern, e]));
    expect(byPattern.get('/')!.hasLoader).toBe(true);
    expect(byPattern.get('/about')!.hasLoader).toBeUndefined();
  });

  it('sets hasLoader on layouts whose source has a loader export', () => {
    const manifest = buildRouteManifest(['_layout.ts', 'users/_layout.ts', 'users/[id].ts'], EXTS);
    const sources: Record<string, string> = {
      '_layout.ts': 'export default (children) => children()',
      'users/_layout.ts':
        'export async function loader() { return [] }\nexport default (children) => children()',
      'users/[id].ts': 'export default (params) => params.id',
    };
    attachLoaderInfo(manifest, (rel) => sources[rel] ?? null);
    const userRoute = manifest.routes.find((e) => e.pattern === '/users/:id');
    expect(userRoute!.hasLoader).toBeUndefined();
    const rootLayout = userRoute!.layouts.find((l) => l.filePath === '_layout.ts');
    const usersLayout = userRoute!.layouts.find((l) => l.filePath === 'users/_layout.ts');
    expect(rootLayout!.hasLoader).toBeUndefined();
    expect(usersLayout!.hasLoader).toBe(true);
  });

  it('caches the source read so each layout is checked only once', () => {
    const manifest = buildRouteManifest(['_layout.ts', 'a.ts', 'b.ts', 'c.ts'], EXTS);
    let calls = 0;
    attachLoaderInfo(manifest, (rel) => {
      calls++;
      if (rel === '_layout.ts') return 'export const loader = async () => ({})';
      return 'export default () => null';
    });
    // 3 routes + 1 shared layout = 4 unique files. Without caching the
    // shared layout would be read 3 times (once per route's chain).
    expect(calls).toBe(4);
    for (const r of manifest.routes) {
      expect(r.layouts[0].hasLoader).toBe(true);
    }
  });

  it('treats null reads as no-loader (file unreadable)', () => {
    const manifest = buildRouteManifest(['index.ts'], EXTS);
    attachLoaderInfo(manifest, () => null);
    expect(manifest.routes[0].hasLoader).toBeUndefined();
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
    expect(manifest.routes.map((e) => e.pattern)).toEqual([
      '/users/me',
      '/about',
      '/users',
      '/users/:id',
      '/',
      '/blog/*',
    ]);
    // No _404 in the input → no `notFound` field on the manifest.
    expect(manifest.notFound).toBeUndefined();
  });

  it('reports + drops conflicts deterministically', () => {
    const conflicts: Array<[string, string, string]> = [];
    const manifest = buildRouteManifest(
      // Both files map to /users — alphabetic tiebreaker keeps `users.ts`.
      ['users.ts', 'users/index.ts'],
      EXTS,
      (pattern, kept, dropped) => conflicts.push([pattern, kept, dropped]),
    );
    expect(manifest.routes.map((e) => e.filePath)).toEqual(['users.ts']);
    expect(conflicts).toEqual([['/users', 'users.ts', 'users/index.ts']]);
  });

  it('returns an empty manifest for an empty file list', () => {
    expect(buildRouteManifest([], EXTS)).toEqual({ routes: [] });
  });

  it('assigns each route its inherited layout chain (root → leaf)', () => {
    const files = [
      '_layout.ts',
      'index.ts',
      'users/_layout.ts',
      'users/index.ts',
      'users/[id].ts',
      'settings/index.ts',
    ];
    const manifest = buildRouteManifest(files, EXTS);
    const byPattern = new Map(manifest.routes.map((e) => [e.pattern, e]));

    expect(byPattern.get('/')!.layouts).toEqual([{ filePath: '_layout.ts' }]);
    expect(byPattern.get('/users')!.layouts).toEqual([
      { filePath: '_layout.ts' },
      { filePath: 'users/_layout.ts' },
    ]);
    expect(byPattern.get('/users/:id')!.layouts).toEqual([
      { filePath: '_layout.ts' },
      { filePath: 'users/_layout.ts' },
    ]);
    // /settings has no settings/_layout.ts so it inherits only the root.
    expect(byPattern.get('/settings')!.layouts).toEqual([{ filePath: '_layout.ts' }]);
  });

  it('returns layouts: [] when no _layout files exist', () => {
    const manifest = buildRouteManifest(['index.ts', 'about.ts'], EXTS);
    for (const e of manifest.routes) expect(e.layouts).toEqual([]);
  });

  it('inherits a deep chain through layout-only directories', () => {
    // admin/ has no route module of its own, only a _layout.
    const files = ['_layout.ts', 'admin/_layout.ts', 'admin/users/index.ts'];
    const manifest = buildRouteManifest(files, EXTS);
    expect(manifest.routes).toHaveLength(1);
    expect(manifest.routes[0].pattern).toBe('/admin/users');
    expect(manifest.routes[0].layouts).toEqual([
      { filePath: '_layout.ts' },
      { filePath: 'admin/_layout.ts' },
    ]);
  });

  it('assigns each route the nearest _error in its chain (ADR 0021)', () => {
    const files = [
      '_error.ts',
      'index.ts',
      'about.ts',
      'admin/_error.ts',
      'admin/users.ts',
      'admin/settings/index.ts',
    ];
    const manifest = buildRouteManifest(files, EXTS);
    const byPattern = new Map(manifest.routes.map((e) => [e.pattern, e]));

    // Routes at the root use the root _error.
    expect(byPattern.get('/')!.errorBoundary).toEqual({ filePath: '_error.ts' });
    expect(byPattern.get('/about')!.errorBoundary).toEqual({ filePath: '_error.ts' });
    // Admin routes use the admin _error (deepest wins).
    expect(byPattern.get('/admin/users')!.errorBoundary).toEqual({
      filePath: 'admin/_error.ts',
    });
    expect(byPattern.get('/admin/settings')!.errorBoundary).toEqual({
      filePath: 'admin/_error.ts',
    });
  });

  it('omits errorBoundary on routes with no _error in the chain (ADR 0021)', () => {
    const manifest = buildRouteManifest(['index.ts', 'about.ts'], EXTS);
    for (const e of manifest.routes) {
      expect(e.errorBoundary).toBeUndefined();
    }
  });

  it('attaches a root _404 to the manifest top-level (ADR 0021)', () => {
    const manifest = buildRouteManifest(['index.ts', '_404.ts'], EXTS);
    expect(manifest.notFound).toEqual({ filePath: '_404.ts' });
  });

  it('ignores nested _404 files in Phase 1 (ADR 0021)', () => {
    const manifest = buildRouteManifest(['index.ts', 'admin/_404.ts', 'admin/users.ts'], EXTS);
    // No root _404 → no top-level notFound.
    expect(manifest.notFound).toBeUndefined();
    // Nested _404 is treated as a reserved file (dropped from routes).
    expect(manifest.routes.map((e) => e.pattern).sort()).toEqual(['/', '/admin/users']);
  });
});

describe('generateRouteManifestSource', () => {
  it('emits an array of entries with import functions', () => {
    const src = generateRouteManifestSource(
      {
        routes: [
          { pattern: '/', filePath: 'index.ts', layouts: [] },
          { pattern: '/users/:id', filePath: 'users/[id].ts', layouts: [] },
        ],
      },
      (rel) => `/abs/pages/${rel}`,
    );
    expect(src).toContain('pattern: "/"');
    expect(src).toContain('filePath: "index.ts"');
    expect(src).toContain('import("/abs/pages/index.ts")');
    expect(src).toContain('pattern: "/users/:id"');
    expect(src).toContain('import("/abs/pages/users/[id].ts")');
    // Empty layouts arrays are still emitted so consumers can rely on the field.
    expect(src).toContain('layouts: []');
    // No `notFound` in the manifest → no top-level export.
    expect(src).not.toContain('notFound');
  });

  it('escapes patterns with quotes via JSON.stringify', () => {
    const src = generateRouteManifestSource(
      { routes: [{ pattern: "/weird'path", filePath: "weird'path.ts", layouts: [] }] },
      (rel) => `/abs/${rel}`,
    );
    // Single quotes inside double-quoted JSON strings need no escaping —
    // the emitted source is still parseable JS.
    expect(src).toContain(`pattern: "/weird'path"`);
    expect(src).toContain(`filePath: "weird'path.ts"`);
  });

  it('emits the layout chain in the entry, root → leaf', () => {
    const src = generateRouteManifestSource(
      {
        routes: [
          {
            pattern: '/users/:id',
            filePath: 'users/[id].ts',
            layouts: [{ filePath: '_layout.ts' }, { filePath: 'users/_layout.ts' }],
          },
        ],
      },
      (rel) => `/abs/pages/${rel}`,
    );
    expect(src).toContain('layouts: [');
    expect(src).toContain('filePath: "_layout.ts"');
    expect(src).toContain('import("/abs/pages/_layout.ts")');
    expect(src).toContain('filePath: "users/_layout.ts"');
    expect(src).toContain('import("/abs/pages/users/_layout.ts")');
    // Order: root layout precedes nested layout in the source.
    expect(src.indexOf('"_layout.ts"')).toBeLessThan(src.indexOf('"users/_layout.ts"'));
  });

  it('emits an entry errorBoundary when set', () => {
    const src = generateRouteManifestSource(
      {
        routes: [
          {
            pattern: '/admin/users',
            filePath: 'admin/users.ts',
            layouts: [],
            errorBoundary: { filePath: 'admin/_error.ts' },
          },
        ],
      },
      (rel) => `/abs/pages/${rel}`,
    );
    expect(src).toContain('errorBoundary: {');
    expect(src).toContain('filePath: "admin/_error.ts"');
    expect(src).toContain('import("/abs/pages/admin/_error.ts")');
  });

  it('omits errorBoundary on entries that lack one', () => {
    const src = generateRouteManifestSource(
      { routes: [{ pattern: '/', filePath: 'index.ts', layouts: [] }] },
      (rel) => `/abs/pages/${rel}`,
    );
    expect(src).not.toContain('errorBoundary');
  });

  it('emits hasLoader: true on entries that have a loader (ADR 0022)', () => {
    const src = generateRouteManifestSource(
      {
        routes: [
          {
            pattern: '/users/:id',
            filePath: 'users/[id].ts',
            layouts: [{ filePath: 'users/_layout.ts', hasLoader: true }],
            hasLoader: true,
          },
        ],
      },
      (rel) => `/abs/pages/${rel}`,
    );
    // Route entry has the flag.
    const userLine = src.split('\n').find((l) => l.includes('"/users/:id"')) as string;
    expect(userLine).toContain('hasLoader: true');
    // Layout entry inside that route's layouts also has the flag.
    expect(userLine.match(/hasLoader: true/g)?.length).toBe(2);
  });

  it('omits hasLoader on entries that lack one', () => {
    const src = generateRouteManifestSource(
      { routes: [{ pattern: '/', filePath: 'index.ts', layouts: [] }] },
      (rel) => `/abs/pages/${rel}`,
    );
    expect(src).not.toContain('hasLoader');
  });

  it('emits a top-level notFound export when the manifest has one', () => {
    const src = generateRouteManifestSource(
      {
        routes: [{ pattern: '/', filePath: 'index.ts', layouts: [] }],
        notFound: { filePath: '_404.ts' },
      },
      (rel) => `/abs/pages/${rel}`,
    );
    expect(src).toContain('export const notFound = {');
    expect(src).toContain('filePath: "_404.ts"');
    expect(src).toContain('import("/abs/pages/_404.ts")');
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

  it('emits layout chains in the virtual manifest', () => {
    const { root, cleanup } = makeTmpPages({
      'pages/_layout.ts': '// root layout',
      'pages/index.ts': '// home',
      'pages/users/_layout.ts': '// users layout',
      'pages/users/[id].ts': '// user detail',
    });
    try {
      const plugin = purity({ routes: { dir: 'pages' } });
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      const resolved = (plugin as { resolveId: (s: string) => string | null }).resolveId(
        'purity:routes',
      ) as string;
      const src = (plugin as { load: (id: string) => string | null }).load(resolved) as string;

      // Both layout modules show up in the manifest as importable chunks.
      expect(src).toContain(`import("${root}/pages/_layout.ts")`);
      expect(src).toContain(`import("${root}/pages/users/_layout.ts")`);
      // The users/:id entry includes both layouts (root → leaf).
      const userLine = src.split('\n').find((l) => l.includes('"/users/:id"')) as string;
      expect(userLine).toContain('"_layout.ts"');
      expect(userLine).toContain('"users/_layout.ts"');
      expect(userLine.indexOf('"_layout.ts"')).toBeLessThan(userLine.indexOf('"users/_layout.ts"'));
    } finally {
      cleanup();
    }
  });

  it('emits errorBoundary + notFound in the virtual manifest (ADR 0021)', () => {
    const { root, cleanup } = makeTmpPages({
      'pages/_error.ts': '// root error',
      'pages/_404.ts': '// root not-found',
      'pages/index.ts': '// home',
      'pages/admin/_error.ts': '// admin error',
      'pages/admin/users.ts': '// admin users',
    });
    try {
      const plugin = purity({ routes: { dir: 'pages' } });
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      const resolved = (plugin as { resolveId: (s: string) => string | null }).resolveId(
        'purity:routes',
      ) as string;
      const src = (plugin as { load: (id: string) => string | null }).load(resolved) as string;

      // notFound shows up as a top-level export.
      expect(src).toContain('export const notFound = {');
      expect(src).toContain(`import("${root}/pages/_404.ts")`);

      // /admin/users uses the admin/_error boundary, not the root one.
      const adminLine = src.split('\n').find((l) => l.includes('"/admin/users"')) as string;
      expect(adminLine).toContain('errorBoundary:');
      expect(adminLine).toContain('"admin/_error.ts"');
      expect(adminLine).not.toContain('"_error.ts"'); // root error wouldn't appear in admin's line

      // / uses the root _error boundary.
      const homeLine = src.split('\n').find((l) => l.includes('"/"')) as string;
      expect(homeLine).toContain('errorBoundary:');
      expect(homeLine).toContain('"_error.ts"');
    } finally {
      cleanup();
    }
  });

  it('omits notFound from the virtual manifest when no root _404 exists', () => {
    const { root, cleanup } = makeTmpPages({
      'pages/index.ts': '// home',
      'pages/admin/_404.ts': '// nested 404 — Phase 1 ignores this',
      'pages/admin/users.ts': '// admin users',
    });
    try {
      const plugin = purity({ routes: { dir: 'pages' } });
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      const resolved = (plugin as { resolveId: (s: string) => string | null }).resolveId(
        'purity:routes',
      ) as string;
      const src = (plugin as { load: (id: string) => string | null }).load(resolved) as string;
      expect(src).not.toContain('notFound');
    } finally {
      cleanup();
    }
  });

  it('detects loader exports per ADR 0022 and emits hasLoader in the manifest', () => {
    const { root, cleanup } = makeTmpPages({
      'pages/_layout.ts': 'export default (children) => children()',
      'pages/index.ts':
        'export default () => null\nexport const loader = async () => ({ greeting: "hi" });',
      'pages/users/_layout.ts':
        'export async function loader() { return { session: 1 } }\nexport default (c) => c()',
      'pages/users/[id].ts': 'export default (p) => p.id',
    });
    try {
      const plugin = purity({ routes: { dir: 'pages' } });
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      const resolved = (plugin as { resolveId: (s: string) => string | null }).resolveId(
        'purity:routes',
      ) as string;
      const src = (plugin as { load: (id: string) => string | null }).load(resolved) as string;

      // Index has its own loader.
      const homeLine = src.split('\n').find((l) => l.includes('"/"')) as string;
      expect(homeLine).toContain('hasLoader: true');

      // /users/:id has no route-level loader BUT inherits a layout with one.
      const userLine = src.split('\n').find((l) => l.includes('"/users/:id"')) as string;
      // The route entry itself doesn't have a loader.
      const routeOnly = userLine.split('layouts:')[0];
      expect(routeOnly).not.toContain('hasLoader');
      // The users/_layout.ts layout entry inside the chain has hasLoader.
      expect(userLine).toContain('"users/_layout.ts"');
      expect(userLine).toContain('hasLoader: true');
      // The bare _layout.ts (no loader) does NOT have hasLoader.
      const rootLayoutChunk = userLine.match(/\{[^{}]*"_layout\.ts"[^{}]*\}/) as RegExpMatchArray;
      expect(rootLayoutChunk[0]).not.toContain('hasLoader');
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
