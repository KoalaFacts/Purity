# 0034: `LoaderDataOf<P, R>` — typed loader data from the manifest

**Status:** Accepted
**Date:** 2026-05-11

## Context

ADR [0022](./0022-data-loaders.md) ships the `loader` named export
convention — each route or layout module can export `loader(ctx):
Promise<T> | T`, and the manifest flags it with `hasLoader: true`.
ADR [0026](./0026-loader-data-accessor.md) shipped `loaderData<T>()`,
the per-component accessor — but `T` is a generic the user supplies
by hand:

```ts
const data = loaderData<{ todos: string[] }>();
```

That duplicates the loader's return type at every call site. If the
loader's shape changes, every reader has to update its annotation by
hand. ADR 0026 documented this as a deferred non-feature: "inferred
from the route's loader signature."

ADR [0031](./0031-typed-route-params.md) shipped `RouteParams<P>` —
the parallel piece for params, derived purely from the pattern string
via template-literal types. The remaining piece is loader-data
inference. Pattern strings can't tell us the loader's return type;
the source file's signature is the only ground truth.

The on-disk manifest emit from ADR [0032](./0032-on-disk-manifest-emit.md)

- ADR [0033](./0033-eager-manifest-emit.md) creates an opening here.
  The emitted `routes.ts` has dynamic imports with literal absolute
  paths:

```ts
importFn: () => import('/abs/path/to/pages/index.ts');
```

TypeScript infers `() => import('…')` as `() => Promise<typeof
import('…')>`. That means each route entry's `importFn` carries the
full module's types in its inferred return — including the `loader`
function's signature. We can lift the loader's return type out with
conditional/inference types alone, no runtime code and no plugin
codegen change.

## Decision

**Add `LoaderDataOf<P, R>` and `LoaderDataOfEntry<E>` as type-only
exports from `@purityjs/vite-plugin`.** Both are pure-type machinery,
no runtime cost, tree-shake to nothing.

```ts
export type LoaderDataOf<P extends string, R extends readonly unknown[]> =
  Extract<R[number], { pattern: P }> extends infer E
    ? E extends { importFn: () => Promise<infer M> }
      ? M extends { loader: (...args: never[]) => infer Ret }
        ? Awaited<Ret>
        : undefined
      : undefined
    : never;

export type LoaderDataOfEntry<E> = E extends { importFn: () => Promise<infer M> }
  ? M extends { loader: (...args: never[]) => infer Ret }
    ? Awaited<Ret>
    : undefined
  : undefined;
```

Usage:

```ts
// src/pages/index.ts
export async function loader(): Promise<{ todos: string[] }> {
  return { todos: ['a', 'b'] };
}
export default function HomePage(params: RouteParams<'/'>): unknown {
  // Type of `data` is `{ todos: string[] }` — inferred from the
  // loader signature in this file, not hand-written.
  const data = loaderData<LoaderDataOf<'/', typeof routes>>();
  return html`<ul>
    ${each(
      () => data?.todos ?? [],
      (t) => html`<li>${t}</li>`,
    )}
  </ul>`;
}
```

Where `routes` is imported from the **emitted on-disk manifest**
(`./.purity/routes.ts`, ADR 0033) — that's the typing source. The
ambient `purity:routes` declaration types `importFn` as `() =>
Promise<unknown>`, which generalises away the per-route module
information and resolves `LoaderDataOf<…>` to `undefined`. Apps that
want strong types should:

1. Set `purity({ routes: { dir, emitTo: 'src/.purity/routes.ts' } })`
   (ADR 0032 + 0033 already document this).
2. Import from the emitted file: `import { routes } from
'./.purity/routes.ts'` instead of `from 'purity:routes'`.

The runtime behaviour is identical — the emitted file's content IS
the virtual module's content (per ADR 0032). The choice is purely a
typing one.

### Layout / 404 / error-boundary entries

`LoaderDataOfEntry<E>` is the entry-shaped version for cases where
keying by pattern doesn't apply. Layout chains, error boundaries, and
`notFoundChain` entries are `LayoutEntry`-shaped (no `pattern` field),
so users index into them and pass the entry's type:

```ts
type RootLayoutData = LoaderDataOfEntry<(typeof routes)[0]['layouts'][0]>;
```

### Explicit non-features

