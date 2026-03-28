# Purity Framework

Purity is a minimal, lightweight, super performant JavaScript web framework built on native TC39 Signals.

## Quick Reference

### Monorepo Structure
```
packages/
  core/          @purity/core          — the framework (17 functions)
  vite-plugin/   @purity/vite-plugin   — AOT template compilation
  cli/           @purity/cli           — project scaffolding
```

### Core API (17 functions)
```ts
// Reactive primitives
state(initial)              // read: count(), write: count(5), update: count(v => v+1)
compute(fn)                 // derived: doubled = compute(() => count() * 2)
watch(fn)                   // auto-track: watch(() => console.log(count()))
watch(source, cb)           // explicit: watch(count, (val, old) => {})
watch([a, b], cb)           // multi: watch([a, b], ([va, vb], [oa, ob]) => {})
batch(fn)                   // batch: batch(() => { a(1); b(2); }) — single flush

// Templates (JIT compiled: parse → AST → codegen → cached)
html`<div>...</div>`        // returns DOM Node/Fragment

// Scoped styles (Shadow DOM + adoptedStyleSheets inside components, regex fallback outside)
css`.box { color: red; }`   // static or reactive: css`.box { color: ${() => c()}; }`

// Components (Custom Elements with Shadow DOM)
component('p-tag', renderFn) // registers custom element, returns factory
slot<E>(name?)               // context-aware slot accessor inside component
teleport(target, viewFn)     // render to different DOM location, reactive

// Lifecycle (3 hooks + error)
mount(componentFn, el)       // mount to DOM, returns { unmount }
onMount(fn)                  // after DOM insertion (microtask)
onDestroy(fn)                // on unmount
onDispose(fn)                // register cleanup (auto-called on unmount)
onError(fn)                  // error boundary

// Control flow
match(sourceFn, cases, fallback?) // pattern matching: match(() => status(), { loading: ..., error: ... })
when(condFn, thenFn, elseFn?)     // boolean: when(() => ok(), () => html`yes`, () => html`no`)
each(listFn, mapFn, keyFn?)       // list: each(() => items(), (item) => html`<li>${item}</li>`)
```

### Template Syntax
```
${value}                    static value
${() => signal()}           reactive text
${node}                     DOM node insertion
${array}                    array of nodes

@event=${handler}           event listener
?attr=${boolOrFn}           boolean attribute
.prop=${value}              DOM property
:prop=${value}              one-way prop binding (reactive if function)
::prop=${signal}            two-way binding (input, checkbox, select)
```

### Component Pattern
```ts
component('p-card', ({ title }, { default: body, header }) => {
  const isValid = compute(() => /* ... */);

  css`
    .card { padding: 1rem; }
    .title { color: blue; }
  `;

  return {
    view: html`
      <div class="card">
        <h2 class="title">${title}</h2>
        ${header()}
        ${body({ validate: isValid })}
      </div>
    `,
    expose: { validate: isValid },
  };
});

// Usage:
// Static slot:    Card({ title: 'Hi' }, html`<p>Body</p>`)
// Scoped slot:    Card({ title: 'Hi' }, ({ validate }) => html`...`)
// Named slots:    Card({ title: 'Hi' }, { header: html`...`, default: html`...` })
// Callback slots: Card({ title: 'Hi' }, ({ header, validate }) => { header(html`...`); return html`...`; })
```

## Development

### Commands
```bash
npm test --workspaces     # run all tests
npm test -w packages/core # run core tests only

cd packages/core && npx vitest run           # core tests
cd packages/vite-plugin && npx vitest run    # plugin tests
```

### Tech Stack
- TypeScript 6, Vite 8, Vitest 4
- Biome for formatting/linting
- signal-polyfill (TC39 Signals reference implementation)
- jsdom for DOM testing

### Architecture Decisions
- **No virtual DOM** — signals drive DOM updates directly
- **JIT compiled templates** — parse → AST → codegen → new Function() → WeakMap cached
- **Custom Elements** with Shadow DOM for style scoping
- **One external dep** — signal-polyfill (maintained by TC39 proposal champions)
- **Lifecycle: 3 hooks** — onMount, onDestroy, onDispose (like Solid's onCleanup)
- **No runtime parser in production** — @purity/vite-plugin AOT compiles templates

### File Layout (packages/core/src/)
```
signals.ts          — state, compute, watch, batch (246 lines)
compiler/
  ast.ts            — AST node types
  parser.ts         — single-pass template parser (charcode-based)
  codegen.ts        — AST → optimized JS DOM creation code
  compile.ts        — JIT html`` tag with WeakMap cache
  index.ts          — compiler exports
component.ts        — ComponentContext, mount, lifecycle hooks
elements.ts         — component(), slot(), teleport(), Custom Element registration
helpers.ts          — match(), when(), each() control flow
styles.ts           — css() scoped styles (Shadow DOM or regex fallback)
inject.ts           — [removed, available as @purity/inject]
index.ts            — public API exports
```

### Testing Conventions
- Tests in `packages/*/tests/`
- Use `const tick = () => new Promise(r => queueMicrotask(r))` for async signal updates
- Performance tests use generous thresholds and log actual times
- jsdom environment for DOM tests

### Code Style
- Biome: 2-space indent, single quotes, trailing commas, 100 char line width
- No aliases — one name per concept
- for-loops with index over for-of (performance)
- Nullable arrays (null when empty, ??= for lazy init)
- console.error for disposal/lifecycle errors (never silent catch)
