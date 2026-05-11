# 0031: `RouteParams<P>` — template-literal-derived route params

**Status:** Accepted
**Date:** 2026-05-11

## Context

ADR [0019](./0019-file-system-routing.md) ships the manifest with
patterns like `/users/:id` and `/blog/*`. ADR [0011](./0011-router-primitives.md)
documents `matchRoute(pattern)` returning `{ params:
Record<string, string> }` — accurate but untyped: every consumer
reads `match.params.id` with `id: string | undefined` rather than
the narrow `id: string` the pattern guarantees.

The Phase-1 manifest emits patterns as `string` (no `as const`).
Apps consuming the manifest via `for (const entry of routes)`
already lose pattern narrowing because array iteration widens
each element. So even if patterns were emitted as literal types,
the iteration loop would erase them.

The narrowing has to happen **per-route module**. Each route's
view function takes `params: Record<string, string>`; the
consumer writing the view file knows the pattern by virtue of
the file's name (`pages/users/[id].ts` → `:id`). A
`RouteParams<'/users/:id'>` template-literal type lets the view
annotate its params accurately without depending on a build-time
emit:

```ts
import type { RouteParams } from '@purityjs/vite-plugin';

export default function UserProfile(params: RouteParams<'/users/:id'>) {
  params.id; // string — narrowed by the template-literal type
}
```

This ADR ships the type. The follow-on (build-time route table
emit on disk) becomes a separate ADR if app feedback warrants —
the type alone solves the typing pain for route modules whose
authors know their own pattern.

## Decision

**Export `RouteParams<P extends string>` from `@purityjs/vite-plugin`**
as a type-only utility. It derives a `Record<paramName, string>`
shape from a pattern string using TypeScript's template-literal
types:

```ts
type RouteParams<P extends string> = … // derives from P
```

Behavior on the patterns shipped by the manifest:

| Pattern                | `RouteParams<P>`                    |
| ---------------------- | ----------------------------------- |
| `/`                    | `Record<string, never>` (no params) |
| `/about`               | `Record<string, never>`             |
| `/users/:id`           | `{ id: string }`                    |
| `/users/:id/edit`      | `{ id: string }`                    |
| `/orgs/:org/users/:id` | `{ org: string; id: string }`       |
| `/blog/*`              | `{ '*': string }`                   |
| `/admin/*`             | `{ '*': string }`                   |

Concretely:

- **Type-only export.** `RouteParams` has no runtime
  representation; the file ships as a `.ts` that emits zero
  JavaScript when tree-shaken. Apps using only the type pay
  zero bundle cost.
- **Maps `:name` → `{ [name]: string }`.** A literal segment
  like `/about` contributes nothing. A `:name` segment
  contributes a property `name: string`.
- **Maps `*` → `{ '*': string }`.** Single-key splat —
  matches `matchRoute()`'s emission (ADR 0011).
- **Mixed segments**: a pattern like `/users/:id/posts/:postId`
  produces `{ id: string; postId: string }`.
- **No params**: a pattern with no dynamic segments produces
  `Record<string, never>`. Callers writing `params: RouteParams
<'/about'>` get a type with no keys — assignments other than
  `{}` fail at compile.
- **Strict-mode-friendly**: the derived type is `{ [K in Names]:
string }`, not a `Partial`. Each named param is guaranteed
  present by `matchRoute()`'s contract (a non-match returns
  `null`, not a partial-params object).
- **Manual usage**: the route module imports `RouteParams` from
  `@purityjs/vite-plugin` and annotates its own params. No
  runtime change, no `as const` requirement on the manifest, no
  build-time file emit.

### Explicit non-features

- **No build-time manifest emit.** A real `.ts` file mirroring
  `purity:routes` would let `tsc` infer typed entries via array
  iteration; out of scope for this ADR. A follow-up may add
  `emitTo: 'src/.purity/routes.ts'` to the plugin options.
- **No automatic narrowing from `entry.pattern`.** Apps doing
  `for (const entry of routes) { matchRoute(entry.pattern) }` get
  `entry.pattern: string`, so the resulting params can't be
  narrowed automatically. Apps that want narrow params per-route
  pass `RouteParams<'/users/:id'>` explicitly in the route
  module — the location where the pattern is known.
