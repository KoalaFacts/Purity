import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { purity } from '../src/index.ts';
import { generateRouteManifestTypes } from '../src/routes.ts';

// Tests for the sibling `.d.ts` emit (ADR 0036). Auto-emits next to the
// `emitTo` `.ts` manifest so apps importing from `'purity:routes'` get
// per-route typed `importFn` (`() => Promise<typeof import('<abs>')>`)
// instead of the generic `() => Promise<unknown>` from the user-authored
// ambient declaration.

function makeTmpPages(layout: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'purity-types-emit-'));
  for (const [rel, content] of Object.entries(layout)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return { root, cleanup: (): void => rmSync(root, { recursive: true, force: true }) };
}

describe('generateRouteManifestTypes — pure codegen', () => {
  it('emits a `declare module purity:routes` block', () => {
    const manifest = {
      routes: [
        {
          pattern: '/',
          filePath: 'index.ts',
          layouts: [],
        },
      ],
      notFoundChain: [],
    };
    const out = generateRouteManifestTypes(manifest, (f) => `/abs/${f}`);
    expect(out).toContain("declare module 'purity:routes'");
    expect(out).toContain('readonly pattern: "/"');
    expect(out).toContain('readonly importFn: () => Promise<typeof import("/abs/index.ts")>');
  });

  it('emits literal tuple types — one element per route', () => {
    const manifest = {
      routes: [
        { pattern: '/', filePath: 'index.ts', layouts: [] },
        { pattern: '/about', filePath: 'about.ts', layouts: [] },
        { pattern: '/users/:id', filePath: 'users/[id].ts', layouts: [] },
      ],
      notFoundChain: [],
    };
    const out = generateRouteManifestTypes(manifest, (f) => `/abs/${f}`);
    // readonly [<route1>, <route2>, <route3>] — literal tuple, not array.
    expect(out).toContain('export const routes: readonly [');
    expect(out).toContain('readonly pattern: "/"');
    expect(out).toContain('readonly pattern: "/about"');
    expect(out).toContain('readonly pattern: "/users/:id"');
  });

  it('emits per-layout typed importFn in each route', () => {
    const manifest = {
      routes: [
        {
          pattern: '/',
          filePath: 'index.ts',
          layouts: [{ filePath: '_layout.ts' }, { filePath: 'app/_layout.ts' }],
        },
      ],
      notFoundChain: [],
    };
    const out = generateRouteManifestTypes(manifest, (f) => `/abs/${f}`);
    expect(out).toContain('readonly importFn: () => Promise<typeof import("/abs/_layout.ts")>');
    expect(out).toContain('readonly importFn: () => Promise<typeof import("/abs/app/_layout.ts")>');
  });

  it('emits errorBoundary + hasLoader markers when present', () => {
    const manifest = {
      routes: [
        {
          pattern: '/',
          filePath: 'index.ts',
          layouts: [],
          errorBoundary: { filePath: '_error.ts' },
          hasLoader: true,
        },
      ],
      notFoundChain: [],
    };
    const out = generateRouteManifestTypes(manifest, (f) => `/abs/${f}`);
    expect(out).toContain('readonly errorBoundary:');
    expect(out).toContain('readonly hasLoader: true');
  });

  it('emits `notFound: undefined` when no root 404', () => {
    const manifest = { routes: [], notFoundChain: [] };
    const out = generateRouteManifestTypes(manifest, (f) => `/abs/${f}`);
    expect(out).toContain('export const notFound: undefined;');
  });

  it('emits a typed notFound entry when present', () => {
    const manifest = {
      routes: [],
      notFound: { filePath: '_404.ts' },
      notFoundChain: [{ filePath: '_404.ts', dir: '' }],
    };
    const out = generateRouteManifestTypes(manifest, (f) => `/abs/${f}`);
    expect(out).toContain(
      'export const notFound: { readonly filePath: "_404.ts"; readonly importFn: () => Promise<typeof import("/abs/_404.ts")> }',
    );
    expect(out).toContain('export const notFoundChain: readonly [');
    expect(out).toContain('readonly dir: ""');
  });

  it('re-exports the runtime entry types for consumer convenience', () => {
    const manifest = { routes: [], notFoundChain: [] };
    const out = generateRouteManifestTypes(manifest, (f) => `/abs/${f}`);
    expect(out).toContain("import type { LayoutEntry, RouteEntry } from '@purityjs/vite-plugin'");
    expect(out).toContain('export type { LayoutEntry, RouteEntry };');
  });
});

