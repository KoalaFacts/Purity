# Purity

[![npm version](https://img.shields.io/npm/v/@purityjs/core.svg?label=%40purityjs%2Fcore)](https://www.npmjs.com/package/@purityjs/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@purityjs/core?label=gzipped)](https://bundlephobia.com/package/@purityjs/core)
[![license](https://img.shields.io/npm/l/@purityjs/core.svg)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/KoalaFacts/Purity?style=social)](https://github.com/KoalaFacts/Purity)

A minimal, lightweight, super performant web framework built on native signals.

- **18 functions** — that's the entire API
- **6 kB gzipped** — with AOT compilation
- **No virtual DOM** — signals drive DOM updates directly
- **CSP-safe** — no `eval`, no `new Function` (with the Vite plugin)
- **Zero runtime dependencies**
- **Race-safe async** — first-class `resource()` with built-in cancellation

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

### Async data, race-safe by default

```ts
import { state, resource } from '@purityjs/core';

const id = state(1);
const user = resource(
  () => id(),
  (id, { signal }) => fetch(`/u/${id}`, { signal }).then((r) => r.json()),
);

user(); // current data (tracked)
user.loading(); // boolean (tracked)
user.error(); // unknown (tracked)
user.refresh(); // re-fetch with the same deps
user.mutate(v); // optimistic update
```

Stale requests are aborted automatically when `id` changes or the component
unmounts. Out-of-order resolutions are dropped via a monotonic run counter.
No userland `AbortController` or `useEffect` cleanup needed.

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
| **Async data**      | `resource()` built-in             | `createResource`              | Userland              | Userland                    |
| **Dependencies**    | 0                                 | 0                             | 0                     | 0                           |

**Runtime benchmarks** — automated in headless Chromium across 18 scenarios:
[koalafacts.github.io/Purity](https://koalafacts.github.io/Purity/)

## Development

```bash
npm test --workspaces   # all tests
npm run check           # format check + lint (oxfmt + oxlint)
npm run check:fix       # auto-fix
```

## License

MIT
