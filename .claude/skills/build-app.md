# Skill: Build an App with Purity

When asked to build an app or page using Purity:

## Project Setup
```bash
npx @purity/cli my-app
cd my-app
npm install
npm run dev
```

## App Structure
```
src/
  main.ts          — entry point, mount root component
  components/      — p-* component files
  composables/     — shared reactive logic (use* functions)
  styles/          — shared CSS
```

## Entry Point Pattern
```ts
// src/main.ts
import { mount, html } from '@purity/core';
import './components/app.ts';

mount(() => html`<p-app></p-app>`, document.getElementById('app')!);
```

## Component Pattern
```ts
// src/components/app.ts
import { state, compute, html, css, component, onMount, each, when } from '@purity/core';

component('p-app', () => {
  const items = state([]);
  const count = compute(() => items().length);

  css`
    .app { max-width: 600px; margin: 0 auto; padding: 2rem; }
    h1 { color: #6c5ce7; }
  `;

  return html`
    <div class="app">
      <h1>My App</h1>
      <p>${() => count()} items</p>
      ${each(() => items(), (item) => html`<p-item :data=${item}></p-item>`)}
    </div>
  `;
});
```

## Composable Pattern (shared logic)
```ts
// src/composables/useFetch.ts
import { state, onMount } from '@purity/core';

export function useFetch<T>(url: string) {
  const data = state<T | null>(null);
  const loading = state(true);
  const error = state<string | null>(null);

  onMount(async () => {
    try {
      const res = await fetch(url);
      data(await res.json());
    } catch (e) {
      error(e.message);
    } finally {
      loading(false);
    }
  });

  return { data, loading, error };
}
```

## Form Pattern
```ts
component('p-form', () => {
  const name = state('');
  const email = state('');

  const submit = (e: Event) => {
    e.preventDefault();
    console.log({ name: name(), email: email() });
  };

  return html`
    <form @submit=${submit}>
      <input ::value=${name} placeholder="Name" />
      <input ::value=${email} placeholder="Email" type="email" />
      <button type="submit">Save</button>
    </form>
  `;
});
```

## Conditional Rendering
```ts
// Boolean
when(() => isLoggedIn(),
  () => html`<p>Welcome</p>`,
  () => html`<p>Please login</p>`
)

// Multi-case
match(() => status(), {
  loading: () => html`<p>Loading...</p>`,
  error: () => html`<p>Error!</p>`,
  success: () => html`<p>Done</p>`,
})
```

## List Rendering
```ts
each(() => items(),
  (item) => html`<li>${item.name}</li>`,
  (item) => item.id  // key function for efficient diffing
)
```

## Communication
```
Parent → Child:    :prop=${value}
Child → Parent:    @event=${callback}  (callback props)
Two-way:           ::prop=${signal}
Deep tree:         Use @purity/inject (provide/inject) if needed
```
