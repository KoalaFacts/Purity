# Purity Framework — Copilot Instructions

Purity is a minimal web framework built on native TC39 Signals. No virtual DOM.

## Tooling

- Use `vp` for workspace tasks and local validation
- Use `import { defineConfig } from 'vite-plus'` in config files
- Use `import { describe, expect, it, vi } from 'vite-plus/test'` in tests
- Prefer `vp test run` and `vp build` over `vp exec vitest` or raw `vite`

## API (17 functions)

```ts
state(init)              // reactive state: count(), count(5), count(v => v+1)
compute(fn)              // derived: compute(() => count() * 2)
watch(fn)                // auto-track effect
watch(source, cb)        // explicit: watch(count, (val, old) => {})
batch(fn)                // batch writes, single flush
html`<div>...</div>`     // JIT compiled template → DOM nodes
css`.box { color: red }` // scoped styles (Shadow DOM in components)
component('p-tag', fn)   // custom element with Shadow DOM
slot(name?)              // content projection inside component
teleport(target, fn)     // render elsewhere in DOM
mount(fn, el)            // mount to DOM
onMount(fn)              // after DOM insertion
onDestroy(fn)            // on unmount
onDispose(fn)            // register cleanup
onError(fn)              // error handler
match(fn, cases)         // pattern matching
when(fn, then, else?)    // conditional
each(fn, map, key?)      // list rendering
```

## Template Syntax

```
${() => signal()}     reactive text
@click=${handler}     event
:prop=${value}        one-way binding
::prop=${signal}      two-way binding
?attr=${bool}         boolean attribute
.prop=${value}        DOM property
```

## Component Pattern

```ts
component("p-card", ({ title }, { default: body }) => {
  css`
    .card {
      padding: 1rem;
    }
  `;
  return html`<div class="card">
    <h2>${title}</h2>
    ${body()}
  </div>`;
});
```

## Key Rules

- Always use `() => signal()` for reactive text in templates (not `signal()`)
- Use `::` for two-way binding (not `bind:`)
- Events are callback props, no emit system
- `onDispose()` for cleanup — register watch/effect dispose functions
- `state(v => v+1)` for updater pattern (not `state(state()+1)`)
- Custom element tags must contain a hyphen (`p-card`, not `card`)
- `css` inside components uses Shadow DOM (no class scoping needed)

## Structure

```
packages/
  core/          @purityjs/core          — framework
  vite-plugin/   @purityjs/vite-plugin   — AOT template compilation
  cli/           @purityjs/cli           — project scaffolding
```

## Testing

```ts
const tick = () => new Promise((r) => queueMicrotask(r));
// Always await tick() after signal writes before asserting DOM
```
