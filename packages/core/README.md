# @purityjs/core

[![npm version](https://img.shields.io/npm/v/@purityjs/core.svg)](https://www.npmjs.com/package/@purityjs/core)
[![npm downloads](https://img.shields.io/npm/dm/@purityjs/core.svg)](https://www.npmjs.com/package/@purityjs/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@purityjs/core?label=gzipped)](https://bundlephobia.com/package/@purityjs/core)
[![license](https://img.shields.io/npm/l/@purityjs/core.svg)](../../LICENSE)

The core Purity framework. 20 functions. 6 kB gzipped. No virtual DOM.

## Install

```bash
npm install @purityjs/core
```

## API

### Reactive Primitives

```ts
import { state, compute, watch, batch } from '@purityjs/core';

const count = state(0);
count(); // read → 0
count(5); // write → 5
count((v) => v + 1); // update → 6
count.peek(); // read without tracking

const doubled = compute(() => count() * 2);

watch(() => console.log(count())); // auto-track, runs immediately
watch(count, (val, old) => {}); // explicit, skips initial
watch([a, b], ([va, vb], [oa, ob]) => {}); // multi-source

batch(() => {
  a(1);
  b(2);
}); // single flush
```

### Async Resources

Race-safe async data, built on signals. Each `resource()` exposes reactive
`data`, `loading`, and `error` accessors and auto-aborts stale requests via a
fresh `AbortSignal` whenever its dependencies change or its component unmounts.
No userland controllers, no flag soup, no `useEffect` cleanup dance.

```ts
import { state, resource, html } from '@purityjs/core';

const userId = state(1);

const user = resource(
  () => userId(), // re-fetch when this changes
  (id, { signal }) => fetch(`/u/${id}`, { signal }).then((r) => r.json()),
  { initialValue: null },
);

html`
  ${() => (user.loading() ? html`<p>Loading…</p>` : null)}
  ${() => (user.error() ? html`<p>${`Error: ${String(user.error())}`}</p>` : null)}
  ${() => user()?.name}

  <button @click=${() => user.refresh()}>Refresh</button>
`;
```

| API               | Effect                                                                |
| ----------------- | --------------------------------------------------------------------- |
| `r()` / `r.get()` | Current data (tracked). `undefined` until the first fetch resolves.   |
| `r.loading()`     | `true` while a fetch is in flight (tracked).                          |
| `r.error()`       | The most recent rejection, or `undefined` (tracked).                  |
| `r.refresh()`     | Re-runs the fetcher with the current deps.                            |
| `r.mutate(v)`     | Optimistically writes data and clears any error.                      |
| `r.dispose()`     | Aborts any in-flight request and tears down the watcher.              |
| Falsy source      | Returning `null` / `undefined` / `false` from the source skips fetch. |
| `AbortSignal`     | Aborted automatically on dep change or unmount.                       |
| SWR by default    | `r()` keeps the last successful value during refetch — no flash.      |

Single-arg form (auto-tracked deps inside the fetcher) is also supported:

```ts
const todos = resource(({ signal }) =>
  fetch(`/todos?limit=${limit()}`, { signal }).then((r) => r.json()),
);
```

#### Options

```ts
resource(source, fetcher, {
  initialValue: [], // seed before first fetch
  retry: 3, // exponential backoff
  retry: { count: 5, delay: (a) => 1000 * 2 ** a }, // custom backoff
  pollInterval: 30_000, // auto-refresh every N ms
});
```

#### Lazy / imperative — `lazyResource`

For mutations, button-triggered loads, and form submissions. Same accessor
shape as `resource()`, but does not run on creation. Call `r.fetch(args)` to
trigger; `r.refresh()` re-runs with the most recent args.

```ts
import { lazyResource } from '@purityjs/core';

const save = lazyResource((data: { name: string }, { signal }) =>
  fetch('/save', { method: 'POST', body: JSON.stringify(data), signal }),
);

html`
  <button @click=${() => save.fetch({ name: 'Jane' })}>Save</button>
  ${() => (save.loading() ? html`<p>Saving…</p>` : null)}
  ${() => (save.error() ? html`<p>Failed</p>` : null)}
`;
```

#### Debounced source — `debounced`

A read-only derived signal that mirrors a source after `ms` of quiet. Useful
for search-as-you-type and other rate-limited inputs.

```ts
import { state, debounced, resource } from '@purityjs/core';

const search = state('');
const query = debounced(search, 300);

const results = resource(
  () => query() || null,
  (q, { signal }) => fetch(`/search?q=${q}`, { signal }).then((r) => r.json()),
);

html`<input ::value=${search} placeholder="search…" />`;
```

### Templates

JIT compiled: `html` tagged literals → parse → AST → codegen → cached DOM factory.

```ts
import { html } from '@purityjs/core';

html`
  <div class=${() => (active() ? 'on' : 'off')}>
    <p>${() => count()}</p>
    <input ::value=${text} />
    <button @click=${save} ?disabled=${() => !valid()}>Save</button>
    <ul>
      ${each(
        () => items(),
        (item) => html`<li>${() => item()}</li>`,
      )}
    </ul>
  </div>
`;
```

| Syntax              | Meaning                                   |
| ------------------- | ----------------------------------------- |
| `${() => signal()}` | Reactive text                             |
| `@event=${fn}`      | Event listener                            |
| `:prop=${val}`      | One-way prop binding                      |
| `::prop=${signal}`  | Two-way binding (input, checkbox, select) |
| `?attr=${bool}`     | Boolean attribute                         |
| `.prop=${val}`      | DOM property                              |

### Components

Custom Elements with Shadow DOM. Registered globally by tag name.

```ts
import { component, slot, onMount, onDestroy, onDispose } from '@purityjs/core';

component('p-card', ({ title }, { default: body, header }) => {
  css`
    .card {
      padding: 1rem;
    }
  `;

  onMount(() => console.log('ready'));
  onDestroy(() => console.log('gone'));

  return html`
    <div class="card">
      <h2>${title}</h2>
      ${header()} ${body()}
    </div>
  `;
});
```

**Scoped slots** — expose data from component to consumer:

```ts
component('p-form', (_props, { default: body }) => {
  const isValid = compute(() => true);
  return {
    view: html`<form>${body({ validate: isValid })}</form>`,
    expose: { validate: isValid },
  };
});

// Consumer
Form({}, ({ validate }) => html` <button ?disabled=${() => !validate()}>Save</button> `);
```

### Scoped Styles

Shadow DOM handles scoping inside components. Reactive values auto-update.

```ts
css`
  .title {
    color: red;
  }
`;
css`
  .box {
    background: ${() => (dark() ? '#333' : '#fff')};
  }
`;
```

### Control Flow

```ts
import { match, when, each } from '@purityjs/core';

when(
  () => ok(),
  () => html`<p>Yes</p>`,
  () => html`<p>No</p>`,
);

match(() => status(), {
  loading: () => html`<p>Loading...</p>`,
  error: () => html`<p>Error</p>`,
  success: () => html`<p>Done</p>`,
});

each(
  () => items(),
  (item) => html`<li>${() => item().name}</li>`,
  (item) => item.id,
);
```

### Teleport

```ts
import { teleport } from '@purityjs/core';

teleport('#modal-root', () => (visible() ? html`<div class="modal">Open</div>` : null));
```

### Lifecycle

```ts
onMount(fn); // after DOM insertion (microtask)
onDestroy(fn); // on unmount
onDispose(fn); // register cleanup (auto-called on unmount)
onError(fn); // error boundary
```

### Mount

```ts
import { mount } from '@purityjs/core';

const { unmount } = mount(() => html`<p-app></p-app>`, document.getElementById('app')!);
```

## License

MIT
