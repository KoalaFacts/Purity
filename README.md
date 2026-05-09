# Purity

[![npm version](https://img.shields.io/npm/v/@purityjs/core.svg?label=%40purityjs%2Fcore)](https://www.npmjs.com/package/@purityjs/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@purityjs/core?label=gzipped)](https://bundlephobia.com/package/@purityjs/core)
[![license](https://img.shields.io/npm/l/@purityjs/core.svg)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/KoalaFacts/Purity?style=social)](https://github.com/KoalaFacts/Purity)

A minimal web framework with TC39-Signals-inspired reactivity and templates that compile to direct DOM operations.

- **20 functions** — that's the entire API
- **~5.8 kB gzipped** — with AOT compilation
- **No virtual DOM** — signals drive DOM updates directly
- **CSP-safe** — no `eval`, no `new Function` (with the Vite plugin)
- **Zero runtime dependencies**
- **Web Components by design** — `component()` registers a Custom Element with Shadow DOM (see tradeoffs in the package README)
- **Race-safe async** — first-class `resource()` with built-in cancellation, retry, polling, debouncing, and SWR by default

> The signals implementation is a custom push-pull graph inspired by the [TC39 Signals proposal](https://github.com/tc39/proposal-signals) (Stage 1). It is _not_ a polyfill or a binding to a native engine API — no engine ships TC39 Signals yet.

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
| [`@purityjs/core`](./packages/core)               | The framework — 20 functions | [README](./packages/core/README.md)        |
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
No userland `AbortController`, `useEffect` cleanup, or debounce hook needed.

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

## Status

**Pre-1.0 (`0.1.0`).** The API may break between minor versions until 1.0.
There is no public versioning policy yet, and we don't know of any production
users. If you ship Purity to users, please open an issue so we can keep your
use case in mind for the breaking-change discussions.

## What this framework does NOT do (yet)

Knowing what's missing matters more than what's there. As of `0.1.0`:

- **No SSR / hydration.** Purity is client-rendered only. If you need
  server-rendered HTML for SEO, social previews, or
  performance-on-low-end-devices, this framework is not yet a fit. A
  static-prerender story is on the post-1.0 roadmap; full SSR is not
  currently planned.
- **No router.** Bring your own (e.g. `@picocss/router` style or
  hand-rolled History API).
- **No devtools panel.** Signal-graph inspection happens via
  `console.log` today. A browser extension is post-1.0.
- **No production track record.** Pre-1.0; we know of zero production
  deployments. Treat as a serious side-project, not a battle-tested tool.
- **No accessibility audit.** Shadow DOM defaults have a11y implications
  (ARIA across boundaries, focus delegation) that we have not yet
  documented or tested at scale.

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
