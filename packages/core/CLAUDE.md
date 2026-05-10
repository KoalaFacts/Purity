# @purityjs/core

Purity core framework — 21 functions, no virtual DOM, TC39-Signals-inspired reactivity.

## API (21 functions)

```ts
state(initial)              // read: count(), write: count(5), update: count(v => v+1)
compute(fn)                 // derived: doubled = compute(() => count() * 2)
watch(fn)                   // auto-track: watch(() => console.log(count()))
watch(source, cb)           // explicit: watch(count, (val, old) => {})
watch([a, b], cb)           // multi: watch([a, b], ([va, vb], [oa, ob]) => {})
batch(fn)                   // batch: batch(() => { a(1); b(2); }) — single flush
debounced(source, ms)        // delayed mirror: const q = debounced(search, 300)
resource(fetcher)            // async data: r(), r.loading(), r.error(), r.refresh(), r.mutate()
resource(source, fetcher)    // re-fetches on source change; falsy source = skip
lazyResource(fetcher)        // imperative: r.fetch(args) triggers, r.refresh() reuses last
html`<div>...</div>`        // JIT compiled template → DOM nodes
css`.box { color: red; }`   // scoped styles (Shadow DOM in components, <style> + class scoping outside)
component('p-tag', renderFn) // custom element with Shadow DOM
slot<E>(name?)               // context-aware slot accessor
teleport(target, viewFn)     // render to different DOM location, reactive
mount(componentFn, el)       // mount to DOM, returns { unmount }
onMount(fn)                  // after DOM insertion (microtask)
onDestroy(fn)                // on unmount
onDispose(fn)                // register cleanup
onError(fn)                  // error boundary
match(sourceFn, cases)       // pattern matching
when(condFn, thenFn, elseFn?) // boolean conditional
each(listFn, mapFn, keyFn?)  // list rendering — mapFn receives item as accessor: (item: () => T, i: number)
list(tag, listAccessor, textOrOptions, keyFn?) // leaner list of single-tag rows
suspense(view, fallback)     // SSR error-isolation boundary; emits `<!--s:N--><!--/s:N-->` markers (ADR 0006 Phase 1)
```

## Hydration

`hydrate(container, App)` walks the SSR-rendered DOM and attaches bindings
in place (no rebuild). Marker pairs `<!--[-->...<!--]-->` delimit each
expression slot; nested `${html\`...\`}` returns a deferred thunk that
inflates against its slot's subtree. See ADR
[0005](../../docs/decisions/0005-non-lossy-hydration.md).

```ts
import { enableHydrationWarnings, hydrate } from '@purityjs/core';

if (import.meta.env.DEV) enableHydrationWarnings();
hydrate(document.getElementById('app')!, App);
```

`enableHydrationWarnings()` makes the hydrator log `console.warn` on
structural mismatches (wrong element tag, missing marker, etc.). Off by
default — adds one short-circuit per cursor step when off, a function
call + warn-on-mismatch when on. Independent of warnings, the hydrator
catches walker failures and falls back to a fresh `mount()` so a
divergent SSR can never crash the page.

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
  fetch('/save', { method: 'POST', body: JSON.stringify(data), signal }),
);
save.fetch({ name: 'x' });

// Debounce a signal before feeding it into a resource
const search = state('');
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
signals.ts          — state, compute, watch, batch (push-pull graph, no deps)
resource.ts         — resource() / lazyResource() async data (built on watch)
debounced.ts        — debounced() derived signal helper
compiler/
  ast.ts            — AST node types
  parser.ts         — charcode-based template parser
  codegen.ts        — AST → optimized JS DOM code (generate / generateSSR / generateHydrate)
  compile.ts        — JIT html`` with WeakMap cache + inflateDeferred for hydration
  hydrate-runtime.ts — isHydrating flag + DeferredTemplate thunk (ADR 0005)
  index.ts          — re-exports for the @purityjs/core/compiler subpath
component.ts        — ComponentContext, Scope, mount, lifecycle
elements.ts         — component(), slot(), teleport(), Custom Element
control.ts          — match(), when(), each() + LIS reorder
styles.ts           — css() scoped styles
index.ts            — public API exports
```

The compiler is exposed under the `@purityjs/core/compiler` subpath
(`packages/core/package.json` `exports`) so `@purityjs/vite-plugin` can
import it without pulling in runtime code.

## Testing

```bash
npx vitest run          # run all tests
npm run bench           # run vitest micro-benchmarks (resource.bench.ts)
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
