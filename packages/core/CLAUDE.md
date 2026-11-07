# @purityjs/core

Purity core framework — no virtual DOM, TC39-Signals-inspired reactivity.

## Scope

`@purityjs/core` owns templates (`html`, JIT), components (`component`, `slot`, `teleport`, `mount`, lifecycle hooks), control flow (`when`, `match`, `each`, `list`, `suspense`), `resource`/`lazyResource`/`debounced`, `css`, forms (`@purityjs/core/forms`), virtual lists (`@purityjs/core/virtual`), async derivation (`asyncCompute`, `@purityjs/core/async`, ADR 0054), property-granular stores (`store`, `@purityjs/core/store`, ADR 0055), error boundaries (`errorBoundary`, `@purityjs/core/boundary`, ADR 0056) and client hydration. Reactivity (`state`, `compute`, `watch`, `batch`, scopes) lives in [`@purityjs/signals`](../signals/README.md); the template parser and code generators in [`@purityjs/compiler`](../compiler/README.md); browser/live-data signals, `query`, `optimistic`, server actions and islands in [`@purityjs/platform`](../platform/README.md); routing in [`@purityjs/router`](../router/README.md).

The public API with examples is in [README.md](./README.md); which entry provides which feature is in [docs/core-entry-points.md](../../docs/core-entry-points.md). Keep this file to layout and conventions.

## Hydration

`hydrate(container, App)` walks the SSR-rendered DOM and attaches bindings
in place (no rebuild). Marker pairs `<!--[-->...<!--]-->` delimit each
expression slot; nested `${html\`...\`}` returns a deferred thunk that
inflates against its slot's subtree. See ADR
[0005](../../docs/decisions/0005-non-lossy-hydration.md).

```ts
import { enableHydrationWarnings } from "@purityjs/core/runtime";
import { hydrate } from "@purityjs/core";

if (import.meta.env.DEV) enableHydrationWarnings();
hydrate(document.getElementById("app")!, App);
```

`enableHydrationWarnings()` makes the hydrator log `console.warn` on
structural mismatches (wrong element tag, missing marker, etc.). Off by
default — adds one short-circuit per cursor step when off, a function
call + warn-on-mismatch when on. Independent of warnings, the hydrator
catches walker failures and falls back to a fresh `mount()` so a
divergent SSR can never crash the page.

`enableHydrationTextRewrite()` (ADR 0007) is the opt-in self-heal mode
for static-text drift. When on, an SSR `Text` node whose `data` differs
from the template's AST text is rewritten in place — same node
reference, only the bytes change. Useful for stale CDN caches or
build-cache divergence. Independent of warnings; combine the two flags
to fix-and-log.

`each()`, `when()`, `match()` are all hydration-aware. From inside a
hydrating template they return deferred handles instead of building
DOM, and the hydrate factory routes those handles through specialised
adoption helpers.

- `each()` — `eachSSR` emits per-row markers `<!--er:KEY-->row<!--/er-->`
  (keys URL-encoded with `-` rewritten to `%2D`). `inflateDeferredEach`
  matches each item's key against the SSR rows and inflates the row's
  deferred `html\`\`` template against the existing row DOM. Same node
  references survive — long-list hydration doesn't flash. Rows whose
  key has no SSR match fall through to fresh DOM for that row only.
- `when()` / `match()` — `matchSSR` / `whenSSR` embed the rendered
  case key in the boundary marker (`<!--m:KEY-->view<!--/m-->`).
  `inflateDeferredMatch` compares the SSR key to the current
  `sourceFn()` value and inflates the picked case's deferred template
  against the SSR view nodes. Adopted nodes seed the per-case DOM
  cache, so toggling back to the SSR key reuses the original DOM.

## Async data — `resource`, `lazyResource`, `debounced`

Race-safe async fetcher backed by signals. Auto-aborts in-flight requests when
deps change or the surrounding component unmounts. SWR by default — `data()`
keeps the last successful value during refetch.

