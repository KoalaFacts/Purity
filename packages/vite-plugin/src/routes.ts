// ---------------------------------------------------------------------------
// File-system routing — manifest generation
// (ADR 0019 + ADR 0020 + ADR 0021).
//
// Pure helpers: filename → route pattern, route ordering, layout chain
// discovery, error-boundary + 404 discovery, virtual-module source
// codegen. The Vite-side glue (resolveId / load / handleHotUpdate)
// lives in index.ts and calls into this module so the route-derivation
// logic is unit-testable without touching the filesystem.
// ---------------------------------------------------------------------------

/** A layout / error-boundary / 404 module discovered for a directory. */
export interface LayoutEntry {
  /** Path of the module relative to the routes directory. */
  filePath: string;
}

/** A single entry in the generated route manifest. */
export interface RouteEntry {
  /** URL pattern in `matchRoute()` syntax (`:name`, `*` splat). */
  pattern: string;
  /** Path of the route module relative to the routes directory, with extension. */
  filePath: string;
  /**
   * Layout chain inherited by this route, ordered root → leaf
   * (ADR 0020). Empty when no `_layout.{ts,tsx,js,jsx}` exists in any
   * parent directory.
   */
  layouts: LayoutEntry[];
  /**
   * Nearest `_error.{ts,tsx,js,jsx}` in this route's directory chain
   * (ADR 0021). Single entry — the deepest `_error` wins, no chained
   * composition. Omitted when no `_error` exists in any parent.
   */
  errorBoundary?: LayoutEntry;
}

/** Output of `buildRouteManifest` — the routes plus an optional root `_404`. */
export interface RouteManifest {
  /** All route entries, sorted most-specific first. */
  routes: RouteEntry[];
  /**
   * Root-level `_404.{ts,tsx,js,jsx}` page (ADR 0021). Omitted when
   * no `_404` exists at the routes-dir root. Phase 1 supports root
   * only; nested 404s are deferred.
   */
  notFound?: LayoutEntry;
}

/**
 * Strip the file extension from a path, but only if it matches one of
 * `extensions`. Returns null when the file should be ignored (no matching
 * extension, or a reserved underscore-prefixed segment).
 */
function stripExtension(filePath: string, extensions: string[]): string | null {
  for (const ext of extensions) {
    if (filePath.endsWith(ext)) return filePath.slice(0, -ext.length);
  }
  return null;
}

/**
 * Convert a single relative file path under the routes dir into a route
 * entry. Returns `null` when the file shouldn't appear in the manifest:
 *
 * - Extension not in `extensions`.
 * - Any segment starts with `_` (reserved for `_layout`, `_404`, …).
 * - Splat segment (`[...rest]`) is not the last segment.
 *
 * Examples (with the default extension list):
 * - `index.ts`         → `{ pattern: '/',           filePath: 'index.ts' }`
 * - `about.ts`         → `{ pattern: '/about',      filePath: 'about.ts' }`
 * - `users/index.ts`   → `{ pattern: '/users',      filePath: 'users/index.ts' }`
 * - `users/[id].ts`    → `{ pattern: '/users/:id',  filePath: 'users/[id].ts' }`
 * - `blog/[...slug].ts`→ `{ pattern: '/blog/*',     filePath: 'blog/[...slug].ts' }`
 * - `_layout.ts`       → null (reserved)
 * - `notes.md`         → null (extension)
 */
export function fileToRoute(filePath: string, extensions: string[]): RouteEntry | null {
  const stripped = stripExtension(filePath, extensions);
  if (stripped === null) return null;

  // Use forward slashes regardless of host OS; Vite normalizes to POSIX
  // separators internally and so do we.
  const segments = stripped.split('/');

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.length === 0) return null;
    if (seg.startsWith('_')) return null;
  }

  const patternParts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    // `index` collapses to its parent directory. The leaf `index.ts` →
    // pattern `/`; nested `users/index.ts` → `/users`.
    if (seg === 'index' && i === segments.length - 1) continue;

    // Splat: `[...rest]` → `*`. Must be the final segment (`matchRoute`
    // grammar treats `*` as "remaining path").
    if (seg.startsWith('[...') && seg.endsWith(']')) {
      if (i !== segments.length - 1) return null;
      patternParts.push('*');
      continue;
    }

    // Dynamic: `[name]` → `:name`.
    if (seg.startsWith('[') && seg.endsWith(']')) {
      const name = seg.slice(1, -1);
      if (name.length === 0) return null;
      patternParts.push(`:${name}`);
      continue;
    }

    patternParts.push(seg);
  }

  const pattern = '/' + patternParts.join('/');
  return { pattern, filePath, layouts: [] };
}

/**
 * The basename used to recognise a layout module. Case-sensitive; one of
 * the configured `extensions` is appended when matching.
 */
const LAYOUT_BASENAME = '_layout';

/**
 * Return the directory portion of a route-relative path (POSIX). Empty
 * string for files at the routes-dir root.
 */
