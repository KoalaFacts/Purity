# Skill: Create a Purity Component

When asked to create a component, follow this pattern:

## Steps
1. Choose a valid custom element tag name (must contain a hyphen, e.g. `p-card`, `p-sidebar`)
2. Define props as the first generic parameter
3. Define slot types as the second generic parameter (if slots are needed)
4. Use `css` for scoped styles (Shadow DOM handles scoping)
5. Use `onMount`/`onDestroy`/`onDispose` for lifecycle
6. Return `html` template, or `{ view, expose }` if exposing data to slots

## Template

```ts
import { state, compute, html, css, component, onMount, onDestroy, onDispose } from '@purityjs/core';

component('p-{name}', ({/* props */}, {/* slots */}) => {
  // Reactive state
  const myState = state(initialValue);
  const derived = compute(() => myState() * 2);

  // Scoped styles
  css`
    :host { display: block; }
    .container { /* styles */ }
  `;

  // Lifecycle
  onMount(() => {
    // DOM is ready
  });

  onDestroy(() => {
    // Cleanup
  });

  // Template
  return html`
    <div class="container">
      ${() => myState()}
    </div>
  `;
});
```

## Slot Patterns

```ts
// No slots
component('p-tag', ({ label }) => html`<span>${label}</span>`);

// Default slot
component('p-card', ({ title }, { default: body }) => {
  return html`<div><h2>${title}</h2>${body()}</div>`;
});

// Named slots
component('p-layout', (_props, { header, default: body, footer }) => {
  return html`
    <header>${header()}</header>
    <main>${body()}</main>
    <footer>${footer()}</footer>
  `;
});

// Scoped slot (expose data to consumer)
component('p-form', (_props, { default: body }) => {
  const isValid = compute(() => /* ... */);
  return {
    view: html`<form>${body({ validate: isValid })}</form>`,
    expose: { validate: isValid },
  };
});
```

## Binding Syntax
```
:prop=${value}        one-way (parent → child)
::prop=${signal}      two-way binding
@event=${handler}     event listener
?attr=${bool}         boolean attribute
```

## Always
- Use `p-` prefix for tag names
- Use `css` inside components (Shadow DOM scopes it)
- Register `onDispose` for any watch/effect cleanup
- Use `() => signal()` for reactive text in templates
