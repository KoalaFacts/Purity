# Purity

A minimal, lightweight, super performant web framework built on native signals.

- **17 functions** — that's the entire API
- **6 kB gzipped** — with AOT compilation
- **No virtual DOM** — signals drive DOM updates directly
- **One dependency** — `signal-polyfill`

## Quick Start

```bash
npx @purityjs/cli my-app
cd my-app
npm install
npm run dev
```

## Packages

| Package                                           | Description                  | Docs                                       |
| ------------------------------------------------- | ---------------------------- | ------------------------------------------ |
| [`@purityjs/core`](./packages/core)               | The framework — 17 functions | [README](./packages/core/README.md)        |
| [`@purityjs/vite-plugin`](./packages/vite-plugin) | AOT template compilation     | [README](./packages/vite-plugin/README.md) |
| [`@purityjs/cli`](./packages/cli)                 | Project scaffolding          | [README](./packages/cli/README.md)         |

## At a Glance

```ts
import { state, compute, html, css, component, mount } from '@purityjs/core';

component('p-counter', () => {
  const count = state(0);
  const doubled = compute(() => count() * 2);

  css`
    button {
      padding: 0.5rem 1rem;
    }
  `;

  return html`
    <p>${() => count()} (x2: ${() => doubled()})</p>
    <button @click=${() => count((v) => v + 1)}>+1</button>
  `;
});

mount(() => html`<p-counter></p-counter>`, document.getElementById('app')!);
```

See each package README for full API documentation.

## How It Compares

|                     | Purity                            | SolidJS                       | Svelte 5              | Vue Vapor                   |
| ------------------- | --------------------------------- | ----------------------------- | --------------------- | --------------------------- |
| **Approach**        | TC39 Signals + compiled templates | Custom signals + compiled JSX | Runes + full compiler | Proxy reactivity + compiler |
| **Virtual DOM**     | No                                | No                            | No                    | No                          |
| **Bundle (gz)**     | 6 kB                              | 7 kB                          | 2 kB + generated      | 16 kB (beta)                |
| **Custom Elements** | Native                            | Optional                      | Optional              | Optional                    |
| **Shadow DOM**      | Built-in                          | No                            | No                    | No                          |
| **Two-way binding** | `::prop`                          | Manual                        | `bind:`               | `v-model`                   |
| **Dependencies**    | 1                                 | 0                             | 0                     | 0                           |

**Runtime benchmarks** — automated in headless Chromium across 18 scenarios:
[koalafacts.github.io/Purity](https://koalafacts.github.io/Purity/)

## License

MIT
