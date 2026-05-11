// Ambient declaration for the virtual `purity:routes` module emitted by
// @purityjs/vite-plugin (ADRs 0019-0022, 0028). Re-exports the types from
// the plugin so consumers can iterate the manifest with full type info.

declare module 'purity:routes' {
  import type { LayoutEntry, RouteEntry } from '@purityjs/vite-plugin';

  export const routes: ReadonlyArray<
    RouteEntry & {
      importFn: () => Promise<unknown>;
      layouts: ReadonlyArray<LayoutEntry & { importFn: () => Promise<unknown> }>;
      errorBoundary?: LayoutEntry & { importFn: () => Promise<unknown> };
    }
  >;
  export const notFound: (LayoutEntry & { importFn: () => Promise<unknown> }) | undefined;
  // ADR 0028 — every `_404.{ts,tsx,js,jsx}` in the routes tree, sorted
  // deepest-first by directory depth. Each entry's `dir` is the routes-
  // relative directory (`''` for the root).
  export const notFoundChain: ReadonlyArray<
    LayoutEntry & { importFn: () => Promise<unknown>; dir: string }
  >;
  export type { LayoutEntry, RouteEntry };
}
