# Core entry points for 0.4

Upgrade core, SSR, the Vite plugin, and CLI together, then rebuild both client
and server artifacts. The root export no longer includes optional features or
the JIT compiler. These are subpaths of the same package, with shared reactive
state and ownership; they are not separate installations.

| Import                    | APIs                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@purityjs/core`          | `state`, `compute`, `watch`, `batch`, `debounced`, component lifecycle, `mount`, `hydrate`, `component`, `slot`, `internals`, `teleport`, `each`, `list`, `match`, `when`, `suspense`, `resource`, `lazyResource`, `css` |
| `@purityjs/core/jit`      | `html`, `makeDeferred`; supports templates without a build step                                                                                                                                                          |
| `@purityjs/core/jit-client` | Client-only JIT `html` without the hydration code generator; throws if called inside a hydration pass. Suitable for no-build pages that never hydrate. |
| `@purityjs/core/runtime`  | Precompiled template/hydration and value helpers; hydration warning and text-rewrite options                                                                                                                             |
| `@purityjs/core/compiler` | `parse`, `generate`, `generateLinked`, `generateHydrate`, `generateHydrateLinked`, `generateSSR`, AST types                                                                                                              |
| `@purityjs/core/signals`  | Browser storage, observer, environment, permission, and live-data signals                                                                                                                                                |
| `@purityjs/core/router`   | Navigation, route matching, `asyncRoute`, `routeData`, `loaderData`, `head`, `manageTitle`, `getRequest`                                                                                                                 |
| `@purityjs/core/actions`  | `serverAction`, `findAction`, `handleAction`, `enhanceForms`, `optimistic`                                                                                                                                               |
| `@purityjs/core/islands`  | `island`, `mountIslands`, island branding helpers                                                                                                                                                                        |
| `@purityjs/core/query`    | `query`, `invalidateQuery`                                                                                                                                                                                               |
| `@purityjs/core/internal` | SSR coordination, string-rendering helpers, component renderer, streaming splice helper; intended for framework integration                                                                                              |

Types follow their feature's entry point. The main reactive primitives remain
at the root; `/signals` contains browser integrations, not another reactive
engine. The compiler entry no longer re-exports runtime helpers.

The plugin also selects `@purityjs/core/list-runtime` for direct ordinary
`each` calls when it can prove that the binding never receives virtual options.
This is a generated-code entry; continue importing `each` from the root.
`each(..., { virtual: true })`, dynamic options, and uncertain bindings retain
the full implementation. This list optimization requires no application API
changes; the 0.4 entry-point migration above still applies.
The `jit-client` entry is an explicit application choice, not a drop-in replacement for hydration. `@purityjs/core/jit` remains compatible with both client creation and hydration. The Vite plugin recognizes both JIT imports and removes either from fully compiled AOT output. The bundle-size harness measures a real counter with both JIT entries; changes must reduce the **complete app** rather than just the exported entry size.

Projects with a custom core root alias keep the full implementation unless
an explicit `/list-runtime` alias takes precedence over the root alias.

```ts
import { mount, state } from '@purityjs/core';
import { html } from '@purityjs/core/jit';
import { navigate } from '@purityjs/core/router';
import { serverAction } from '@purityjs/core/actions';
```

With the Vite plugin, `html` templates are compiled ahead of time and their
JIT import is removed. Generated client code imports `/runtime`; generated
server code imports `/internal` and registers the SSR component renderer.
The plugin recognizes named, aliased, and namespace `serverAction` imports
from `/actions` when removing inline server handlers from client output.

SSR-only templates continue to use `html` from `@purityjs/ssr`. On the client,
JIT templates still require runtime code generation; AOT templates do not.
Use consistent source aliases for **all** subpaths in a local checkout, or
use built package exports for all of them. Mixing source and dist may create
separate reactive graphs. The CLI generates the complete local alias map.

The removed `valueText`/`__purity_tx__` helper is replaced by `swapSlot`/
`__purity_sw__`; rebuild generated templates. The unused `generateModule`,
`generateHydrateModule`, and `generateSSRModule` wrappers were removed;
use the corresponding factory generators.

## Size accounting

`npm run check:bundle` enforces budgets for every entry and an equivalent
pre-split, all-features API (`core-all`). The latter retains the original
46,080-byte gzip and 40,704-byte Brotli limits. Independent entry sizes overlap
because they share dependencies; adding them is not an application's size.
The measured counter, controls, form, and hydration applications provide
separate tree-shaken evidence. Moving exports alone does not remove their
implementations from an application that uses them.

The main entry has no JIT compiler dependency. Server control-flow rendering
is registered when an SSR pass starts, so client controls do not retain the
HTML string builders or streaming suspense implementation. Server resource
registration and cancellation are also installed at SSR entry, allowing
client resources to discard those implementations. Shared SSR coordination
remains; this does not eliminate all server-related code from client bundles.