- **No multi-splat support.** Splat is always `*`, single key.
  Patterns with multiple splats are out of grammar (ADR 0019
  rejects `/foo/*/bar/*` — splat must be the last segment).
- **No optional-param support.** ADR 0019's grammar doesn't have
  optional params today. If a future ADR adds `:name?`,
  `RouteParams` extends to mark that key as optional.
- **No `:name(regex)` value-constraint syntax.** Same — outside
  ADR 0019's grammar. If added, the type stays `string` (the
  constraint is a runtime invariant, not a TS-derivable type).
- **No re-export from `@purityjs/core`.** The type lives with
  the manifest emitter — that's where pattern syntax is defined.
  Apps consuming the manifest via `purity:routes` already pull
  the plugin as a build-time dependency.

## Consequences

**Positive:**

- Closes the typed-params half of ADR 0019's "typed route
  params" deferred non-feature. Apps writing route modules now
  get the same shape `matchRoute()` produces, narrowed.
- Zero runtime cost. Type-only export; tree-shakes to nothing.
- Tiny implementation. ~15 LOC of conditional-type plumbing.
- Composes with `asyncRoute`'s `(params, data)` signature
  (ADR 0025) — the route's first arg becomes
  `RouteParams<'/users/:id'>` instead of the generic
  `Record<string, string>`.

**Negative:**

- Apps still need to know their own pattern to annotate the
  type. Build-time auto-application (route file → matching
  manifest pattern → typed annotation) needs the build-time
  emit ADR. Documented as a follow-up.
- Patterns with no params produce an empty mapped type. The
  runtime delivers `{}`, which assigns cleanly. **TypeScript
  doesn't enforce excess-property checks on assignments to
  empty mapped types** — `const x: RouteParams<'/about'> = {
foo: 'bar' }` compiles even though `foo` isn't a derived key.
  Documented; doesn't affect real apps because params-less
  route components never read those keys. The required-keys
  check still works correctly for patterns with at least one
  param.

**Neutral:**

- New type-only export. No runtime change to the plugin's
  output, no breaking change to any existing API.
- Tests cover the common pattern shapes (no params, single
  param, multiple params, splat) via type-assertion casts in
  the existing test file.

## Alternatives considered

**Re-export from `@purityjs/core`.** Closer to where consumers
read params (inside route views). Rejected: pattern grammar is
the plugin's responsibility (ADR 0019). Adding the type to core
would couple core to the plugin's grammar — a wrong-way
dependency.

**Derive params from the route's file path** (`pages/users/[id].ts`)
instead of its pattern (`'/users/:id'`). Rejected: file-path
parsing in template-literal types is brittle (`[...slug]`
unpacks differently from `[id]`; nested directories add slashes).
Pattern parsing is simpler and matches `matchRoute()`'s grammar
exactly.

**Make `RouteParams` widen to `Record<string, string>` when the
pattern type is generic `string`** (rather than a literal type).
Useful for app code that holds a `RouteEntry` with `pattern:
string`. Rejected: TS doesn't distinguish "literal string" from
"`string`" cleanly in template-literal positions; the parser
fragments would distribute oddly. The current pattern fails
gracefully when given a non-literal (returns the empty record);
apps that care narrow explicitly.

**Generate the type from a build-time emitted route table.**
Tighter coverage (apps don't need to know their pattern; the
emitted table provides typed entries). Rejected for Phase 1:
adds build artifacts, gitignore concerns, multi-package emit
config. The pure-type-utility version covers most of the value.

**Split into separate `RouteSplat<P>` / `RouteParamsObject<P>`
helpers.** Cleaner for apps that want splat-only or param-only
types. Rejected: the combined type is ~15 LOC; splitting adds
API surface without proven need.

**Use a parser-shaped recursive type.** Walk a pattern char by
char. More accurate but blows up `tsc` budgets on long
patterns. Rejected: TS-template-literal infer-on-split is
faster + cleaner for the constrained grammar.