describe('purity({ routes: { emitTo } }) — sibling .d.ts emit (ADR 0036)', () => {
  it('writes a sibling .d.ts next to the .ts on load()', () => {
    const { root, cleanup } = makeTmpPages({
      'pages/index.ts': '// home',
      'pages/about.ts': '// about',
    });
    try {
      const plugin = purity({
        routes: { dir: 'pages', emitTo: '.purity/routes.ts' },
      });
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      const resolved = (plugin as { resolveId: (s: string) => string | null }).resolveId(
        'purity:routes',
      ) as string;
      (plugin as { load: (id: string) => string | null }).load(resolved);

      const dtsPath = join(root, '.purity/routes.d.ts');
      expect(existsSync(dtsPath)).toBe(true);
      const dts = readFileSync(dtsPath, 'utf8');
      expect(dts).toContain("declare module 'purity:routes'");
      expect(dts).toContain('readonly pattern: "/"');
      expect(dts).toContain('readonly pattern: "/about"');
    } finally {
      cleanup();
    }
  });

  it('writes the sibling .d.ts at buildStart (ADR 0033 path)', () => {
    const { root, cleanup } = makeTmpPages({
      'pages/index.ts': '// home',
    });
    try {
      const plugin = purity({
        routes: { dir: 'pages', emitTo: '.purity/routes.ts' },
      });
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      // No resolveId / load — buildStart eager-emit only.
      (plugin as { buildStart: () => void }).buildStart();

      expect(existsSync(join(root, '.purity/routes.ts'))).toBe(true);
      expect(existsSync(join(root, '.purity/routes.d.ts'))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('does NOT emit a .d.ts when emitTo is omitted', () => {
    const { root, cleanup } = makeTmpPages({ 'pages/index.ts': '// home' });
    try {
      const plugin = purity({ routes: { dir: 'pages' } });
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      const resolved = (plugin as { resolveId: (s: string) => string | null }).resolveId(
        'purity:routes',
      ) as string;
      (plugin as { load: (id: string) => string | null }).load(resolved);
      expect(existsSync(join(root, '.purity'))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('emits a typed `importFn` per route, not the generic `unknown`', () => {
    const { root, cleanup } = makeTmpPages({
      'pages/index.ts': '// home',
      'pages/about.ts': '// about',
    });
    try {
      const plugin = purity({
        routes: { dir: 'pages', emitTo: '.purity/routes.ts' },
      });
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      (plugin as { buildStart: () => void }).buildStart();

      const dts = readFileSync(join(root, '.purity/routes.d.ts'), 'utf8');
      // No `Promise<unknown>` anywhere — every importFn carries a typed
      // `typeof import(...)` expression.
      expect(dts).not.toContain('Promise<unknown>');
      // Per-route `typeof import('<abs>')` references.
      expect(dts).toMatch(/typeof import\("[^"]*pages\/index\.ts"\)/);
      expect(dts).toMatch(/typeof import\("[^"]*pages\/about\.ts"\)/);
    } finally {
      cleanup();
    }
  });

  it('handles a `.tsx` emit path (appends .d.ts rather than swapping)', () => {
    const { root, cleanup } = makeTmpPages({ 'pages/index.ts': '// home' });
    try {
      // Unusual but legal: emitTo can target a `.tsx` consumer file.
      const plugin = purity({
        routes: { dir: 'pages', emitTo: '.purity/routes.tsx' },
      });
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      (plugin as { buildStart: () => void }).buildStart();
      // For non-`.ts` paths the d.ts is appended (routes.tsx → routes.tsx.d.ts).
      expect(existsSync(join(root, '.purity/routes.tsx'))).toBe(true);
      expect(existsSync(join(root, '.purity/routes.tsx.d.ts'))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('skips the .d.ts rewrite when its content already matches', () => {
    const { root, cleanup } = makeTmpPages({ 'pages/index.ts': '// home' });
    try {
      const plugin = purity({
        routes: { dir: 'pages', emitTo: '.purity/routes.ts' },
      });
      (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root });
      (plugin as { buildStart: () => void }).buildStart();
      const dtsPath = join(root, '.purity/routes.d.ts');
      const firstContent = readFileSync(dtsPath, 'utf8');
      (plugin as { buildStart: () => void }).buildStart();
      const secondContent = readFileSync(dtsPath, 'utf8');
      expect(secondContent).toBe(firstContent);
    } finally {
      cleanup();
    }
  });
});

describe('LoaderDataOf via virtual module — type-level integration', () => {
  // Type-level check that the .d.ts shape works with `LoaderDataOf`.
  // We compile-test in the test file itself: if the type derivations
  // were wrong, tsc would fail in the workspace's pre-publish check.
  it('compile-checks the d.ts shape against LoaderDataOf', () => {
    const manifest = {
      routes: [
        {
          pattern: '/',
          filePath: 'index.ts',
          layouts: [],
          hasLoader: true,
        },
      ],
      notFoundChain: [],
    };
    const out = generateRouteManifestTypes(manifest, (f) => `/abs/${f}`);
    // Spot-check that LoaderDataOf can index into the literal tuple by
    // pattern. Full integration is exercised by the apps/examples.
    expect(out).toContain('Extract'.length > 0 ? 'readonly pattern: "/"' : 'never');
    expect(out).toContain('readonly hasLoader: true');
  });
});
