# @purityjs/core

[![npm version](https://img.shields.io/npm/v/@purityjs/core.svg)](https://www.npmjs.com/package/@purityjs/core)
[![npm downloads](https://img.shields.io/npm/dm/@purityjs/core.svg)](https://www.npmjs.com/package/@purityjs/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@purityjs/core?label=gzipped)](https://bundlephobia.com/package/@purityjs/core)
[![license](https://img.shields.io/npm/l/@purityjs/core.svg)](../../LICENSE)

The core Purity framework. 20 functions. ~5.8 kB gzipped. No virtual DOM.

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

#### End-to-end recipes

**Pagination with SWR** — `r()` keeps the previous page's data visible
while the next page is fetching, so the list never flashes empty.

```ts
const page = state(1);
const items = resource(
  () => page(),
  (p, { signal }) => fetch(`/items?page=${p}`, { signal }).then((r) => r.json()),
);

component('p-paginated', () => {
  return html`
    <ul>
      ${each(
        () => items() ?? [],
        (item) => html`<li>${() => item().name}</li>`,
      )}
    </ul>
    <button @click=${() => page((p) => Math.max(1, p - 1))}>Prev</button>
    <span>${() => page()}</span>
    <button @click=${() => page((p) => p + 1)}>Next</button>
    ${() => (items.loading() ? html`<small>updating…</small>` : null)}
  `;
});
```

**Search-as-you-type** — debounce the input, skip fetches on empty
strings, and let the resource's AbortSignal cancel the in-flight HTTP
request when a newer keystroke arrives.

```ts
component('p-search', () => {
  const term = state('');
  const query = debounced(term, 300);
  const results = resource(
    () => query().trim() || null,
    (q, { signal }) =>
      fetch(`/search?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.json()),
  );

  return html`
    <input ::value=${term} placeholder="search…" />
    ${() => (results.loading() ? html`<p>searching…</p>` : null)}
    <ul>
      ${each(
        () => results() ?? [],
        (hit) => html`<li>${() => hit().title}</li>`,
      )}
    </ul>
  `;
});
```

**Optimistic save with rollback** — mutate the local data immediately,
then call the lazy save resource. If the save errors, restore the
previous value.

```ts
component('p-todo-row', ({ todo }) => {
  const local = state(todo);
  const save = lazyResource((next: typeof todo, { signal }) =>
    fetch(`/todos/${next.id}`, {
      method: 'PUT',
      body: JSON.stringify(next),
      signal,
    }).then((r) => {
      if (!r.ok) throw new Error('save failed');
      return r.json();
    }),
  );

  const toggle = () => {
    const prev = local.peek();
    const next = { ...prev, done: !prev.done };
    local(next); // optimistic
    save.fetch(next);
    watch(save.error, (err) => {
      if (err) local(prev); // roll back
    });
  };

  return html`
    <label>
      <input type="checkbox" ?checked=${() => local().done} @change=${toggle} />
      ${() => local().title} ${() => (save.loading() ? html`<small>saving…</small>` : null)}
    </label>
  `;
});
```

**Polling dashboard with pause** — `pollInterval` re-fetches every N ms
after each settle. Pair with a manual `dispose()` to pause.

```ts
component('p-dashboard', () => {
  const paused = state(false);
  const stats = resource(
    () => (paused() ? null : 'tick'),
    (_, { signal }) => fetch('/stats', { signal }).then((r) => r.json()),
    { pollInterval: 5_000, retry: 2 },
  );
  return html`
    <h2>Live stats</h2>
    <pre>${() => JSON.stringify(stats(), null, 2)}</pre>
    <button @click=${() => paused((v) => !v)}>${() => (paused() ? 'Resume' : 'Pause')}</button>
    ${() => (stats.error() ? html`<p>connection lost</p>` : null)}
  `;
});
```

#### Performance

Numbers from the package's vitest bench (`npm run bench -w packages/core`)
on a 2024 M-class laptop, jsdom environment. Construction and disposal
happen in setup/teardown so the timed region is the steady-state
operation. Treat as relative — useful for tracking regressions, not for
cross-framework claims.

| Operation                                          | ops/sec | per op  |
| -------------------------------------------------- | ------- | ------- |
| `resource()` construct + sync resolve + dispose    | ~55 k   | ~18 µs  |
| `resource()` construct + async resolve + dispose   | ~64 k   | ~16 µs  |
| `resource(source)` construct, source-skip, dispose | ~377 k  | ~3 µs   |
| 1 dep change → fetch → resolve                     | ~113 k  | ~9 µs   |
| 10 rapid dep changes → 1 winning resolve           | ~113 k  | ~9 µs   |
| 100 reactive watchers on a resolved `r`            | ~24 k   | ~42 µs  |
| `mutate(value)` (steady-state)                     | ~6.2 M  | ~160 ns |
| `refresh()` round-trip                             | ~113 k  | ~9 µs   |
| `lazyResource()` construct (no fetch) + dispose    | ~234 k  | ~4 µs   |
| `lazyResource.fetch(args)` → resolve               | ~100 k  | ~10 µs  |
| `debounced()` construct + dispose                  | ~784 k  | ~1.3 µs |
| `debounced` 1 source update                        | ~740 k  | ~1.4 µs |
| `debounced` 100 rapid updates (coalesced)          | ~378 k  | ~2.6 µs |

The "10 rapid dep changes" row matches "1 dep change" — the manual
prev-key dedup collapses bursts to a single fetch. `mutate(value)` in
steady state is essentially `runId++` plus a no-op `batch()` because
`writeState` short-circuits on `Object.is`.

**Memory (per resource lifecycle, after dispose)** — measured with
`benchmark/tools/resource-heap.mjs` over 1 000 cycles:

| Cycle                                            | Retained per cycle |
| ------------------------------------------------ | ------------------ |
| `resource()` sync resolve + dispose              | ~80 B              |
| `resource()` async resolve + dispose             | ~85 B              |
| `resource(source, fetcher)` full fetch + dispose | ~265 B             |
| `lazyResource()` construct + fetch + dispose     | ~120 B             |
| `debounced()` construct + 10 updates + dispose   | ~30 B              |

These are V8 bookkeeping noise — sub-kilobyte per cycle indicates the
lifecycle is a closed loop and the controllers, watchers, and state
nodes are all reclaimed on dispose.

Run yourself:

```bash
npm run bench -w packages/core             # vitest micro-benches
cd benchmark && node --expose-gc \
  --conditions=development tools/resource-heap.ts   # heap diff per cycle
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
