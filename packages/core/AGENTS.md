# Purity Framework — AI Agent Instructions

This file provides context for AI coding agents (OpenAI Codex, GPT, Copilot Workspace).

## What is Purity?

A minimal, lightweight, super performant web framework built on native TC39 Signals.

- 6 kB gzipped (with AOT plugin)
- 17 core functions
- No virtual DOM — signals drive DOM updates directly
- Custom Elements with Shadow DOM
- JIT compiled templates (parse → AST → codegen → cached)
- Zero runtime dependencies (custom push-pull reactivity in `src/signals.ts`)

## Monorepo

```
packages/core/          @purityjs/core          — the framework
packages/vite-plugin/   @purityjs/vite-plugin   — AOT compilation
packages/cli/           @purityjs/cli           — project scaffolding
```

## Core API

```ts
import {
  state,
  compute,
  watch,
  batch, // reactive
  html,
  css, // template + styles
  component,
  slot,
  teleport, // components
  mount,
  onMount,
  onDestroy,
  onDispose,
  onError, // lifecycle
  match,
  when,
  each, // control flow
} from '@purityjs/core';
```

## Reactive Primitives

```ts
const count = state(0); // StateAccessor<number>
count(); // read → 0
count(5); // write → 5
count((v) => v + 1); // update → 6

const doubled = compute(() => count() * 2); // ComputedAccessor<number>

watch(() => console.log(count())); // auto-track, fires immediately
watch(count, (val, old) => {}); // explicit source, skips initial

batch(() => {
  a(1);
  b(2);
}); // single flush
```

## Templates

```ts
html`
  <div class=${() => (active() ? 'on' : 'off')}>
    <p>${() => count()}</p>
    <input ::value=${text} />
    <button @click=${handler} ?disabled=${() => !valid()}>Save</button>
  </div>
`;
```

## Components

```ts
component('p-card', ({ title }, { default: body, header }) => {
  css`
    .card {
      padding: 1rem;
      border-radius: 8px;
    }
  `;

  onMount(() => console.log('mounted'));
  onDestroy(() => console.log('destroyed'));

  return html`
    <div class="card">
      <h2>${title}</h2>
      ${header()} ${body()}
    </div>
  `;
});

// Usage
html`<p-card :title=${'Hello'}>
  <p>Body content</p>
</p-card>`;
```

## Common Patterns

### Form with two-way binding

```ts
component('p-form', () => {
  const name = state('');
  const submit = (e) => {
    e.preventDefault();
    console.log(name());
  };
  return html`<form @submit=${submit}><input ::value=${name} /><button>Go</button></form>`;
});
```

### Conditional rendering

```ts
when(
  () => loggedIn(),
  () => html`<p>Welcome</p>`,
  () => html`<p>Login</p>`,
);
match(() => status(), {
  loading: () => html`...`,
  error: () => html`...`,
  success: () => html`...`,
});
```

### List rendering

```ts
each(
  () => items(),
  (item) => html`<li>${item.name}</li>`,
  (item) => item.id,
);
```

### Composable (shared logic)

```ts
function useCounter(initial = 0) {
  const count = state(initial);
  const increment = () => count((v) => v + 1);
  const decrement = () => count((v) => v - 1);
  return { count, increment, decrement };
}
```

## Commands

```bash
npx @purityjs/cli my-app          # scaffold
npm run dev                      # dev server (vite)
npm run build                    # production build (AOT)
npm test --workspaces            # run all tests
```

## Code Style

- TypeScript strict mode
- Oxfmt (Vite+) formatter (2-space, single quotes, trailing commas)
- for-loops with index (not for-of) in hot paths
- console.error for errors (never silent catch)
- Nullable arrays with ??= lazy init
