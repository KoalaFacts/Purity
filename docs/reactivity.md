# Reactivity and templates

Purity updates the DOM from the values a template reads. Start with `state()` for values that change, `compute()` for values derived from them, and `html` for the markup that displays them.

```ts
import { compute, html, mount, state } from '@purityjs/core';

const count = state(0);
const doubled = compute(() => count() * 2);

mount(
  () => html`
    <button @click=${() => count((value) => value + 1)}>Add one</button>
    <p>Count: ${() => count()}</p>
    <p>Double: ${() => doubled()}</p>
  `,
  document.getElementById('app')!,
);
```

`count()` reads the current value. `count(5)` writes a value, while `count((current) => current + 1)` updates from the previous value. `doubled()` recalculates when `count` changes. Pass a function to a template slot when the slot should update as its reactive values change.

## Bind values and events

Purity templates use a small set of prefixes:

```ts
import { html, state } from '@purityjs/core';

const name = state('');
const canSubmit = state(false);

html`
  <label for="name">Name</label>
  <input id="name" ::value=${name} />
  <button @click=${() => console.log(name())} ?disabled=${() => !canSubmit()}>Save</button>
`;
```

`@click` attaches an event listener, `::value` keeps the input and state in sync, and `?disabled` sets a boolean attribute. For a one-way component property use `:property`; for a DOM property use `.property`.

## Render a keyed list

Use `each()` when items can be inserted, removed, or reordered. Give each item a stable key so Purity can preserve its DOM node when its position changes.

```ts
import { each, html, state } from '@purityjs/core';

const todos = state([{ id: 1, text: 'Read the guide' }]);

html`
  <ul>
    ${each(
      todos,
      (todo) => html`<li>${() => todo().text}</li>`,
      (todo) => todo.id,
    )}
  </ul>
`;
```

The render callback receives an accessor for the current item. Call `todo()` inside a reactive slot so a changed item with the same key updates its text. For long scrollable lists, `each()` also supports `{ virtual: true }`; Purity manages the visible range and spacers.

## Run an effect only when needed

`watch()` is for work outside the template, such as observing a value or coordinating with a browser API. It returns a function that stops the watcher.

```ts
import { state, watch } from '@purityjs/core';

const count = state(0);
const stop = watch(() => console.log(count()));

stop();
```

For component cleanup, register the stop function with `onDispose()`. To see how these values are typed, continue with the [TypeScript guide](./typescript.md). To inspect the reactive graph while developing, see [Debugging](./debugging.md).
