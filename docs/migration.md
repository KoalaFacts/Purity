# Migration cheatsheet

Side-by-side translations from React / Solid / Vue / Svelte to Purity.
Not exhaustive — covers the operations you reach for daily.

## Reactive state

| Concept        | React                | SolidJS              | Vue 3         | Svelte 5            | Purity               |
| -------------- | -------------------- | -------------------- | ------------- | ------------------- | -------------------- |
| Create         | `useState(0)`        | `createSignal(0)`    | `ref(0)`      | `let n = $state(0)` | `state(0)`           |
| Read           | `n`                  | `n()`                | `n.value`     | `n`                 | `n()` or `n.get()`   |
| Write          | `setN(5)`            | `setN(5)`            | `n.value = 5` | `n = 5`             | `n(5)` or `n.set(5)` |
| Updater        | `setN((v) => v + 1)` | `setN((v) => v + 1)` | `n.value++`   | `n++`               | `n((v) => v + 1)`    |
| Untracked read | n/a                  | `untrack(() => n())` | n/a           | n/a                 | `n.peek()`           |

## Derived values

| Concept  | React                       | SolidJS                     | Vue 3                         | Svelte 5                  | Purity                   |
| -------- | --------------------------- | --------------------------- | ----------------------------- | ------------------------- | ------------------------ |
| Computed | `useMemo(() => n * 2, [n])` | `createMemo(() => n() * 2)` | `computed(() => n.value * 2)` | `let d = $derived(n * 2)` | `compute(() => n() * 2)` |

## Effects / watchers

| Concept                  | React                     | SolidJS                  | Vue 3                         | Svelte 5           | Purity                                          |
| ------------------------ | ------------------------- | ------------------------ | ----------------------------- | ------------------ | ----------------------------------------------- |
| Auto-tracked side effect | `useEffect(() => …, [n])` | `createEffect(() => …)`  | `watchEffect(() => …)`        | `$effect(() => …)` | `watch(() => …)`                                |
| Specific source          | n/a                       | `createEffect(on(n, …))` | `watch(n, (next, prev) => …)` | n/a                | `watch(n, (next, prev) => …)`                   |
| Cleanup                  | return fn from effect     | `onCleanup(() => …)`     | inside `watchEffect`          | inside `$effect`   | return fn from `watch` body, or `onDispose(fn)` |

## Async data

| Concept              | React (RTK / TanStack)     | SolidJS                   | Vue 3                   | Svelte 5                   | Purity                         |
| -------------------- | -------------------------- | ------------------------- | ----------------------- | -------------------------- | ------------------------------ |
| Reactive resource    | `useQuery({ key, fn })`    | `createResource(src, fn)` | userland (`<Suspense>`) | `{#await}` (template only) | `resource(src, fn)`            |
| Trigger imperatively | `useMutation(fn).mutate()` | n/a built-in              | userland                | `await fn()`               | `lazyResource(fn).fetch(args)` |
| Optimistic update    | `setQueryData(key, v)`     | `mutate(v)`               | userland                | userland                   | `r.mutate(v)`                  |
| Manual refetch       | `refetch()`                | `refetch()`               | userland                | re-render                  | `r.refresh()`                  |
| Loading flag         | `isLoading`                | `r.loading`               | userland                | `{:then}` block            | `r.loading()`                  |
| Error                | `error`                    | `r.error`                 | userland                | `{:catch}` block           | `r.error()`                    |
| Built-in retry       | TanStack `retry: 3`        | userland                  | userland                | userland                   | `{ retry: 3 }` option          |
| Built-in polling     | TanStack `refetchInterval` | userland                  | userland                | userland                   | `{ pollInterval: ms }` option  |
| Built-in debounce    | userland                   | userland                  | userland                | userland                   | `debounced(src, ms)`           |

## Lists

| Concept | React                                          | SolidJS                                              | Vue 3                | Svelte 5                    | Purity                                                                        |
| ------- | ---------------------------------------------- | ---------------------------------------------------- | -------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| Render  | `items.map(i => <li key={i.id}>{i.name}</li>)` | `<For each={items()}>{i => <li>{i.name}</li>}</For>` | `v-for="i in items"` | `{#each items as i (i.id)}` | `each(() => items(), (i) => html\`<li>${() => i().name}</li>\`, (i) => i.id)` |

## Conditionals

| Concept | React                | SolidJS                | Vue 3        | Svelte 5           | Purity                                                 |
| ------- | -------------------- | ---------------------- | ------------ | ------------------ | ------------------------------------------------------ |
| If/else | `cond ? <A/> : <B/>` | `<Show when={cond()}>` | `v-if`       | `{#if cond}`       | `when(() => cond(), () => html\`A\`, () => html\`B\`)` |
| Switch  | `switch (...)`       | `<Switch>`             | `v-if` chain | `{#if … :else if}` | `match(() => key(), { a: …, b: … })`                   |