function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? '' : filePath.slice(0, idx);
}

/**
 * If `filePath` is a `_layout.<ext>` (with one of the configured
 * extensions), return its containing directory ('' for the routes-dir
 * root). Otherwise return null.
 */
export function layoutDirOf(filePath: string, extensions: string[]): string | null {
  for (const ext of extensions) {
    const target = LAYOUT_BASENAME + ext;
    if (filePath === target) return '';
    if (filePath.endsWith('/' + target)) return filePath.slice(0, -target.length - 1);
  }
  return null;
}

/**
 * Given the set of directories that contain a `_layout` and the
 * directory of a route, return the layout chain that the route
 * inherits — ordered root → leaf. Each chain entry is the directory
 * key (`''` for the routes-dir root).
 */
export function layoutChainFor(routeDir: string, layoutDirs: Set<string>): string[] {
  const chain: string[] = [];
  // The root layout always wraps everything below it.
  if (layoutDirs.has('')) chain.push('');
  if (routeDir === '') return chain;
  // Walk each prefix of the route's directory, root → leaf, including
  // the route's own directory.
  const parts = routeDir.split('/');
  let acc = '';
  for (let i = 0; i < parts.length; i++) {
    acc = acc === '' ? parts[i] : acc + '/' + parts[i];
    if (layoutDirs.has(acc)) chain.push(acc);
  }
  return chain;
}

/** Base name for an error-boundary module (ADR 0021). */
const ERROR_BASENAME = '_error';

/** Base name for a not-found page (ADR 0021). Root-level only in Phase 1. */
const NOT_FOUND_BASENAME = '_404';

/**
 * If `filePath` is an `_error.<ext>` (with one of the configured
 * extensions), return its containing directory ('' for the routes-dir
 * root). Otherwise return null. ADR 0021.
 */
export function errorDirOf(filePath: string, extensions: string[]): string | null {
  for (const ext of extensions) {
    const target = ERROR_BASENAME + ext;
    if (filePath === target) return '';
    if (filePath.endsWith('/' + target)) return filePath.slice(0, -target.length - 1);
  }
  return null;
}

/**
 * If `filePath` is a root-level `_404.<ext>`, return the path. Otherwise
 * return null. Nested `_404` files at this stage of the project are
 * silently ignored — Phase 1 supports root-only 404s (ADR 0021).
 */
export function notFoundFileOf(filePath: string, extensions: string[]): string | null {
  for (const ext of extensions) {
    if (filePath === NOT_FOUND_BASENAME + ext) return filePath;
  }
  return null;
}

/**
 * Walk the directory chain leaf → root and return the deepest
 * directory key found in `errorDirs`. Used to assign a route its
 * single nearest `_error.ts` (no chained composition in Phase 1).
 */
export function nearestErrorDir(routeDir: string, errorDirs: Set<string>): string | null {
  if (routeDir === '') return errorDirs.has('') ? '' : null;
  const parts = routeDir.split('/');
  for (let i = parts.length; i > 0; i--) {
    const candidate = parts.slice(0, i).join('/');
    if (errorDirs.has(candidate)) return candidate;
  }
  return errorDirs.has('') ? '' : null;
}

/**
 * Rank a pattern from most-specific to least-specific. Lower scores sort
 * first. Encoded as `[splatFlag, -literalCount, dynamicCount]` — splat
 * dominates everything (always last), then more literals win, then fewer
 * dynamics break ties.
 */
function rankPattern(pattern: string): [number, number, number] {
  if (pattern === '/') return [0, 0, 0];
  const segs = pattern.split('/').filter(Boolean);
  let literals = 0;
  let dynamics = 0;
  let splat = 0;
  for (const seg of segs) {
    if (seg === '*') splat = 1;
    else if (seg.startsWith(':')) dynamics++;
    else literals++;
  }
  return [splat, -literals, dynamics];
}

/** Sort routes most-specific first. Stable on the final tiebreaker (pattern). */
export function sortRoutes(entries: RouteEntry[]): RouteEntry[] {
  return entries.slice().sort((a, b) => {
    const ra = rankPattern(a.pattern);
    const rb = rankPattern(b.pattern);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] !== rb[i]) return ra[i] - rb[i];
    }
    if (a.pattern < b.pattern) return -1;
    if (a.pattern > b.pattern) return 1;
    return 0;
  });
}

