# Purity

A minimal, lightweight, super performant web framework built on native signals.

- **17 functions** — that's the entire API
- **6 kB gzipped** — with AOT compilation
- **No virtual DOM** — signals drive DOM updates directly
- **Native signals** — built on [TC39 Signals proposal](https://github.com/tc39/proposal-signals)
- **Custom Elements** — components are web standards
- **Shadow DOM** — scoped styles, zero runtime CSS cost
- **One dependency** — `signal-polyfill`

## Quick Start

```bash
npx @purity/cli my-app
cd my-app
npm install
npm run dev
```

## Example

```ts
import { state, compute, html, css, component, mount } from '@purity/core';

component('p-counter', () => {
  const count = state(0);
  const doubled = compute(() => count() * 2);

  css`
    .counter { text-align: center; padding: 2rem; }
    button { padding: 0.5rem 1rem; margin: 0.25rem; }
  `;

  return html`
    <div class="counter">
      <p>Count: ${() => count()} (doubled: ${() => doubled()})</p>
      <button @click=${() => count(v => v + 1)}>+1</button>
      <button @click=${() => count(v => v - 1)}>-1</button>
      <button @click=${() => count(0)}>Reset</button>
    </div>
  `;
});

mount(() => html`<p-counter></p-counter>`, document.getElementById('app')!);
```

## API

### Reactive

```ts
const count = state(0);                     // read: count(), write: count(5), update: count(v => v+1)
const doubled = compute(() => count() * 2); // derived value
watch(() => console.log(count()));          // auto-tracking effect
watch(count, (val, old) => {});             // explicit source watcher
batch(() => { a(1); b(2); });              // batch writes, single flush
```

### Templates

```ts
html`
  <div class=${() => active() ? 'on' : 'off'}>
    <p>${() => count()}</p>
    <input ::value=${text} />
    <button @click=${save} ?disabled=${() => !valid()}>Save</button>
  </div>
`
```

| Syntax | Meaning |
|--------|---------|
| `${() => signal()}` | Reactive text |
| `@event=${fn}` | Event listener |
| `:prop=${val}` | One-way prop binding |
| `::prop=${signal}` | Two-way binding |
| `?attr=${bool}` | Boolean attribute |
| `.prop=${val}` | DOM property |

### Components

```ts
component('p-card', ({ title }, { default: body }) => {
  css`.card { padding: 1rem; border-radius: 8px; }`;
  return html`<div class="card"><h2>${title}</h2>${body()}</div>`;
});
```

### Scoped Slots

```ts
component('p-form', (_props, { default: body }) => {
  const isValid = compute(() => true);
  return {
    view: html`<form>${body({ validate: isValid })}</form>`,
    expose: { validate: isValid },
  };
});

// Consumer receives exposed data
Form({}, ({ validate }) => html`
  <button ?disabled=${() => !validate()}>Save</button>
`)
```

### Control Flow

```ts
when(() => loggedIn(), () => html`<p>Welcome</p>`, () => html`<p>Login</p>`)

match(() => status(), {
  loading: () => html`<p>Loading...</p>`,
  error:   () => html`<p>Error!</p>`,
  success: () => html`<p>Done</p>`,
})

each(() => items(), (item) => html`<li>${item.name}</li>`, (item) => item.id)
```

### Lifecycle

```ts
onMount(() => {
  const id = setInterval(() => count(v => v + 1), 1000);
  onDispose(() => clearInterval(id));
});
onDestroy(() => console.log('goodbye'));
onError((err) => console.error(err));
```

### Styles

```ts
css`.title { color: red; }`;                              // static
css`.box { background: ${() => dark() ? '#333' : '#fff'}; }`;  // reactive
```

### Teleport

```ts
teleport('#modal-root', () =>
  visible() ? html`<div class="modal">Hello</div>` : null
)
```

## Packages

| Package | Description |
|---------|-------------|
| [`@purity/core`](./packages/core) | The framework — 17 functions |
| [`@purity/vite-plugin`](./packages/vite-plugin) | AOT template compilation |
| [`@purity/cli`](./packages/cli) | Project scaffolding |

## How It Works

1. **Signals** — `state()` and `compute()` wrap TC39 Signal primitives for fine-grained reactivity
2. **Templates** — `html` tagged literals are JIT compiled: parsed into AST, codegen produces direct `document.createElement` calls, cached via WeakMap
3. **Fine-grained updates** — `watch()` tracks dependencies automatically, updates only the exact DOM nodes that changed
4. **Custom Elements** — `component()` registers a Web Component with Shadow DOM for style encapsulation
5. **AOT** — `@purity/vite-plugin` compiles templates at build time, eliminating the parser from the production bundle

## License

MIT