```ts
const user = resource(
  () => userId() || null,
  (id, { signal }) => fetch(`/u/${id}`, { signal }).then((r) => r.json()),
  { initialValue: null, retry: 3, pollInterval: 60_000 },
);

// Imperative form for mutations / button-triggered fetches
const save = lazyResource((data: SaveArgs, { signal }) =>
  fetch("/save", { method: "POST", body: JSON.stringify(data), signal }),
);
save.fetch({ name: "x" });

// Debounce a signal before feeding it into a resource
const search = state("");
const query = debounced(search, 300);
const results = resource(
  () => query() || null,
  (q, { signal }) => fetch(`/search?q=${q}`, { signal }).then((r) => r.json()),
);
```

Options on `resource()` / `lazyResource()`: `initialValue`, `retry` (number or
`{ count, delay }`), `pollInterval` (ms), `key` (stable SSR ↔ hydration
cache key — pass any unique-per-render string when creation is
conditional, otherwise the index-based pairing shifts between server
and client).

Inside a `component()`, `resource()` auto-wires `bindComponentState`
for `'loading'` and `'error'` on the host element, so styling reacts
natively: `:host(:state(loading)) { … }` from inside the component, or
`p-card:state(loading) { … }` from outside. Ref-counted across
multiple resources in the same component. See ADR 0035.

## Template Syntax

```
${() => signal()}     reactive text
@event=${handler}     event listener
:prop=${value}        one-way binding
::prop=${signal}      two-way binding
?attr=${bool}         boolean attribute
.prop=${value}        DOM property
```

## File Layout (src/)

```
index.ts            — default entry: CSR surface (csr.ts) + hydrate + form hooks
csr.ts              — CSR entry (`@purityjs/core/csr`): public client API without hydration
component.ts        — ComponentContext, mount, lifecycle
elements.ts         — component(), slot(), teleport(), Custom Element wiring
control.ts          — match(), when(), each() + keyed reconcile (LIS reorder)
control/            — dispatch.ts (SSR hooks), hydrate.ts (control-flow adoption), keys.ts, list-runtime.ts (`./list-runtime` entry)
resource.ts         — resource() / lazyResource(); resource/ holds dispatch and retry
debounced.ts        — debounced() (same implementation as @purityjs/signals)
styles.ts           — css() scoped styles
forms.ts, forms/    — form-associated elements (`./forms`, `./forms/lifecycle`)
store.ts            — store() property-granular state (`./store`, ADR 0055)
boundary.ts         — errorBoundary() (`./boundary`, ADR 0056)
virtual.ts          — virtualized lists (`./virtual`)
async.ts            — asyncCompute() / PendingError (`./async`, ADR 0054)
hydrate.ts          — root hydrate()
hooks.ts            — passive cross-package / optional-feature hook bridge
ssr-bridge.ts, ssr-context.ts, ssr/ — server integration points and hydration cache
__purity_swap.ts    — client splice helper for streamed Suspense boundaries
compiler/           — compile.ts (JIT html`` with WeakMap cache), jit.ts (`./jit`), client.ts (`./jit-client`, no hydration codegen), runtime.ts (`./runtime`)
runtime/            — csr-runtime.ts (`./csr-runtime`, swapSlot etc.), hydrate-runtime.ts (deferred templates, ADR 0005), hydrate-elements.ts
```

Parser, AST and the three code generators (`generate` / `generateSSR` / `generateHydrate`) are in `packages/compiler/src/`, published as `@purityjs/compiler` so `@purityjs/vite-plugin` can import them without runtime code.

## Testing

```bash
npx vitest run          # run all tests
npm run bench           # vitest micro-benchmarks (from packages/core)
```

- Use `const tick = () => new Promise(r => queueMicrotask(r))` for async updates
- jsdom environment

## Benchmarks

- `tests/resource.bench.ts` — vitest micro-benchmarks (init / fetch / debounce / mutate / poll cost)
- `../../benchmark/tools/resource-heap.ts` — Node `--expose-gc` heap diff per cycle (run with `node --expose-gc --conditions=development tools/resource-heap.ts` from `/benchmark`)
- See the package README "Performance" section for the latest numbers.

## Code Style

- Oxfmt (Vite+): 2-space indent, single quotes, trailing commas
- for-loops with index (not for-of) in hot paths
- Nullable arrays (null when empty, ??= for lazy init)
- console.error for errors (never silent catch)
