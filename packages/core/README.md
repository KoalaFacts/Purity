# @purityjs/core

[![npm version](https://img.shields.io/npm/v/@purityjs/core.svg)](https://www.npmjs.com/package/@purityjs/core)
[![npm downloads](https://img.shields.io/npm/dm/@purityjs/core.svg)](https://www.npmjs.com/package/@purityjs/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@purityjs/core?label=gzipped)](https://bundlephobia.com/package/@purityjs/core)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

The core Purity framework. Signal-driven rendering without a virtual DOM.

Use the feature entry points described in the [entry point and migration guide](https://github.com/KoalaFacts/Purity/blob/main/docs/core-entry-points.md).
Production sizes depend on the APIs used; run `npm run check:bundle` for current measurements.

## Install

```bash
npm install @purityjs/core
```

## API

### Reactive Primitives

```ts
import { state, compute, watch, batch } from "@purityjs/core";

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

Nested objects and arrays: `store()` from `@purityjs/core/store` tracks each
property separately, so a write reruns only the readers of what changed
([ADR 0055](../../docs/decisions/0055-property-store.md)).

```ts
import { store } from "@purityjs/core/store";

const [form, update] = store({ name: "", address: { city: "" }, tags: ["a"] });
compute(() => form.address.city); // reruns only when city changes
update((draft) => {
  draft.address.city = "Sydney"; // all writes in one batch
  draft.tags.push("b");
});
// form.name = "x" throws: the view is read-only
```

### Async Resources

Race-safe async data, built on signals. Each `resource()` exposes reactive
`data`, `loading`, and `error` accessors and auto-aborts stale requests via a
fresh `AbortSignal` whenever its dependencies change or its component unmounts.
The fetcher receives an `AbortSignal` that fires on dep change or unmount,
so callers don't need to wire `AbortController` themselves.

```ts
import { state, resource } from "@purityjs/core";
import { html } from "@purityjs/core/jit";

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
import { lazyResource } from "@purityjs/core";

const save = lazyResource((data: { name: string }, { signal }) =>
  fetch("/save", { method: "POST", body: JSON.stringify(data), signal }),
);

html`
  <button @click=${() => save.fetch({ name: "Jane" })}>Save</button>
  ${() => (save.loading() ? html`<p>Saving…</p>` : null)}
  ${() => (save.error() ? html`<p>Failed</p>` : null)}
`;
```

#### Debounced source — `debounced`

A read-only derived signal that mirrors a source after `ms` of quiet. Useful
for search-as-you-type and other rate-limited inputs.

```ts
import { state, debounced, resource } from "@purityjs/core";

const search = state("");
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

component("p-paginated", () => {
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
component("p-search", () => {
  const term = state("");
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
component("p-todo-row", ({ todo }) => {
  const local = state(todo);
  const save = lazyResource((next: typeof todo, { signal }) =>
    fetch(`/todos/${next.id}`, {
      method: "PUT",
      body: JSON.stringify(next),
      signal,
    }).then((r) => {
      if (!r.ok) throw new Error("save failed");
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
after each settle. Toggle pausing by returning `null` from the source
(see the example): the falsy-source path stops the polling without
tearing the resource down. (`r.dispose()` is terminal — for permanent
teardown, not pause/resume.)

```ts
component("p-dashboard", () => {
  const paused = state(false);
  const stats = resource(
    () => (paused() ? null : "tick"),
    (_, { signal }) => fetch("/stats", { signal }).then((r) => r.json()),
    { pollInterval: 5_000, retry: 2 },
  );
  return html`
    <h2>Live stats</h2>
    <pre>${() => JSON.stringify(stats(), null, 2)}</pre>
    <button @click=${() => paused((v) => !v)}>${() => (paused() ? "Resume" : "Pause")}</button>
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
`benchmark/tools/resource-heap.ts` over 1 000 cycles:

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

### Async derivation (`@purityjs/core/async`)

`asyncCompute` turns a Promise-returning computation into a value that ordinary
`compute()` chains can read ([ADR 0054](../../docs/decisions/0054-async-derivation.md)).

```ts
import { compute, state, watch } from "@purityjs/core";
import { asyncCompute, isPending } from "@purityjs/core/async";

const id = state(1);
const user = asyncCompute(({ signal }) =>
  fetch(`/u/${id()}`, { signal }).then((r) => r.json() as Promise<{ name: string }>),
);
const greeting = compute(() => `Hello, ${user().name}`);

watch(() => {
  try {
    console.log(greeting());
  } catch (err) {
    if (!isPending(err)) throw err; // first load: not ready yet
  }
});
```

- Reads made before the first `await` are tracked; changing one starts a new run
  and aborts the previous run's `signal`. Only the latest run can become current.
- Before the first settlement, reading throws `PendingError`; downstream
  computes cache and rethrow it like any error. After that, a refetch keeps the
  previous value while `user.pending()` is `true`.
- A rejection of the latest run is rethrown to readers until a later run
  succeeds. `user.dispose()` (or disposing the owning scope) aborts the run.
- The first run starts when the value is first read.
- `fn` may return an `AsyncIterable` (for example an async generator): each
  yielded value becomes current in turn, and the iterator is closed with
  `return()` when a newer run starts or the value is disposed. A generator
  waiting on an `await` closes once that await settles (JavaScript queues
  `return()` behind it); none of its later values are delivered. An iterator
  that ends without yielding stays pending.

  ```ts
  const messages = asyncCompute(() => subscribe(room())); // AsyncIterable<Message>
  ```

- A `watch` that reads an unresolved value without a guard throws
  `PendingError` from `watch()`; guard the read as above until the view
  boundary (SV2-004) lands.

### Templates

JIT compiled: `html` tagged literals → parse → AST → codegen → cached DOM factory.

```ts
import { html } from "@purityjs/core/jit";

html`
  <div class=${() => (active() ? "on" : "off")}>
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
import { component, slot, onMount, onDestroy, onDispose } from "@purityjs/core";

component("p-card", ({ title }, { default: body, header }) => {
  css`
    .card {
      padding: 1rem;
    }
  `;

  onMount(() => console.log("ready"));
  onDestroy(() => console.log("gone"));

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
component("p-form", (_props, { default: body }) => {
  const isValid = compute(() => true);
  return {
    view: html`<form>${body({ validate: isValid })}</form>`,
    expose: { validate: isValid },
  };
});

// Consumer
Form({}, ({ validate }) => html` <button ?disabled=${() => !validate()}>Save</button> `);
```

#### Trade-offs of Custom Elements + Shadow DOM by default

`component()` always registers a Custom Element with Shadow DOM. This is an
opinionated choice — listing the costs honestly so you can decide:

- **Global CSS / utility frameworks (Tailwind, CSS reset, design tokens).**
  Styles applied to `document` do not pierce a shadow root. Per-component
  utility CSS works via [`adoptedStyleSheets`](https://developer.mozilla.org/en-US/docs/Web/API/Document/adoptedStyleSheets)
  — Tailwind needs explicit injection per shadow root. CSS variables _do_
  pierce, so design tokens declared on `:root` work normally.
- **Form libraries / native form participation.** The `@purityjs/core` root
  entry automatically enables form controls. For a component wrapping one
  input, select, or textarea, register it with `{ formControl: true }`. Purity then
  publishes its value and validity through
  [`ElementInternals`](https://developer.mozilla.org/en-US/docs/Web/API/ElementInternals).
  Libraries that only walk light DOM still cannot inspect the internal control.
  For lifecycle callbacks without a native-control bridge, import
  `formComponent` and the `onForm*` hooks from `@purityjs/core/forms/lifecycle`.
  Alternatively, call `enableFormLifecycle()` from that entry before using
  `component(..., { formAssociated: true })` from a lighter entry such as
  `@purityjs/core/csr`. With that entry, import `@purityjs/core/forms` to
  enable `formControl` support.
- **Accessibility across shadow boundaries.** `aria-labelledby` /
  `aria-describedby` cannot reference IDs across a shadow root. Use
  `aria-label` directly or expose explicit ARIA attributes on the host.
  See [`docs/accessibility.md`](https://github.com/KoalaFacts/Purity/blob/main/docs/accessibility.md) for the
  browser checks and remaining manual acceptance criteria.
- **Third-party DOM queries.** `document.querySelector('.my-class')` from
  outside a component will not find elements inside its shadow root. Inspect
  via the host element first.
- **SSR.** The separate `@purityjs/ssr` package serializes components with
  [Declarative Shadow DOM](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template/shadowrootmode).
- **Platform name collisions.** Custom-element tag names must contain a
  hyphen, but anything starting with `font-`, `annotation-xml`, etc. is
  reserved. The convention `p-yourname` keeps you clear.

If these costs outweigh the encapsulation benefit for your app, Purity may
not be the right fit — most of the framework's other primitives (`state`,
`compute`, `watch`, `resource`, `debounced`) work fine without
`component()` if you want to render to plain elements via `mount()` and
`html` only.

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
    background: ${() => (dark() ? "#333" : "#fff")};
  }
`;
```

### Control Flow

```ts
import { match, when, each } from "@purityjs/core";

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

`each()` keys rows with the third argument (item identity when omitted). On an
update it calls the key function once per item before creating any row, keeps
the rows whose keys match at the start and end of the list in place, and moves
only rows inside the changed range (fewest moves, via `moveBefore` where the
browser has it). Keys must be unique; a repeated key renders only its first
occurrence and logs a warning.

The renderer's second argument is the index the row was created at; the third,
`position`, is an accessor for its current index, so ordinal labels and
position-based actions stay right after a keyed reorder without re-rendering
the row ([ADR 0058](../../docs/decisions/0058-each-current-position.md)):

```ts
each(
  () => todos(),
  (todo, _index, position) =>
    html`<li>${() => `${position() + 1}. ${todo().title}`}
      <button @click=${() => removeAt(position())}>×</button></li>`,
  (todo) => todo.id,
);
```

For a long list, import `virtualEach` and put it in a scrollable container:

```ts
import { virtualEach } from "@purityjs/core/virtual";

html`<ul style="max-height: 24rem; overflow-y: auto">
  ${virtualEach(
    () => items(),
    (item) => html`<li>${() => item().name}</li>`,
    (item) => item.id,
  )}
</ul>`;
```

Purity manages the visible range, spacers, and row-height measurements. Supply
stable keys when items can be inserted, removed, or reordered. SSR still renders
the full list; hydration adopts those rows before windowing them.

To replace a part of the page when it fails, wrap it in `errorBoundary`:

```ts
import { errorBoundary } from "@purityjs/core/boundary";

html`<section>
  ${errorBoundary(
    () => html`<p>${() => total().toFixed(2)}</p>`,
    (error, reset) => html`<p role="alert">${String(error)}</p>
      <button @click=${reset}>Retry</button>`,
  )}
</section>`;
```

A throw while the view renders, or later from one of its bindings or watches,
disposes the view and shows `fallback(error, reset)`; the rest of the page keeps
updating. `reset()` renders the view again. A throwing fallback goes to the next
outer boundary or the component's `onError`. Event-handler errors, and errors
inside a nested `component()` custom element, are not caught. On the server a synchronous throw renders the fallback; hydrated
content is not guarded yet ([ADR 0056](../../docs/decisions/0056-error-boundary.md)).

To show a placeholder until an `asyncCompute()` value first settles, wrap the
part that reads it in `loading`:

```ts
import { asyncCompute } from "@purityjs/core/async";
import { loading } from "@purityjs/core/loading";

const user = asyncCompute(({ signal }) => fetchUser(id(), { signal }));

html`<section>
  ${loading(
    () => html`<h2>${() => user().name}</h2><input placeholder="Note" />`,
    () => html`<p aria-busy="true">Loading…</p>`,
  )}
</section>`;
```

The fallback shows until the view renders without an unresolved read. After
that a refetch keeps the view as it is (same nodes, focus and typed input);
use `user.pending()` for a busy indicator. A rejection goes to the surrounding
`errorBoundary` or `onError`. Content created later (a new `when()` branch
reading a new async value) needs its own `loading`. On the server an unresolved
read renders the fallback ([ADR 0057](../../docs/decisions/0057-loading-boundary.md)).

### Async transactions

`transaction()` from `@purityjs/core/transaction` keeps writes made around
async work together: values staged with `tx.set()` are applied in one batch
when the work resolves and dropped when it rejects; `tx.optimistic()` shows a
tentative value at once and removes it exactly once when the transaction
settles ([ADR 0059](../../docs/decisions/0059-async-transaction.md)).

```ts
import { transaction } from "@purityjs/core/transaction";

await transaction(async (tx) => {
  tx.optimistic(title, draft); // shown now
  const saved = await save(draft, { signal: tx.signal });
  tx.set(title, saved.title); // both applied together
  tx.set(updatedAt, saved.updatedAt);
});
```

Overlapping transactions show the newest tentative value; a commit underneath
it becomes visible when the last tentative value on that signal settles.
Started during component setup or render, a transaction is aborted on unmount
(writes dropped, tentative values removed, the promise rejects with
`AbortError`); one started from an event handler always settles.

### Owner composition

Work created in a later callback (a timer, a socket message, a resolved
promise) has no owner, so it is not stopped on unmount. `@purityjs/core/owner`
lets an integration bind it explicitly
([ADR 0060](../../docs/decisions/0060-owner-composition.md)):

```ts
import { getOwner, root, runWithOwner } from "@purityjs/core/owner";

const Ticker = () => {
  const owner = getOwner()!;
  socket.on("price", (p) => {
    // Stopped when Ticker unmounts; released at once if it already has.
    runWithOwner(owner, () => watch(p.signal, render));
  });
  return html`<p>…</p>`;
};

// A detached cache with an explicit lifetime.
const cache = root((dispose) => ({ total: compute(() => sum(items())), dispose }));
cache.dispose(); // exactly once; later calls do nothing
```

`owner.alive` is `false` once the owner is disposed. Cleanup inside one owner
runs in registration order.

### Teleport

```ts
import { teleport } from "@purityjs/core";

teleport("#modal-root", () => (visible() ? html`<div class="modal">Open</div>` : null));
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
import { mount } from "@purityjs/core";

const { unmount } = mount(() => html`<p-app></p-app>`, document.getElementById("app")!);
```

## Further reading

- [Live demo](https://koalafacts.github.io/Purity/dashboard/) — polling dashboard with `resource` (retry + pollInterval), `lazyResource`, `debounced`, mock-data backend. Source: [`examples/dashboard`](https://github.com/KoalaFacts/Purity/tree/main/examples/dashboard).
- [TypeScript guide](https://github.com/KoalaFacts/Purity/blob/main/docs/typescript.md) — inference patterns for `state` / `compute` / `resource`, generic component props, scoped slots, custom `WatchSource`-based helpers
- [Why Shadow DOM by default](https://github.com/KoalaFacts/Purity/blob/main/docs/shadow-dom-rationale.md) — when the encapsulation pays, when it hurts, escape hatches, Tailwind / global-CSS integration
- [Accessibility under Shadow DOM](https://github.com/KoalaFacts/Purity/blob/main/docs/accessibility.md) — ARIA across boundaries, focus delegation, screen-reader patterns, a worked `p-tabs` example
- [Migration cheatsheet](https://github.com/KoalaFacts/Purity/blob/main/docs/migration.md) — side-by-side translations from React / SolidJS / Vue / Svelte to Purity

## License

[Apache-2.0](./LICENSE) starting with 0.5.0. Releases
through 0.4.0 remain MIT; their copyright and permission notice is retained in
[LICENSES/Purity-MIT.txt](./LICENSES/Purity-MIT.txt). Third-party components retain
their own licenses.
