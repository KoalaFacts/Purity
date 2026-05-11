// Ambient declaration for the virtual `purity:routes` module emitted by
// @purityjs/vite-plugin (ADRs 0019-0022). Re-exports the types from the
// plugin so consumers can iterate the manifest with full type info.

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
  export type { LayoutEntry, RouteEntry };
}
