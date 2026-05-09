# @purityjs/core

Purity core framework — 18 functions, no virtual DOM, native TC39 Signals.

## API (18 functions)

```ts
state(initial)              // read: count(), write: count(5), update: count(v => v+1)
compute(fn)                 // derived: doubled = compute(() => count() * 2)
watch(fn)                   // auto-track: watch(() => console.log(count()))
watch(source, cb)           // explicit: watch(count, (val, old) => {})
watch([a, b], cb)           // multi: watch([a, b], ([va, vb], [oa, ob]) => {})
batch(fn)                   // batch: batch(() => { a(1); b(2); }) — single flush
resource(fetcher)            // async data: r(), r.loading(), r.error(), r.refresh(), r.mutate()
resource(source, fetcher)    // re-fetches on source change; falsy source = skip
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
```

## resource — async data with built-in cancellation

Race-safe async fetcher backed by signals. Auto-aborts in-flight requests when
deps change or the surrounding component unmounts. No userland AbortController
plumbing.

```ts
const user = resource(
  () => userId() || null, // source — skip if falsy
  (id, { signal }) => fetch(`/u/${id}`, { signal }).then((r) => r.json()),
  { initialValue: null },
);

user(); // T | undefined  (tracked)
user.loading(); // boolean        (tracked)
user.error(); // unknown        (tracked)
user.refresh(); // re-run with current deps
user.mutate(v); // optimistic write; clears error
```

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
resource.ts         — resource() async data primitive (built on watch)
compiler/
  ast.ts            — AST node types
  parser.ts         — charcode-based template parser
  codegen.ts        — AST → optimized JS DOM code
  compile.ts        — JIT html`` with WeakMap cache
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
```

- Use `const tick = () => new Promise(r => queueMicrotask(r))` for async updates
- jsdom environment

## Code Style

- Oxfmt (Vite+): 2-space indent, single quotes, trailing commas
- for-loops with index (not for-of) in hot paths
- Nullable arrays (null when empty, ??= for lazy init)
- console.error for errors (never silent catch)
