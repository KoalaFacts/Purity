// ---------------------------------------------------------------------------
// LoaderDataOf<P, R> — derive loader return-type from the manifest (ADR 0034).
//
// Pure-type helper that lifts a route's `loader` return type out of the
// emitted manifest (`emitTo` per ADR 0032 / ADR 0033). Pairs with
// `RouteParams<P>` (ADR 0031) as the second half of the "typed route
// surface" story:
//
//   • RouteParams<P>     — derives `params` shape from the pattern string.
//   • LoaderDataOf<P, R> — derives `loaderData()` return shape from the
//                          actual `loader` signature in the route module.
//
// Works with the on-disk `routes.ts` file emitted by the plugin. The
// emitted manifest has dynamic `() => import('/abs/path')` calls, which
// TypeScript infers as `Promise<typeof import('...')>` — that gives us
// the route module's exports, including the `loader` function's return
// type. The ambient `purity:routes` declaration uses `() => Promise<unknown>`
// and therefore resolves to `undefined` here — apps that want strong
// typing import from the emitted file directly:
//
//   import { routes } from './.purity/routes.ts';
//   type HomeData = LoaderDataOf<'/', typeof routes>;
//
// Type-only export. No runtime code; bundlers tree-shake to nothing.
// ---------------------------------------------------------------------------

/**
 * Derive the resolved loader-data shape for the route whose `pattern`
 * matches `P` in the routes array `R`.
 *
 * - When the route module exports `loader(): Promise<T>` (or `loader(): T`),
 *   resolves to `Awaited<T>`.
 * - When no loader is present, resolves to `undefined`.
 * - When `R` is typed as the generic `purity:routes` ambient (importFn:
 *   `() => Promise<unknown>`), resolves to `undefined` — apps wanting
 *   strong types should import from the emitted on-disk manifest.
 *
 * @example
 * ```ts
 * // src/pages/users/[id].ts
 * export async function loader(): Promise<{ name: string }> { … }
 * export default function User(params: RouteParams<'/users/:id'>) {
 *   const data = loaderData<LoaderDataOf<'/users/:id', typeof routes>>();
 *   data.name; // string — inferred from the loader's return type
 * }
 * ```
 */
export type LoaderDataOf<P extends string, R extends readonly unknown[]> =
  Extract<R[number], { pattern: P }> extends infer E
    ? E extends { importFn: () => Promise<infer M> }
      ? M extends { loader: (...args: never[]) => infer Ret }
        ? Awaited<Ret>
        : undefined
      : undefined
    : never;

/**
 * Derive the resolved loader-data shape for a single layout module
 * referenced by its `LayoutEntry`. Layout entries appear in
 * `route.layouts[]`, `route.errorBoundary`, and `notFoundChain[]` —
 * any of those can carry a typed `loader` export. Indexing into
 * the array gives an entry; pass that entry type here to get its
 * loader return type.
 *
 * @example
 * ```ts
 * import { routes } from './.purity/routes.ts';
 *
 * // Layout 0 (root) of route 0:
 * type RootLayoutData = LoaderDataOfEntry<typeof routes[0]['layouts'][0]>;
 * ```
 */
export type LoaderDataOfEntry<E> = E extends { importFn: () => Promise<infer M> }
  ? M extends { loader: (...args: never[]) => infer Ret }
    ? Awaited<Ret>
    : undefined
  : undefined;
