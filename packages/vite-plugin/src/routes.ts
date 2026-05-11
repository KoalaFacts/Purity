// ---------------------------------------------------------------------------
// File-system routing — manifest generation (ADR 0019).
//
// Pure helpers: filename → route pattern, route ordering, virtual-module
// source codegen. The Vite-side glue (resolveId / load / handleHotUpdate)
// lives in index.ts and calls into this module so the route-derivation
// logic is unit-testable without touching the filesystem.
// ---------------------------------------------------------------------------

/** A single entry in the generated route manifest. */
export interface RouteEntry {
  /** URL pattern in `matchRoute()` syntax (`:name`, `*` splat). */
  pattern: string;
  /** Path of the route module relative to the routes directory, with extension. */
  filePath: string;
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
  return { pattern, filePath };
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
 * Entries returned are sorted; pass straight into `generateRouteManifestSource`.
 *
 * Conflict policy: if two files map to the same pattern (e.g. `users.ts`
 * + `users/index.ts`), the first one alphabetically wins and the conflict
 * is reported via the `onConflict` callback (so the plugin can surface a
 * Vite warning). The loser is dropped from the manifest.
 */
export function buildRouteManifest(
  files: string[],
  extensions: string[] = ['.ts', '.tsx', '.js', '.jsx'],
  onConflict?: (pattern: string, kept: string, dropped: string) => void,
): RouteEntry[] {
  const byPattern = new Map<string, RouteEntry>();
  // Sort input by file path so the "first wins" tiebreaker is deterministic
  // across operating systems with different readdir ordering.
  const sortedFiles = files.slice().sort();
  for (const file of sortedFiles) {
    const entry = fileToRoute(file, extensions);
    if (!entry) continue;
    const existing = byPattern.get(entry.pattern);
    if (existing) {
      onConflict?.(entry.pattern, existing.filePath, entry.filePath);
      continue;
    }
    byPattern.set(entry.pattern, entry);
  }
  return sortRoutes(Array.from(byPattern.values()));
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
export function generateRouteManifestSource(
  entries: RouteEntry[],
  absPathFor: (filePath: string) => string,
): string {
  const lines: string[] = [
    '// AUTO-GENERATED by @purityjs/vite-plugin (ADR 0019). Do not edit.',
    'export const routes = [',
  ];
  for (const e of entries) {
    const abs = JSON.stringify(absPathFor(e.filePath));
    const pattern = JSON.stringify(e.pattern);
    const filePath = JSON.stringify(e.filePath);
    lines.push(`  { pattern: ${pattern}, filePath: ${filePath}, importFn: () => import(${abs}) },`);
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}
