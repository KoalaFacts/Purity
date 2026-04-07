# @purityjs/core

Purity core framework — 17 functions, no virtual DOM, native TC39 Signals.

## API (17 functions)
```ts
state(initial)              // read: count(), write: count(5), update: count(v => v+1)
compute(fn)                 // derived: doubled = compute(() => count() * 2)
watch(fn)                   // auto-track: watch(() => console.log(count()))
watch(source, cb)           // explicit: watch(count, (val, old) => {})
watch([a, b], cb)           // multi: watch([a, b], ([va, vb], [oa, ob]) => {})
batch(fn)                   // batch: batch(() => { a(1); b(2); }) — single flush
html`<div>...</div>`        // JIT compiled template → DOM nodes
css`.box { color: red; }`   // scoped styles (Shadow DOM in components, regex fallback outside)
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
each(listFn, mapFn, keyFn?)  // list rendering
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
signals.ts          — state, compute, watch, batch
compiler/
  ast.ts            — AST node types
  parser.ts         — charcode-based template parser
  codegen.ts        — AST → optimized JS DOM code
  compile.ts        — JIT html`` with WeakMap cache
component.ts        — ComponentContext, mount, lifecycle
elements.ts         — component(), slot(), teleport(), Custom Element
helpers.ts          — match(), when(), each()
styles.ts           — css() scoped styles
index.ts            — public API exports
```

## Testing
```bash
npx vitest run          # run all tests
```
- Use `const tick = () => new Promise(r => queueMicrotask(r))` for async updates
- jsdom environment

## Code Style
- Biome: 2-space indent, single quotes, trailing commas
- for-loops with index (not for-of) in hot paths
- Nullable arrays (null when empty, ??= for lazy init)
- console.error for errors (never silent catch)
