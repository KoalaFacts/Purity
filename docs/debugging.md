# Debugging Purity apps

> **Status:** working notes. There is no devtools panel yet (see
> [ADR-0002](./decisions/0002-devtools.md)). The inspection hook
> documented below is the supported pre-1.0 path; richer tooling is
> on the post-1.0 roadmap.

When the UI doesn't behave the way the data says it should, you need
to see the reactive graph. Purity ships a small global hook on
`globalThis.__purity_inspect__` that exposes every live signal,
computed, and effect with their current values, statuses, and
relationships. The hook is always installed (no dev/prod build flag
needed); the runtime cost is one `WeakRef` set + ~0.4 kB gzipped of
conversion code.

## Quick tour

Open the browser devtools console on a page that runs Purity and try:

```js
__purity_inspect__.version;
// → 1

const all = __purity_inspect__.nodes();
all.length;
// → number of live state/computed/effect nodes

all.filter((n) => n.kind === 'state').map((s) => s.value);
// → all current state values

all.filter((n) => n.kind === 'computed' && n.status !== 'clean');
// → which computeds are dirty / waiting to recompute
```

The hook is on `globalThis`, so it works in any browsing context the
framework runs in — main pages, iframes, web workers (if you use
Purity there), jsdom in tests.

## The InspectorNode shape

Each call to `nodes()` returns a fresh tree of `InspectorNode`
objects:

```ts
interface InspectorNode {
  kind: 'state' | 'computed' | 'effect';
  version: number;
  status?: 'clean' | 'check' | 'dirty'; // present on computed and effect
  value: unknown;
  sources: InspectorNode[]; // empty for state
  observers: InspectorNode[];
}
```

| Field       | What it tells you                                                                           |
| ----------- | ------------------------------------------------------------------------------------------- |
| `kind`      | Node type: `state` (writable signal), `computed` (derived), `effect` (watcher)              |
| `version`   | Bumps every time the value actually changed. Useful for "did this update?"                  |
| `status`    | `clean` = up to date, `check` = ancestor moved, may need re-eval, `dirty` = known stale     |
| `value`     | The current cached value (for state, the live value; for computed, the last computed value) |
| `sources`   | Nodes this node reads from. Empty for `state`.                                              |
| `observers` | Nodes that read this one. Forms a cycle with `sources`.                                     |

Cycles are preserved by reference identity within a single
`nodes()` call: if A is a source of B and B is an observer of A,
walking `A.observers[0].sources[0]` returns the same object as `A`.

## Common debugging patterns

### "Why hasn't my UI updated?"

```js
// Find computeds that should have run but are still 'check' or 'dirty':
__purity_inspect__.nodes().filter((n) => n.kind === 'computed' && n.status !== 'clean');
```

If a computed is stuck at `check` it means an ancestor was marked
dirty but the comparison hasn't re-run. Forcing a read (call the
accessor) triggers the lazy update.

If it's stuck at `dirty`, the next read or the next flush will
rebuild it. If you're not seeing that, check whether something is
stalling the microtask queue (a long synchronous operation, or a
debugger pause).

### "Why did this fire?"

Check the `version` field. Every state write that changes the value
bumps `version`. If a computed has run but the upstream state's
version hasn't moved, the framework's CHECK→CLEAN fast path skipped
the re-run — that's correct behavior, the value is still the
previous one.

### "How many things observe this state?"

```js
const myState = __purity_inspect__.nodes().find((n) => n.value === 42);
myState.observers.length; // → number of computeds/effects watching this state
myState.observers.map((o) => o.kind); // → what kinds are watching
```

Useful when you suspect a leaked observer (a `watch` that should
have been disposed but wasn't).

### "Is anything leaking?"

```js
const before = __purity_inspect__.nodes().length;
// ... mount and unmount a component a few times ...
const after = __purity_inspect__.nodes().length;
console.log(after - before, 'extra nodes');
```

A small positive number is normal (`WeakRef`s of GC'd nodes
aren't immediately purged). A large or growing number across
mount/unmount cycles indicates a leak — usually a `watch()` whose
disposer wasn't called.

### Snapshot-then-act pattern

The inspector returns a snapshot — values reflect the moment of the
call. To diff before/after a user action:

```js
const snap = (label) =>
  console.log(
    label,
    __purity_inspect__
      .nodes()
      .filter((n) => n.kind === 'state')
      .map((n) => ({ v: n.value, ver: n.version })),
  );

snap('before');
document.querySelector('#save-button').click();
queueMicrotask(() => snap('after'));
```

## Things the hook doesn't expose

By design (see [ADR-0002](./decisions/0002-devtools.md)):

- **Variable names.** Each node is identified by its kind/value/version, not by the JS variable that holds the accessor. `state(0)` and `state(0)` look identical from the hook's view.
- **Source location.** No file:line of where the node was created.
- **Time travel.** Every snapshot is current. There is no replay log.
- **The component tree.** `mount()`/`component()` lifecycle is separate from the reactive graph; the hook only sees `state`/`compute`/`watch` nodes.

If your debugging case needs any of those, today the answer is
`console.log` in the relevant render functions or watchers. A real
devtools panel that adds these is post-1.0 (ADR-0002 trigger
conditions).

## What about `console.log` in framework code?

Purity logs with the prefix `[Purity]` for errors only — never on
the happy path. Searching `[Purity]` in the console surfaces:

- `[Purity] cleanup error:` — a `watch` cleanup function threw
- `[Purity] Error during disposal:` — an `onDispose` callback threw
- `[Purity] Error in onDestroy:` — an `onDestroy` callback threw
- `[Purity] Error in onError handler:` — an `onError` itself threw
  (rare; usually means the error boundary is broken)
- `[Purity] Maximum effect depth exceeded.` — a `watch` is feeding
  back into its own dep, infinite loop tripped at depth 100

If you see any of these and the cause isn't obvious, run
`__purity_inspect__.nodes()` and look for the node whose value or
status matches the failing operation.

## Bundle impact

The inspector adds ~0.4 kB gzipped to the shared chunk. Always
present, no `NODE_ENV` switch — Vite's library build substitutes
`process.env.NODE_ENV` at our build time, which would strip the
hook before downstream users could ever see it. Trade-off accepted.

If you must strip it from a production bundle:

```ts
// In your app's entrypoint, after importing from '@purityjs/core':
delete (globalThis as { __purity_inspect__?: unknown }).__purity_inspect__;
```

That removes the global; the conversion code in the framework still
exists in the bundle (about 200–300 bytes), but no one calls it and
modern bundlers may DCE the dead reachable code on a subsequent
build pass.

## Compatibility note

The hook's top-level `version` is `1`. Future framework releases
that change the `InspectorNode` shape will bump this number; any
external panel reading the hook should check `version === 1` first
and fall back to "unsupported" rather than crashing.