/**
 * Build the route manifest from a list of route-relative file paths.
 * Entries returned are sorted most-specific first; pass straight into
 * `generateRouteManifestSource`.
 *
 * Conflict policy: if two files map to the same pattern (e.g. `users.ts`
 * + `users/index.ts`), the first one alphabetically wins and the conflict
 * is reported via the `onConflict` callback (so the plugin can surface a
 * Vite warning). The loser is dropped from the manifest.
 *
 * Layouts: any `_layout.{ts,tsx,js,jsx}` file in the input is collected
 * into a per-directory map; each route entry's `layouts` field is filled
 * with its inherited chain (root → leaf) per ADR 0020.
 *
 * Error boundaries (ADR 0021): any `_error.{ts,tsx,js,jsx}` file is
 * collected into a per-directory map; each route entry's `errorBoundary`
 * is set to the nearest `_error` in its directory chain (deepest wins,
 * single entry — no chained composition).
 *
 * 404 (ADR 0021): a root-level `_404.{ts,tsx,js,jsx}` becomes the
 * manifest's top-level `notFound` field. Nested `_404` files at this
 * stage are silently ignored.
 *
 * Layout / boundary / 404 files themselves are not route entries (they
 * were already excluded by the reserved-`_` rule in `fileToRoute`).
 */
export function buildRouteManifest(
  files: string[],
  extensions: string[] = ['.ts', '.tsx', '.js', '.jsx'],
  onConflict?: (pattern: string, kept: string, dropped: string) => void,
): RouteManifest {
  const byPattern = new Map<string, RouteEntry>();
  // Sort input by file path so the "first wins" tiebreaker is deterministic
  // across operating systems with different readdir ordering.
  const sortedFiles = files.slice().sort();

  // Discover layout / error-boundary modules first so the route assignment
  // loop can resolve each route's chain in one pass.
  const layoutByDir = new Map<string, string>();
  const errorByDir = new Map<string, string>();
  let notFoundFile: string | null = null;
  for (const file of sortedFiles) {
    const ld = layoutDirOf(file, extensions);
    if (ld !== null) layoutByDir.set(ld, file);
    const ed = errorDirOf(file, extensions);
    if (ed !== null) errorByDir.set(ed, file);
    const nf = notFoundFileOf(file, extensions);
    if (nf !== null) notFoundFile = nf;
  }
  const layoutDirs = new Set(layoutByDir.keys());
  const errorDirs = new Set(errorByDir.keys());

  for (const file of sortedFiles) {
    const entry = fileToRoute(file, extensions);
    if (!entry) continue;
    const existing = byPattern.get(entry.pattern);
    if (existing) {
      onConflict?.(entry.pattern, existing.filePath, entry.filePath);
      continue;
    }
    const dir = dirname(entry.filePath);
    const chain = layoutChainFor(dir, layoutDirs);
    entry.layouts = chain.map((d) => ({ filePath: layoutByDir.get(d) as string }));
    const errDir = nearestErrorDir(dir, errorDirs);
    if (errDir !== null) {
      entry.errorBoundary = { filePath: errorByDir.get(errDir) as string };
    }
    byPattern.set(entry.pattern, entry);
  }
  const manifest: RouteManifest = { routes: sortRoutes(Array.from(byPattern.values())) };
  if (notFoundFile !== null) manifest.notFound = { filePath: notFoundFile };
  return manifest;
}

/**
 * Codegen for the virtual `purity:routes` module. Emits an array of
 * `RouteEntry` literals; each entry's `importFn` is a static
 * `() => import('<absPath>')` so Vite / Rollup code-split per route.
 *
 * `absPathFor(filePath)` lets the caller decide how to turn a route-
 * relative file path into the import specifier (typically an absolute
 * path resolved against the routes dir). Kept as a callback so the
 * codegen stays decoupled from `node:path`.
 */
/**
 * Emit a single `LayoutEntry`-shaped object literal (filePath +
 * importFn). Shared between layouts and error boundaries — the shapes
 * are structurally identical (ADR 0021).
 */
function entryLiteral(e: LayoutEntry, absPathFor: (filePath: string) => string): string {
  const fp = JSON.stringify(e.filePath);
  const abs = JSON.stringify(absPathFor(e.filePath));
  return `{ filePath: ${fp}, importFn: () => import(${abs}) }`;
}

export function generateRouteManifestSource(
  manifest: RouteManifest,
  absPathFor: (filePath: string) => string,
): string {
  const lines: string[] = [
    '// AUTO-GENERATED by @purityjs/vite-plugin (ADR 0019 + 0020 + 0021). Do not edit.',
    'export const routes = [',
  ];
  for (const e of manifest.routes) {
    const abs = JSON.stringify(absPathFor(e.filePath));
    const pattern = JSON.stringify(e.pattern);
    const filePath = JSON.stringify(e.filePath);
    const layouts = e.layouts.map((l) => entryLiteral(l, absPathFor)).join(', ');
    const errorPart = e.errorBoundary
      ? `, errorBoundary: ${entryLiteral(e.errorBoundary, absPathFor)}`
      : '';
    lines.push(
      `  { pattern: ${pattern}, filePath: ${filePath}, importFn: () => import(${abs}), layouts: [${layouts}]${errorPart} },`,
    );
  }
  lines.push('];');
  if (manifest.notFound) {
    lines.push(`export const notFound = ${entryLiteral(manifest.notFound, absPathFor)};`);
  }
  lines.push('');
  return lines.join('\n');
}