## Two-way binding (input ↔ state)

| Concept    | React                                                     | SolidJS                                                    | Vue 3         | Svelte 5           | Purity                                     |
| ---------- | --------------------------------------------------------- | ---------------------------------------------------------- | ------------- | ------------------ | ------------------------------------------ |
| Text input | `<input value={v} onChange={e => set(e.target.value)} />` | `<input value={v()} onInput={e => set(e.target.value)} />` | `v-model="v"` | `bind:value={v}`   | `<input ::value=${v} />`                   |
| Checkbox   | `<input checked={c} onChange={…} />`                      | `<input checked={c()} onChange={…} />`                     | `v-model="c"` | `bind:checked={c}` | `<input type="checkbox" ::checked=${c} />` |

## Lifecycle

| Concept          | React                    | SolidJS              | Vue 3                      | Svelte 5                         | Purity                |
| ---------------- | ------------------------ | -------------------- | -------------------------- | -------------------------------- | --------------------- |
| After mount      | `useEffect(() => …, [])` | `onMount(() => …)`   | `onMounted(() => …)`       | `$effect(() => …)` (initial run) | `onMount(() => …)`    |
| Before unmount   | cleanup from effect      | `onCleanup(() => …)` | `onBeforeUnmount(() => …)` | `$effect` cleanup                | `onDestroy(() => …)`  |
| Generic disposer | n/a                      | `onCleanup(fn)`      | `onScopeDispose(fn)`       | n/a                              | `onDispose(fn)`       |
| Error boundary   | `<ErrorBoundary>`        | `<ErrorBoundary>`    | `errorCaptured`            | `<svelte:boundary>`              | `onError((err) => …)` |

## Components

| Concept         | React                            | SolidJS                      | Vue 3                               | Svelte 5                                     | Purity                                                     |
| --------------- | -------------------------------- | ---------------------------- | ----------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| Define          | `function Card({ title }) { … }` | `function Card(props) { … }` | `defineComponent({ props, setup })` | `<script>let { title } = $props();</script>` | `component<{ title: string }>('p-card', ({ title }) => …)` |
| Use in template | `<Card title="x" />`             | `<Card title="x" />`         | `<Card title="x" />`                | `<Card title="x" />`                         | `<p-card :title=${'x'}></p-card>`                          |
| Default slot    | `{children}`                     | `{props.children}`           | `<slot>`                            | `{@render children?.()}`                     | `slot()` accessor                                          |
| Named slot      | render-prop or context           | `<slot name="header">`       | `<slot name="header">`              | `{@render header?.()}`                       | `slot('header')` accessor                                  |
| Scoped slot     | render-prop                      | `<slot data={...}>`          | `v-slot="{ data }"`                 | `{#snippet header(data)}`                    | `slot<{ user: User }>('header')` accessor                  |

## DOM refs

| Concept     | React                  | SolidJS                  | Vue 3                     | Svelte 5         | Purity                                                                          |
| ----------- | ---------------------- | ------------------------ | ------------------------- | ---------------- | ------------------------------------------------------------------------------- |
| Element ref | `useRef()` + `ref={…}` | `let el; <div ref={el}>` | `ref(null)` + `:ref="el"` | `bind:this={el}` | `let el; html\`<div .ref=${(node) => (el = node)}>\``(or query inside`onMount`) |

## Templates

Purity uses `html\`\``tagged template literals (compiled by the`@purityjs/vite-plugin`):

| Need           | Syntax              | Example                                |
| -------------- | ------------------- | -------------------------------------- |
| Reactive text  | `${() => signal()}` | `<p>${() => count()}</p>`              |
| Event listener | `@event=${fn}`      | `<button @click=${save}>`              |
| One-way prop   | `:prop=${value}`    | `<p-card :title=${title}>`             |
| Two-way        | `::prop=${signal}`  | `<input ::value=${name} />`            |
| Boolean attr   | `?attr=${bool}`     | `<button ?disabled=${() => !valid()}>` |
| DOM property   | `.prop=${value}`    | `<input .checked=${flag}>`             |

## Things Purity doesn't have (yet)

If your existing app relies on these, plan around their absence:

- **No SSR / hydration.** No `renderToString`, no `getServerSideProps`,
  no Astro-style islands. Client-only.
- **No router.** Bring your own (the History API is straightforward to
  use directly).
- **No global state library.** `state()` modules are usable as singletons;
  pattern roughly matches Zustand or Pinia. No devtools yet.
- **No CSS-in-JS / styled-components.** Use the `css\`\`` template inside
  components; outside components, use plain stylesheets.
- **No JSX.** Tagged template literals (`html\`\``) only. The
`@purityjs/vite-plugin` compiles them ahead-of-time so there's no
  runtime parser.

If those gaps disqualify the framework for your use case, the gaps are
real — not yet bugs.
