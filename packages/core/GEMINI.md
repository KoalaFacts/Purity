# Purity Framework — Gemini Context

## Overview
Purity is a minimal web framework. 17 functions. 6 kB gzipped. Native TC39 Signals. No virtual DOM.

## Setup
```bash
npx @purityjs/cli my-app && cd my-app && npm install && npm run dev
```

## Full API
```ts
// State
const count = state(0);        // read: count(), write: count(5), update: count(v => v+1)
const doubled = compute(() => count() * 2);
watch(() => console.log(count()));          // auto-track
watch(count, (newVal, oldVal) => {});       // explicit
batch(() => { a(1); b(2); });              // single flush

// Templates (JIT compiled)
html`<div @click=${fn} :prop=${val} ::value=${signal} ?disabled=${() => !ok()}>
  ${() => count()}
</div>`

// Styles (Shadow DOM scoped in components)
css`.box { color: ${() => color()}; }`

// Components (Custom Elements)
component('p-name', (props, slots) => {
  onMount(() => { /* DOM ready */ });
  onDestroy(() => { /* cleanup */ });
  onDispose(watchDisposeFn);
  return html`...`;
});

// Slots
slot()               // default slot
slot('header')       // named slot
// Scoped: slot exposes data → consumer receives it

// Control flow
when(() => bool(), thenFn, elseFn)
match(() => val(), { case1: fn, case2: fn })
each(() => list(), mapFn, keyFn)

// Teleport
teleport('#target', () => html`<div>Portal</div>`)

// Mount
mount(() => html`<p-app></p-app>`, document.getElementById('app'));
```

## Template Binding Cheatsheet
| Syntax | Meaning | Example |
|--------|---------|---------|
| `${() => x()}` | Reactive text | `${() => count()}` |
| `@event` | Event listener | `@click=${handler}` |
| `:prop` | One-way binding | `:title=${title}` |
| `::prop` | Two-way binding | `::value=${text}` |
| `?attr` | Boolean attribute | `?disabled=${() => !ok()}` |
| `.prop` | DOM property | `.textContent=${val}` |

## Component Example
```ts
import { state, compute, html, css, component, mount, onMount, each, when } from '@purityjs/core';

component('p-todo', () => {
  const todos = state([]);
  const input = state('');
  const remaining = compute(() => todos().filter(t => !t.done).length);

  const add = () => {
    if (!input().trim()) return;
    todos(v => [...v, { id: Date.now(), text: input(), done: false }]);
    input('');
  };

  css`
    .app { max-width: 400px; margin: 2rem auto; font-family: system-ui; }
    input { padding: 0.5rem; width: 70%; }
    button { padding: 0.5rem 1rem; }
  `;

  return html`
    <div class="app">
      <h1>Todos (${() => remaining()} left)</h1>
      <input ::value=${input} @keydown=${(e) => e.key === 'Enter' && add()} />
      <button @click=${add}>Add</button>
      ${each(() => todos(), (todo) => html`
        <div>
          <input type="checkbox" ::checked=${state(todo.done)} />
          <span>${todo.text}</span>
        </div>
      `, (todo) => todo.id)}
    </div>
  `;
});

mount(() => html`<p-todo></p-todo>`, document.getElementById('app'));
```

## Packages
- `@purityjs/core` — framework (17 functions)
- `@purityjs/vite-plugin` — AOT template compilation (dev dependency)
- `@purityjs/cli` — project scaffolding

## One dependency: `signal-polyfill` (TC39 Signals reference implementation)
