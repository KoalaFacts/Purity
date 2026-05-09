# Purity

[![npm version](https://img.shields.io/npm/v/@purityjs/core.svg?label=%40purityjs%2Fcore)](https://www.npmjs.com/package/@purityjs/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@purityjs/core?label=gzipped)](https://bundlephobia.com/package/@purityjs/core)
[![license](https://img.shields.io/npm/l/@purityjs/core.svg)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/KoalaFacts/Purity?style=social)](https://github.com/KoalaFacts/Purity)

A minimal web framework with TC39-Signals-inspired reactivity and templates that compile to direct DOM operations.

- **21 functions** — that's the entire API
- **~5.8 kB gzipped** — with AOT compilation
- **No virtual DOM** — signals drive DOM updates directly
- **CSP-safe** — no `eval`, no `new Function` (with the Vite plugin)
- **Zero runtime dependencies**
- **Web Components by design** — `component()` registers a Custom Element with Shadow DOM (see tradeoffs in the package README)
- **Race-safe async** — first-class `resource()` with built-in cancellation, retry, polling, debouncing, and SWR by default
- **Server-side rendering** — `renderToString` + `hydrate()` ship with Declarative Shadow DOM and resource-aware SSR via the `@purityjs/ssr` package

> The signals implementation is a custom push-pull graph inspired by the [TC39 Signals proposal](https://github.com/tc39/proposal-signals) (Stage 1). It is _not_ a polyfill or a binding to a native engine API — no engine ships TC39 Signals yet.

## Quick Start

```bash
npx @purityjs/cli my-app          # client-only
npx @purityjs/cli my-app --ssr    # SSR + hydration
cd my-app
npm install
npm run dev
```

## Packages

| Package                                           | Description                                  | Docs                                       |
| ------------------------------------------------- | -------------------------------------------- | ------------------------------------------ |
| [`@purityjs/core`](./packages/core)               | The framework — 21 functions                 | [README](./packages/core/README.md)        |
| [`@purityjs/ssr`](./packages/ssr)                 | `renderToString` + DSD + resource awaiting   | [package](./packages/ssr)                  |
| [`@purityjs/vite-plugin`](./packages/vite-plugin) | AOT template compilation (client + SSR)      | [README](./packages/vite-plugin/README.md) |
| [`@purityjs/cli`](./packages/cli)                 | Project scaffolding (`--ssr` flag available) | [README](./packages/cli/README.md)         |

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
import { state, resource, lazyResource, debounced } from '@purityjs/core';

const id = state(1);

// Reactive resource with retry and polling baked in
const user = resource(
  () => id(),
  (id, { signal }) => fetch(`/u/${id}`, { signal }).then((r) => r.json()),
  { retry: 3, pollInterval: 30_000 },
);

user(); // current data (tracked) — preserved across refetches (SWR)
user.loading(); // boolean (tracked)
user.error(); // unknown (tracked)
user.refresh(); // re-fetch with the same deps
user.mutate(v); // optimistic update
user.dispose(); // tear down (or auto-cleans on component unmount)

// Imperative form for mutations / button-triggered fetches
const save = lazyResource((data: SaveArgs, { signal }) =>
  fetch('/save', { method: 'POST', body: JSON.stringify(data), signal }),
);
save.fetch({ name: 'x' });

// Debounce a signal before driving a resource
const search = state('');
const query = debounced(search, 300);
const results = resource(
  () => query() || null,
  (q, { signal }) => fetch(`/search?q=${q}`, { signal }).then((r) => r.json()),
);
```

Stale requests are aborted automatically when `id` changes or the component
unmounts. Out-of-order resolutions are dropped via a monotonic run counter.
Retries honor the abort signal — a dep change cancels mid-backoff.

### Server-side rendering

```ts
// entry.server.ts
import { renderToString } from '@purityjs/ssr';
import { App } from './app.ts';

export const render = (_url: string) => renderToString(App);

// entry.client.ts
import { hydrate } from '@purityjs/core';
import { App } from './app.ts';

hydrate(document.getElementById('app')!, App);
```

The same component code runs on Node and in the browser. Custom elements
ship as **Declarative Shadow DOM** (`<template shadowrootmode="open">`)
so the browser parses a real shadow tree before any JS loads. Resources
created during render are awaited; the resolved values are embedded as a
JSON payload that `hydrate()` reads to skip the first refetch.

Scaffold with `npx @purityjs/cli my-app --ssr` or see
[`examples/ssr`](./examples/ssr) for a working setup.

See each package README for full API documentation.

## How It Compares

|                     | Purity                                     | SolidJS                       | Svelte 5              | Vue Vapor                   |
| ------------------- | ------------------------------------------ | ----------------------------- | --------------------- | --------------------------- |
| **Approach**        | TC39-Signals-inspired + compiled templates | Custom signals + compiled JSX | Runes + full compiler | Proxy reactivity + compiler |
| **Virtual DOM**     | No                                         | No                            | No                    | No                          |
| **Bundle (gz)**¹    | 5.8 kB                                     | ~7 kB                         | ~2 kB + generated     | ~16 kB (beta³)              |
| **Custom Elements** | Native                                     | Optional                      | Optional              | Optional                    |
| **Shadow DOM**      | Default                                    | Via custom elements           | Via custom elements   | Via custom elements         |
| **Two-way binding** | `::prop`                                   | Manual                        | `bind:`               | `v-model`                   |
| **Async data**²     | `resource()` reactive primitive            | `createResource`              | `{#await}` template   | Userland                    |
| **Dependencies**    | 0                                          | 0                             | 0                     | 0                           |

¹ Purity measured locally with `vite build` on this branch; SolidJS / Svelte / Vue Vapor are each project's published runtime sizes — verify against bundlephobia for your specific imports.
² "Reactive primitive" means a tracked accessor with `loading`/`error`/`refresh`/`mutate`. Svelte's `{#await}` is a template-level control flow over a promise (no reactive resource handle). Vue Vapor has `<Suspense>` as a coordination boundary but no resource primitive in core.
³ Vue Vapor mode is in beta as of Vue 3.6 (May 2026); size and capabilities may change.

**Runtime benchmarks** — automated in headless Chromium across 18 scenarios:
[koalafacts.github.io/Purity](https://koalafacts.github.io/Purity/)

**Live demo** — a polling dashboard built end-to-end on Purity (state,
compute, resource with retry+pollInterval, lazyResource, debounced,
each, mount): [koalafacts.github.io/Purity/dashboard](https://koalafacts.github.io/Purity/dashboard/)
([source](./examples/dashboard))

## Status

**Pre-1.0 (`0.1.0`).** The API may break between minor versions until 1.0.
There is no public versioning policy yet, and we don't know of any production
users. If you ship Purity to users, please open an issue so we can keep your
use case in mind for the breaking-change discussions.

## What this framework does NOT do

Knowing what's missing matters more than what's there. As of `0.1.0`:

- **SSR hydration is partially DOM-preserving.** `renderToString` +
  `hydrate()` ship with Declarative Shadow DOM and resource-aware
  two-pass rendering. Hydration walks the SSR DOM, strips the
  `<!--[--><!--]-->` markers, and installs reactivity in place — same
  Node instances survive, no flash — for simple- and complex-template
  shapes (single root element with text/expression children, and
  multi-element trees with positional-path bindings). Custom-element
  subtrees, control-flow helper output, and deeply nested mixed shapes
  still fall back to a fresh render. Named / scoped slot SSR and
  streaming output are not yet implemented.
- **No router.** Not on the roadmap. Bring your own (the History API
  is straightforward to use directly).
- **No devtools panel.** Signal-graph inspection happens via
  `console.log` today. A browser extension is being considered for
  post-1.0; not committed.
- **No production track record.** Pre-1.0; we know of zero production
  deployments. Treat as a serious side-project, not a battle-tested tool.
- **No accessibility audit.** Shadow DOM defaults have a11y
  implications (ARIA across boundaries, focus delegation). See
  [`docs/accessibility.md`](./docs/accessibility.md) for working
  patterns; nothing in the framework has been audited at scale.

## Docs

Long-form guides live in [`/docs`](./docs/README.md):

- [TypeScript guide](./docs/typescript.md)
- [Why Shadow DOM by default](./docs/shadow-dom-rationale.md)
- [Accessibility under Shadow DOM](./docs/accessibility.md)
- [Migration cheatsheet](./docs/migration.md) (React / SolidJS / Vue / Svelte → Purity)

## Development

```bash
npm test --workspaces   # all tests
npm run check           # format check + lint (oxfmt + oxlint)
npm run check:fix       # auto-fix
```

## License

MIT
