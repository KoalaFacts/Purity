# Purity

A minimal, lightweight, super performant JavaScript web framework built on [native signals](https://github.com/tc39/proposal-signals).

- **Tiny** — small API surface, small bundle
- **Fast** — fine-grained reactivity, no virtual DOM
- **Zero build step** — tagged template literals work directly in the browser
- **Native signals** — built on the TC39 Signals proposal via [`signal-polyfill`](https://github.com/nicolo-ribaudo/signal-polyfill)

## Quick Start

```html
<script type="module">
  import { state, computed, html, mount, onMount } from 'purity';

  function App() {
    const count = state(0);
    const doubled = computed(() => count() * 2);

    onMount(() => console.log('App mounted!'));

    return html`
      <div>
        <h1>Count: ${() => count()}</h1>
        <p>Doubled: ${() => doubled()}</p>
        <button @click=${() => count(count() + 1)}>+1</button>
      </div>
    `;
  }

  mount(App, document.getElementById('app'));
</script>
```

## API

### Reactive Primitives

#### `state(initialValue)`

Creates a reactive state accessor. Call with no args to read, call with a value to write.

```js
const count = state(0);
count();      // read → 0
count(5);     // write → sets to 5
count.peek(); // read without tracking dependencies
```

#### `computed(fn)`

Creates a read-only derived value that auto-tracks dependencies.

```js
const doubled = computed(() => count() * 2);
doubled(); // read → 10
```

#### `effect(fn)`

Creates an auto-tracking side effect. Returns a dispose function. If `fn` returns a function, it's called as cleanup before the next re-run.

```js
const stop = effect(() => {
  console.log('Count is:', count());
  return () => console.log('cleanup');
});
stop(); // dispose the effect
```

#### `batch(fn)`

Batches multiple state updates into a single flush.

```js
batch(() => {
  count(1);
  name('Alice');
  // effects run once after batch completes
});
```

### Template Rendering

#### `` html`...` ``

Tagged template literal that returns real DOM nodes (DocumentFragment).

```js
// Static content
html`<p>Hello World</p>`

// Reactive text
html`<p>${() => count()}</p>`

// Event handling
html`<button @click=${() => count(count() + 1)}>Click</button>`

// Reactive attributes
html`<div class=${() => isActive() ? 'active' : ''}>...</div>`

// Boolean attributes
html`<input ?disabled=${() => isLoading()} />`

// Property binding
html`<input .value=${() => text()} />`
```

### Component System

#### `mount(component, container)`

Mounts a component function into a DOM container. Returns `{ unmount }`.

```js
function App() {
  return html`<h1>Hello</h1>`;
}

const { unmount } = mount(App, document.getElementById('app'));
unmount(); // tear down
```

### Lifecycle Hooks

All hooks are called inside a component function body.

| Hook | When it fires |
|------|---------------|
| `onBeforeMount(fn)` | Before component DOM is inserted |
| `onMount(fn)` | After component DOM is in the document |
| `onBeforeUpdate(fn)` | Before a reactive DOM update |
| `onUpdate(fn)` | After a reactive DOM update |
| `onBeforeDestroy(fn)` | Before component teardown begins |
| `onDestroy(fn)` | After component is removed from DOM |
| `onError(fn)` | When an error occurs in the component |

```js
function Timer() {
  const elapsed = state(0);

  onMount(() => {
    const id = setInterval(() => elapsed(elapsed() + 1), 1000);
    onDestroy(() => clearInterval(id));
  });

  return html`<p>Elapsed: ${() => elapsed()}s</p>`;
}
```

### Template Helpers

#### `show(conditionFn, viewFn, elseFn?)`

Conditional rendering.

```js
html`
  ${show(
    () => isLoggedIn(),
    () => html`<p>Welcome back!</p>`,
    () => html`<p>Please log in.</p>`
  )}
`
```

#### `each(listAccessor, mapFn, keyFn?)`

List rendering with optional key function for efficient reconciliation.

```js
const todos = state([
  { id: 1, text: 'Learn Purity' },
  { id: 2, text: 'Build something' },
]);

html`
  <ul>
    ${each(
      () => todos(),
      (todo) => html`<li>${todo.text}</li>`,
      (todo) => todo.id
    )}
  </ul>
`
```

## Development

```bash
npm install          # install dependencies
npm test             # run tests
npm run build        # build for distribution
npm run dev          # start dev server with examples
```

## License

MIT
