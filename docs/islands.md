# Islands

Opt-in per-subtree hydration. Mark a region of your page with
`island(view)` and Purity will render the rest of the document as static
HTML with zero client JavaScript. Only the islanded regions ship a
client chunk, and each one hydrates on its own configured trigger.

ADR [0038](./decisions/0038-islands.md) is the design rationale; this
page is the practical guide.

## When to reach for an island

Use islands when your page is **mostly static** and only a few regions
need to react to anything:

- marketing landing pages with a CTA button or signup form,
- blog posts with a like button, comment counter, or share widget,
- documentation pages with a sidebar TOC or search,
- product listings where only the filter / cart count are interactive.

Use the default (whole-page hydration) when your page is **mostly
interactive** — dashboards, editors, mail clients, anything where most
of the document responds to state.

The opt-in shape preserves the default: apps that don't call `island()`
see no change in build output, bundle size, or runtime behaviour.

## The API

```ts
import { island, mountIslands } from '@purityjs/core';
```

### `island(view, options?)`

Brands a view function as an island. On the server, the rendered output
is wrapped in `<purity-island data-pi-id="N" data-pi-trigger="…"
style="display:contents">…</purity-island>`. On the client, the brand
is a no-op when called directly — `mountIslands()` is what makes the
trigger fire.

```ts
import { island, component, html, state } from '@purityjs/core';

const Counter = component('my-counter', () => {
  const n = state(0);
  return html`<button onclick=${() => n.update((v) => v + 1)}>${n}</button>`;
});

export const Interactive = island(Counter, { hydrate: 'visible' });
```

| Option    | Type                                                                 | Default  | Effect                                                          |
| --------- | -------------------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| `hydrate` | `'load' \| 'idle' \| 'visible' \| 'interact' \| \`media:${string}\`` | `'load'` | When the island's chunk hydrates. See the trigger matrix below. |

### `mountIslands(views, options?)`

Client-side runtime that finds every `<purity-island>` wrapper in the
document and schedules its hydration. Entries match by 1-based ID —
the first island SSR-rendered on the page is `views[0]`, the second
is `views[1]`, and so on.

Each entry can be either:

- an **eager** branded view: `mountIslands([Counter])` — ships with the
  shell;
- a **lazy** dynamic-import thunk: `mountIslands([() =>
import('./counter.ts').then((m) => m.Counter)])` — each island lands
  in its own Rollup-split chunk, requested only when the trigger fires.

The lazy form is what delivers the headline byte savings. Use it
unless an island is small enough that splitting it into its own chunk
costs more (HTTP overhead) than inlining it would save.

```ts
// entry.client.ts
import { mountIslands } from '@purityjs/core';

mountIslands([
  () => import('./islands/counter.ts').then((m) => m.Counter),
  () => import('./islands/like.ts').then((m) => m.Like),
]);
```

| Option    | Type                                  | Default                    | Effect                                                             |
| --------- | ------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `root`    | `ParentNode`                          | `document.documentElement` | Scope the wrapper scan to a subtree. Useful for tests.             |
| `onMount` | `(id: number, root: Element) => void` | _none_                     | Called once per island after `hydrate()` returns. Instrumentation. |

## The trigger matrix

| Trigger      | Hydrates when…                                                                 | Falls back to                       |
| ------------ | ------------------------------------------------------------------------------ | ----------------------------------- |
| `'load'`     | the next microtask after `mountIslands()` runs.                                | —                                   |
| `'idle'`     | the browser is idle (`requestIdleCallback`, timeout 2 s).                      | `setTimeout(…, 1)` on Safari pre-17 |
| `'visible'`  | the wrapper enters the viewport (`IntersectionObserver`).                      | `'load'` when the API is missing    |
| `'interact'` | first `pointerdown` / `focusin` / `keydown` inside the wrapper, capture phase. | —                                   |
| `media:(…)`  | the CSS media query matches (`matchMedia`).                                    | `'load'` when `matchMedia` missing  |

Triggers are mutually exclusive in this release — one per island.
Composite triggers (e.g. "whichever of `visible` or `interact` fires
first") can be added later without breaking the API.

## Cross-island state

Each island has its own signal graph. Two islands on the same page do
not share `state()` unless you set it up explicitly. Three documented
patterns cover the realistic cases:

1. **URL state** via `currentSearch()` / `currentHash()` (router
   primitives). Works without any new primitive.
2. **Storage-backed signals** — wrap a `state()` in a `localStorage` /
   `sessionStorage` / `cookie` adapter. (A first-class `persist()`
   helper is on the backlog.)
3. **Server round-trip** via `serverAction()` for state that must be
   authoritative.

The most common footgun: closing over a module-scope `state()` in your
island. When the island is split into its own chunk, the closure is
duplicated, not shared. Two `<my-counter />` instances on the same page
would each have their own module-scope counter.

## What works in this release

- `island()` brand and SSR `<purity-island>` wrapper.
- `mountIslands()` client runtime, all five trigger kinds.
- Per-island chunk split via dynamic-import thunks.
- Custom-element-rooted islands (auto-upgrade via DSD).
- html-rooted islands (single-element root).

## Known limitations

- **Multi-rooted islands** (a view that returns a fragment with multiple
  sibling elements) hydrate through the single hydrate-walker path. If
  you hit issues, wrap the island content in a single element.
- **First-interaction event replay** is not implemented. The click that
  fires the `'interact'` trigger is the click that wires up the handler;
  the next click is the first one your handler sees. Document this in
  your UI if a click ever needs to be lost-free.
- **`island()` detection by the Vite plugin** is not automated yet. The
  user wires `mountIslands(…)` with explicit dynamic-import thunks. A
  future Vite plugin pass can transform `mountIslands([X, Y])` into the
  lazy form automatically.
- **Cross-page island state** is bounded by your storage / URL choices.
  An SPA navigation re-mounts islands on the destination page.

## Example

See [`examples/islands-blog/`](../examples/islands-blog) for a runnable
demo: a content-heavy blog page with a `'load'` counter and a
`'visible'` like button. Build it with `npm install && npm run build`
from the example directory; the production output ships the shell as
plain HTML and serves each island as its own chunk.
