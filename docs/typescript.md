# TypeScript guide

Purity ships TypeScript types for its public API. This guide walks through
the inference patterns you'll actually reach for, plus a few common
pitfalls (including a small list at the bottom of things the type system
can't catch).

> All examples assume `"strict": true` in `tsconfig.json`.

## Reactive primitives

### `state<T>` — inference from initial value

```ts
import { state } from '@purityjs/core';

const count = state(0); // StateAccessor<number>
const name = state('Alice'); // StateAccessor<string>
const todos = state<string[]>([]); // explicit when initial is empty/ambiguous

count(); // number
count(5); // number     — write
count((v) => v + 1); // number    — updater
count.peek(); // number    — untracked read
```

**Pitfall — ambiguous initial value:** `state([])` infers as
`StateAccessor<never[]>` and rejects every push. Annotate the type when
the initial value can't carry it: `state<Todo[]>([])`.

**Pitfall — `null` / `undefined`:** `state(null)` is `StateAccessor<null>`,
which can never hold anything else. For nullable state write
`state<User | null>(null)`.

### `compute<T>` — inferred from the body

```ts
import { compute, state } from '@purityjs/core';

const first = state('Jane');
const last = state('Doe');
const full = compute(() => `${first()} ${last()}`); // ComputedAccessor<string>

full(); // string
full.peek(); // string  — read without tracking
```

The body's return type flows out. No extra annotation needed unless you
want to widen the type explicitly.

### `watch` — three call shapes, three return types

```ts
import { watch } from '@purityjs/core';

// 1. Auto-tracked effect
const stop = watch(() => {
  console.log(count()); // any signal read here is tracked
});
stop(); // Dispose

// 2. Explicit single source
watch(count, (next, prev) => {
  // next: number, prev: number
});

// 3. Multiple sources — value tuples line up with the source tuple
watch([first, last], ([f, l], [oldF, oldL]) => {
  // f: string, l: string, oldF: string, oldL: string
});
```

The `[first, last]` overload uses `as const` inference internally
(`<const S extends readonly WatchSource<any>[]>`), so positional types
flow through without manual annotation.

## `WatchSource<T>` — accept any reactive value

When you write a custom helper that takes a "signal-like" thing, type the
parameter as `WatchSource<T>` so callers can pass a `StateAccessor`,
a `ComputedAccessor`, or a plain `() => T`.

```ts
import { type WatchSource, compute } from '@purityjs/core';

function caseInsensitive(source: WatchSource<string>) {
  // StateAccessor, ComputedAccessor, and `() => T` are all callable, so a
  // single `source()` covers all three.
  return compute(() => source().toLowerCase());
}

caseInsensitive(name); // StateAccessor<string>  — works
caseInsensitive(full); // ComputedAccessor<string> — works
caseInsensitive(() => 'hi'); // () => string             — works
```

## Components

### Props inference

```ts
import { component, html } from '@purityjs/core';

const Tag = component<{ label: string; count?: number }>('p-tag', ({ label, count = 0 }) => {
  return html`<span>${label}: ${count}</span>`;
});

Tag({ label: 'hi' }); // ok
Tag({ label: 'hi', count: 3 }); // ok
Tag({}); // type error: label missing
Tag({ label: 1 }); // type error: number not assignable to string
```

The first generic parameter is the props shape. Defaults flow naturally.

### Slots — three flavors

```ts
// 1. Default slot, no exposed data
const Card = component<{ title: string }, { default: undefined }>(
  'p-card',
  ({ title }, { default: body }) => html`
    <div>
      <h2>${title}</h2>
      ${body()}
    </div>
  `,
);
Card({ title: 'Hello' }, html`<p>Body</p>`);

// 2. Named slots
const Layout = component<
  { user: { name: string } },
  { header: undefined; default: undefined; footer: undefined }
>(
  'p-layout',
  ({ user }, { header, default: body, footer }) => html`
    <header>${header()}</header>
    <main>${body()}</main>
    <footer>${footer()}</footer>
    <small>signed in as ${user.name}</small>
  `,
);

// 3. Scoped slot — pass exposed data to the parent's slot template
const List = component<{ items: Item[] }, { default: { item: Item } }>(
  'p-list',
  ({ items }, { default: row }) => html`
    <ul>
      ${each(
        () => items,
        (item) => html`<li>${row({ item: item() })}</li>`,
      )}
    </ul>
  `,
);
```

The second generic is a `{ slotName: ExposedShape }` map. Use `undefined`
for slots that don't expose data; use a real shape (e.g. `{ item: Item }`)
to make the slot scoped.

### Returning exposed data from a component

```ts
const Form = component<{ action: string }, { default: { isValid: boolean } }>(
  'p-form',
  ({ action }, { default: body }) => {
    const isValid = compute(() => true);
    return {
      view: html`<form action=${action}>${body({ isValid: isValid() })}</form>`,
      expose: { isValid },
    };
  },
);
```

The return-type union (`Node | DocumentFragment | RenderOutput`) is
inferred — TypeScript will accept either a bare DOM node or the
`{ view, expose }` shape.

## Async data

### `ResourceAccessor<T>`

```ts
import { resource, type ResourceAccessor } from '@purityjs/core';

interface User {
  id: number;
  name: string;
}

const user: ResourceAccessor<User> = resource(
  () => userId(),
  async (id, { signal }) => {
    const r = await fetch(`/u/${id}`, { signal });
    return r.json() as Promise<User>;
  },
);

user(); // User | undefined
user.loading(); // boolean
user.error(); // unknown
user.refresh(); // void
user.mutate({ id: 1, name: 'x' }); // T or (current: T | undefined) => T
```

The fetcher's return type drives `T`. With explicit casts on `r.json()`
(or a generic fetch wrapper), the resource is end-to-end typed.

### `LazyResourceAccessor<T, A>`

```ts
import { lazyResource } from '@purityjs/core';

interface SaveArgs {
  id: number;
  name: string;
}
interface SaveResult {
  ok: boolean;
}

const save = lazyResource<SaveResult, SaveArgs>(async (args, { signal }) => {
  const r = await fetch('/save', {
    method: 'POST',
    body: JSON.stringify(args),
    signal,
  });
  return (await r.json()) as SaveResult;
});

save.fetch({ id: 1, name: 'Jane' }); // (args: SaveArgs) => void
save(); // SaveResult | undefined
```

The first generic is the result type, the second is the arg type passed
to `fetch(args)`. `A` defaults to `void` if you only need a no-arg
trigger.

### `WatchSource` from a resource

`ResourceAccessor<T>` is itself a `() => T | undefined`, so it satisfies
`WatchSource<T | undefined>`:

```ts
watch(user, (next) => {
  // next: User | undefined
});
```

## Custom helpers

Pattern: take a `WatchSource<T>`, return a `ComputedAccessor<U>` (or
write your own accessor type if you need more methods).

```ts
import { compute, type ComputedAccessor, type WatchSource } from '@purityjs/core';

function uppercased<T extends string>(source: WatchSource<T>): ComputedAccessor<T> {
  return compute(() => {
    const v = typeof source === 'function' ? source() : source.get();
    return v.toUpperCase() as T;
  });
}
```

For more elaborate accessors (e.g. with `.dispose`), follow the pattern in
`src/debounced.ts` — extend `ComputedAccessor<T>` with the extra methods
and assign them at construction:

```ts
interface MyAccessor<T> extends ComputedAccessor<T> {
  dispose(): void;
}
```

## Things TypeScript can't catch

A few correctness invariants the type system doesn't enforce — easy to
trip on:

- **Reading `r()` inside the source function of a `resource(source, fetcher)`.**
  Creates a feedback loop (each fetch resolution re-evaluates the source,
  which sees new data, which fires the fetcher again). Compiles fine,
  loops at runtime.
- **`mutate()` ambiguity when `T` is itself a function.** The
  `T | ((cur) => T)` overload picks "updater" for any function value;
  there's no way to set a function value directly. Same trade-off as
  `state()`.
- **Source returning `0` / `''` / `NaN`.** The skip-fetch predicate is
  the explicit triple `false | null | undefined`. Falsy primitives like
  `0` or empty string DO fetch. If you want them to skip, use
  `() => key() || null` explicitly.