- **No plugin codegen change.** Both helpers are pure-type. No new
  generated declarations, no `.d.ts` companion file, no TypeScript-
  parser dep. The plugin keeps its zero-runtime-dep posture; the
  helpers ship in the existing type-export surface.
- **No magic "infer loader at call site".** TypeScript can't infer
  `loaderData()`'s return based on the component's enclosing route —
  there's no syntactic link between the call and the route module.
  Users still write `loaderData<LoaderDataOf<P, R>>()` once per
  component; the helper makes the inferred type appear at that single
  call site rather than duplicating the shape.
- **No automatic re-export from `@purityjs/core`.** The helpers stay
  in `@purityjs/vite-plugin` (alongside `RouteParams`, `RouteEntry`,
  `LayoutEntry`) because they're plugin-shape concerns — the
  pattern-extraction + manifest typing is plugin-side knowledge.
  Apps that want the helpers import from `@purityjs/vite-plugin`.
- **No runtime validation that `loaderData()` matches the type.** The
  runtime accessor returns whatever was pushed onto the stack by
  `asyncRoute`'s composer. If the route's actual loader return shape
  diverges from the type, TS reports the mismatch at compile time;
  no runtime check needed.
- **No support for the ambient declaration.** Apps reading
  `from 'purity:routes'` (the virtual module) see a generalised
  `() => Promise<unknown>` and get `undefined` back from the helper.
  This is intentional — strong typing requires the on-disk emit
  path. The ambient declaration could be tightened later via a
  `purity-routes.d.ts` regen step, but that's a separate ADR.

## Consequences

**Positive:**

- Closes the typed-loader-data half of ADR 0022's deferred work.
  Pairs cleanly with `RouteParams<P>` (ADR 0031) — patterns get
  param typing, loaders get return-shape typing, both derived
  without manual annotation.
- Zero runtime cost. Type-only export, tree-shaken to nothing in
  every consumer.
- Encourages the `emitTo` workflow that the streaming-SSR adapter
  examples already use (ADR 0033) — apps that switch from
  `'purity:routes'` to `'./.purity/routes.ts'` get strong types
  for free.
- IDE jump-to-definition on `loaderData()` now lands somewhere
  meaningful: the route module's exported `loader` function. Apps
  using the ambient declaration land on `unknown`.

**Negative:**

- Pinning typing to the emitted file's exact path means apps that
  customise `emitTo` (e.g. `apps/dashboard/src/.purity/routes.ts`)
  also customise the import path. The plugin doesn't currently
  rewrite imports — the import path is whatever the user writes.
  Documented; the canonical example shows the conventional path.
- Apps still on the ambient declaration get `undefined` from the
  helper. Surfaces as a TS error at the `loaderData<…>()` call when
  the user actually tries to use a property. Documented.

**Neutral:**

- One new type-only file (`packages/vite-plugin/src/loader-data-of.ts`)
  and one new test file. Existing types unchanged.
- The canonical SSR example (`examples/ssr/`) demonstrates the
  helper on the home route's `loader`.

## Alternatives considered

**Inject a generated `RouteFor<'/'>` type per pattern.** The plugin
could emit per-route type aliases alongside the manifest:

```ts
// In src/.purity/routes.ts:
export type RouteFor_$1 = typeof import('/abs/path/.../index.ts');
export type LoaderFor_$1 = LoaderDataOfEntry<(typeof routes)[0]>;
```

Cleaner ergonomics (`LoaderFor<'/'>`) but duplicates the helper at
the codegen level for marginal user-side simplification. Rejected:
the inline `LoaderDataOf<P, R>` machinery is small enough that one
import is fine, and avoiding plugin codegen for type-only work keeps
the manifest output predictable.

**Synthetic ambient declaration tightening.** The plugin could
auto-emit a `purity-routes.d.ts` whose `importFn` is typed per route
(via `() => Promise<typeof import('/abs/path')>` literals). Would
make the typed accessors work from the virtual module too. Rejected
for this iteration: depends on `emitTo` being on anyway (paths come
from the same place); explicit on-disk import is the simpler story.
Future ADR if there's demand.

**Use the TS Language Service to infer loader types.** Heavier dep,
fragile across TS versions. Rejected — the conditional/inference
type approach is pure standard TS with no runtime or build-time
cost.

**Embed loader-return-shape JSON in the manifest.** Generate a
`loaderReturn?: TypeName` field per route. Doesn't compose with TS
types; would need its own resolver. Rejected — the imported module
type is the source of truth.
